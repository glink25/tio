import { HostError, isContentTarget, type RelationPage, type SearchPage } from '@tio/core';
const record = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
export function relationPage(
  value: unknown,
  workspaceId: string,
  kind: 'references' | 'occurrences' | 'graph',
): RelationPage<any> {
  if (
    !record(value) ||
    typeof value.version !== 'string' ||
    !['building', 'partial', 'ready'].includes(value.status) ||
    typeof value.complete !== 'boolean' ||
    value.complete !== (value.status === 'ready') ||
    !Array.isArray(value.items) ||
    (value.next !== undefined && typeof value.next !== 'string') ||
    (value.total !== undefined && (!integer(value.total) || !value.complete))
  )
    throw new HostError('invalid');
  const target = (v: unknown) => isContentTarget(v) && v.workspaceId === workspaceId;
  const node = (v: unknown) => record(v) && target(v.target) && typeof v.title === 'string';
  const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v);
  for (const item of value.items) {
    if (!record(item)) throw new HostError('invalid');
    const valid =
      kind === 'references'
        ? node(item.node) && integer(item.count) && ['ready', 'unavailable'].includes(item.status)
        : kind === 'occurrences'
          ? target(item.source) &&
            target(item.target) &&
            typeof item.excerpt === 'string' &&
            (item.fieldName === undefined || typeof item.fieldName === 'string')
          : item.type === 'node'
            ? node(item.node)
            : item.type === 'edge' &&
              record(item.edge) &&
              id(item.edge.source) &&
              id(item.edge.target) &&
              integer(item.edge.count);
    if (!valid) throw new HostError('invalid');
  }
  return value as RelationPage<any>;
}
export function searchPage(value: unknown, workspaceId: string): SearchPage {
  if (
    !record(value) ||
    !integer(value.version) ||
    !integer(value.scanned) ||
    !Array.isArray(value.items) ||
    typeof value.complete !== 'boolean' ||
    (value.next !== undefined && typeof value.next !== 'string') ||
    value.complete !== !value.next
  )
    throw new HostError('invalid');
  for (const hit of value.items)
    if (
      !record(hit) ||
      !isContentTarget(hit.target) ||
      hit.target.workspaceId !== workspaceId ||
      !['id', 'title', 'path', 'excerpt'].every((k) => typeof hit[k] === 'string')
    )
      throw new HostError('invalid');
  return value as SearchPage;
}
