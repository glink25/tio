import {
  HostError,
  validate,
  type WorkspaceSnapshot,
  type CommitResult,
  type WorkspaceEvent,
} from '@tio/core';
const record = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
export function envelope(value: unknown): boolean {
  return (
    record(value) &&
    integer(value.protocol) &&
    typeof value.id === 'string' &&
    typeof value.sessionId === 'string' &&
    typeof value.workspaceId === 'string' &&
    ['request', 'response', 'changed', 'extensionChanged'].includes(value.kind)
  );
}
export function snapshot(value: unknown): WorkspaceSnapshot {
  if (!record(value) || !integer(value.version) || !Array.isArray(value.entries))
    throw new HostError('invalid', 'Invalid snapshot');
  for (const entry of value.entries) {
    if (!record(entry) || !integer(entry.revision)) throw new HostError('invalid');
    validate(entry.object);
  }
  return value as WorkspaceSnapshot;
}
export function result(value: unknown): CommitResult {
  if (
    !record(value) ||
    !integer(value.version) ||
    !['committed', 'conflict', 'compacted'].includes(value.status)
  )
    throw new HostError('invalid', 'Invalid receipt');
  if (value.status === 'committed') snapshot(value);
  return value as CommitResult;
}
export function event(value: unknown): WorkspaceEvent {
  if (
    !record(value) ||
    !integer(value.version) ||
    typeof value.commitId !== 'string' ||
    typeof value.origin !== 'string' ||
    !Array.isArray(value.changedIds) ||
    !value.changedIds.every((id) => typeof id === 'string')
  )
    throw new HostError('invalid', 'Invalid event');
  return value as WorkspaceEvent;
}
export function requestPayload(method: string | undefined, p: any) {
  if (method === 'readSnapshot') return;
  if (!record(p)) throw new HostError('invalid');
  if (
    ['getCommitResult', 'readAsset', 'releaseAsset', 'stageAsset'].includes(method ?? '') &&
    (typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(p.id))
  )
    throw new HostError('invalid');
  if (
    method === 'queryObjects' &&
    (!record(p.scope) ||
      (typeof p.scope.type === 'string') === (typeof p.scope.databaseId === 'string') ||
      !integer(p.limit) ||
      p.limit < 1 ||
      p.limit > 1000 ||
      (p.after !== undefined && typeof p.after !== 'string'))
  )
    throw new HostError('invalid');
  if (
    ['queryMentions', 'queryNavigation', 'queryRecords', 'search', 'scan'].includes(method ?? '') &&
    (!integer(p.limit) ||
      p.limit < 1 ||
      p.limit > 1000 ||
      (p.after !== undefined && typeof p.after !== 'string'))
  )
    throw new HostError('invalid');
  if (
    method === 'queryRecords' &&
    (typeof p.databaseId !== 'string' ||
      (p.view !== undefined && !record(p.view)) ||
      (p.text !== undefined && typeof p.text !== 'string'))
  )
    throw new HostError('invalid');
  if (
    method === 'search' &&
    (typeof p.text !== 'string' || (p.type !== undefined && typeof p.type !== 'string'))
  )
    throw new HostError('invalid');
  if (
    ['readObjects', 'readMetadata'].includes(method ?? '') &&
    (!Array.isArray(p.ids) ||
      p.ids.length > 1000 ||
      !p.ids.every((id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id)))
  )
    throw new HostError('invalid');
  if (
    ['queryNavigation', 'queryMentions'].includes(method ?? '') &&
    p.text !== undefined &&
    typeof p.text !== 'string'
  )
    throw new HostError('invalid');
  if (method === 'queryMentions' && typeof p.text !== 'string') throw new HostError('invalid');
  if (method === 'readChanges' && !integer(p.since)) throw new HostError('invalid');
  if (method === 'acknowledgeCommits' && (typeof p.clientId !== 'string' || !integer(p.sequence)))
    throw new HostError('invalid');
  if (
    method === 'stageAsset' &&
    (typeof p.reference !== 'string' || typeof p.name !== 'string' || typeof p.mime !== 'string')
  )
    throw new HostError('invalid');
  if (method === 'extension' && (typeof p.name !== 'string' || !integer(p.version)))
    throw new HostError('invalid');
  if (
    method === 'commit' &&
    (!Array.isArray(p.changes) ||
      !integer(p.expectedVersion) ||
      typeof p.id !== 'string' ||
      !Array.isArray(p.assetIds))
  )
    throw new HostError('invalid');
}
