import type { ConnectionAccessCode } from '@tio/core';
import { t, type TranslationKey } from '@tio/i18n';
import type { SyncPhase, SyncSnapshot } from '@tio/sync';
import type { WorkspaceRuntime } from '@tio/workspace';

export type SaveStatus = ReturnType<WorkspaceRuntime['state']['getState']>['status'];
export interface StatusModel {
  visual: 'attention' | 'busy' | 'cloud' | 'saved';
  save: SaveStatus;
  sync?: SyncSnapshot;
  access?: SyncSnapshot['access'];
  hasIssues: boolean;
}
export function statusModel(
  save: SaveStatus,
  sync: SyncSnapshot,
  supportsSync: boolean,
  hasIssues: boolean,
  error?: unknown,
): StatusModel {
  const accessProblem = sync.access && sync.access.code !== 'available';
  const attention =
    !!error ||
    save === 'error' ||
    hasIssues ||
    accessProblem ||
    (supportsSync &&
      (sync.phase === 'failed' || sync.phase === 'permission' || sync.phase === 'issues'));
  return {
    save,
    access: sync.access,
    sync: supportsSync ? sync : undefined,
    hasIssues,
    visual: attention
      ? 'attention'
      : save === 'loading' || save === 'saving' || (supportsSync && sync.phase === 'syncing')
        ? 'busy'
        : supportsSync
          ? 'cloud'
          : 'saved',
  };
}
export const saveKeys = {
  loading: 'status.loading',
  saved: 'status.saved',
  saving: 'status.saving',
  error: 'status.saveFailed',
} satisfies Record<SaveStatus, TranslationKey>;
export const syncKeys = {
  idle: 'status.ready',
  syncing: 'status.syncing',
  synced: 'status.synced',
  pending: 'status.pending',
  permission: 'status.permission',
  failed: 'status.failed',
  issues: 'status.issues',
} satisfies Record<SyncPhase, TranslationKey>;
export const accessKeys = {
  available: 'status.ready',
  'reauthorization-required': 'status.reauthorize',
  unreachable: 'status.unreachable',
  unrecoverable: 'status.unrecoverable',
  forbidden: 'status.permission',
} satisfies Record<ConnectionAccessCode, TranslationKey>;
export function statusLabel(model: StatusModel): string {
  const labels = [t(saveKeys[model.save])];
  if (model.access && model.access.code !== 'available')
    labels.push(t(accessKeys[model.access.code]));
  const sync = model.sync;
  if (sync) labels.push(t(syncKeys[sync.phase]));
  if (model.hasIssues) labels.push(t('sync.showIssues'));
  return [...new Set(labels)].join(' · ');
}
