import {
  HostError,
  isContentTarget,
  validateEnvelope,
  queryProjection,
  type QueryPage,
} from '@tio/core';
/** Projection payloads deliberately cannot pass the full-object decoder. */
export function projectionPage(value: any, workspaceId: string): QueryPage {
  if (
    !value ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    !Array.isArray(value.entries) ||
    (value.next !== undefined && typeof value.next !== 'string')
  )
    throw new HostError('invalid');
  for (const entry of value.entries) {
    const o = entry?.projection;
    if (
      !o ||
      o.workspaceId !== workspaceId ||
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 0 ||
      !Array.isArray(entry.references) ||
      'blocks' in o
    )
      throw new HostError('invalid');
    try {
      validateEnvelope(o);
    } catch {
      throw new HostError('invalid');
    }
    const allowed = queryProjection(o);
    if (Object.keys(o).some((key) => !(key in allowed))) throw new HostError('invalid');
    for (const reference of entry.references) {
      if (
        !reference ||
        !isContentTarget(reference.source) ||
        !isContentTarget(reference.target) ||
        reference.source.workspaceId !== workspaceId ||
        reference.target.workspaceId !== workspaceId ||
        reference.source.id !== o.id ||
        typeof reference.excerpt !== 'string' ||
        (reference.fieldName !== undefined && typeof reference.fieldName !== 'string')
      )
        throw new HostError('invalid');
    }
  }
  for (const ids of [value.missing, value.denied])
    if (
      ids !== undefined &&
      (!Array.isArray(ids) ||
        !ids.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id)))
    )
      throw new HostError('invalid');
  return value;
}
