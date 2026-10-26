import {
  createDomain,
  type Domain,
  assertJson,
  HostError,
  type CommitRequest,
  type WorkspaceSnapshot,
  type WorkspaceEntry,
} from './index';
/** Shared host validation; native hosts implement the same rules using contract fixtures. */
export function applyCommit(
  snapshot: WorkspaceSnapshot,
  request: CommitRequest,
  domain: Domain = createDomain(),
): WorkspaceEntry[] {
  if (
    !request ||
    typeof request.id !== 'string' ||
    !request.id ||
    (request.clientId !== undefined &&
      (typeof request.clientId !== 'string' ||
        !request.clientId ||
        !Number.isSafeInteger(request.sequence) ||
        request.sequence! < 1)) ||
    (request.sequence !== undefined && !request.clientId) ||
    !Number.isSafeInteger(request.expectedVersion) ||
    request.expectedVersion < 0 ||
    !Array.isArray(request.changes) ||
    !Array.isArray(request.assetIds) ||
    !request.assetIds.every((id) => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id))
  )
    throw new HostError('invalid');
  if (request.recovery) assertJson(request.recovery);
  const originals = new Map(snapshot.entries.map((e) => [e.object.id, e]));
  const entries = new Map(originals);
  const ids = new Set<string>();
  const workspaces = new Set(snapshot.entries.map((e) => e.object.workspaceId));
  for (const raw of request.changes) {
    const object = domain.objects.decode(structuredClone(raw));
    if (ids.has(object.id)) throw new HostError('invalid', 'Duplicate identity');
    ids.add(object.id);
    workspaces.add(object.workspaceId);
    const old = entries.get(object.id);
    if (
      old &&
      (old.object.type !== object.type ||
        old.object.workspaceId !== object.workspaceId ||
        old.object.schemaVersion !== object.schemaVersion ||
        old.object.databaseId !== object.databaseId ||
        ((!domain.objects.supports(old.object) || old.object.deleted) &&
          JSON.stringify(old.object) !== JSON.stringify(object) &&
          !(old.object.deleted && !object.deleted && domain.objects.supports(old.object))))
    )
      throw new HostError('invalid', 'Immutable identity or unsupported format');
    entries.set(object.id, { object, revision: (old?.revision ?? 0) + 1 });
  }
  for (const object of request.changes) {
    if (object.type !== 'record' || object.deleted) continue;
    const database = entries.get(object.databaseId!)?.object;
    if (!database) continue; // A separately synchronized schema may not have arrived yet.
    const fields = new Map(database.fields!.map((field) => [field.id, field]));
    const previous = originals.get(object.id)?.object;
    for (const [id, value] of Object.entries(object.properties!)) {
      const field = fields.get(id);
      if (field && JSON.stringify(previous?.properties?.[id]) !== JSON.stringify(value))
        domain.fields.validate(field, value);
    }
  }
  if (workspaces.size > 1) throw new HostError('invalid', 'Cross-workspace write');
  return [...entries.values()];
}
