import {
  validate,
  registry,
  editable,
  HostError,
  type CommitRequest,
  type WorkspaceSnapshot,
  type WorkspaceEntry,
} from './index';
/** Shared host validation; native hosts implement the same rules using contract fixtures. */
export function applyCommit(snapshot: WorkspaceSnapshot, request: CommitRequest): WorkspaceEntry[] {
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
  const entries = new Map(snapshot.entries.map((e) => [e.object.id, e]));
  const ids = new Set<string>();
  const workspaces = new Set(snapshot.entries.map((e) => e.object.workspaceId));
  for (const raw of request.changes) {
    const object = validate(structuredClone(raw));
    if (ids.has(object.id)) throw new HostError('invalid', 'Duplicate identity');
    ids.add(object.id);
    workspaces.add(object.workspaceId);
    const old = entries.get(object.id);
    if (
      request.migration &&
      (!old || JSON.stringify(registry().decode(old.object)) !== JSON.stringify(object))
    )
      throw new HostError('invalid', 'Invalid migration transaction');
    if (
      old &&
      (old.object.type !== object.type ||
        old.object.workspaceId !== object.workspaceId ||
        (old.object.schemaVersion !== object.schemaVersion &&
          !(
            request.migration &&
            JSON.stringify(registry().decode(old.object)) === JSON.stringify(object)
          )) ||
        (!request.migration &&
          !editable(old.object) &&
          JSON.stringify(old.object) !== JSON.stringify(object) &&
          !(old.object.deleted && !object.deleted && editable({ ...old.object, deleted: false }))))
    )
      throw new HostError('invalid', 'Immutable identity or unsupported format');
    entries.set(object.id, { object, revision: (old?.revision ?? 0) + 1 });
  }
  if (workspaces.size > 1) throw new HostError('invalid', 'Cross-workspace write');
  return [...entries.values()];
}
