import type { ConnectionAccessCode } from '@tio/core';
import { t, type TranslationKey } from '@tio/i18n';
import type { SyncPhase, SyncSnapshot } from '@tio/sync';
import type { WorkspaceRuntime } from '@tio/workspace';

export type SaveStatus = ReturnType<WorkspaceRuntime['state']['getState']>['status'];
export type StatusAction = 'retry-save' | 'reauthorize' | 'issues' | 'sync' | 'none';
export interface StatusModel {
  visual: 'attention' | 'busy' | 'cloud' | 'saved';
  action: StatusAction;
  save: SaveStatus;
  sync?: SyncSnapshot;
  hasIssues: boolean;
}
export function statusModel(
  save: SaveStatus,
  sync: SyncSnapshot,
  supportsSync: boolean,
  hasIssues: boolean,
): StatusModel {
  const accessProblem = supportsSync && sync.access && sync.access.code !== 'available';
  const attention =
    save === 'error' ||
    hasIssues ||
    accessProblem ||
    (supportsSync &&
      (sync.phase === 'failed' || sync.phase === 'permission' || sync.phase === 'issues'));
  return {
    save,
    sync: supportsSync ? sync : undefined,
    hasIssues,
    visual: attention
      ? 'attention'
      : save === 'loading' || save === 'saving' || (supportsSync && sync.phase === 'syncing')
        ? 'busy'
        : supportsSync
          ? 'cloud'
          : 'saved',
    action:
      save === 'error'
        ? 'retry-save'
        : supportsSync && sync.access?.code === 'reauthorization-required'
          ? 'reauthorize'
          : hasIssues
            ? 'issues'
            : supportsSync
              ? 'sync'
              : 'none',
  };
}
const saveKeys = {
  loading: 'status.loading',
  saved: 'status.saved',
  saving: 'status.saving',
  error: 'status.saveFailed',
} satisfies Record<SaveStatus, TranslationKey>;
const syncKeys = {
  idle: 'status.ready',
  syncing: 'status.syncing',
  synced: 'status.synced',
  pending: 'status.pending',
  permission: 'status.permission',
  failed: 'status.failed',
  issues: 'status.issues',
} satisfies Record<SyncPhase, TranslationKey>;
const accessKeys = {
  available: 'status.ready',
  'reauthorization-required': 'status.reauthorize',
  unreachable: 'status.unreachable',
  unrecoverable: 'status.unrecoverable',
  forbidden: 'status.permission',
} satisfies Record<ConnectionAccessCode, TranslationKey>;
export function statusLabel(model: StatusModel): string {
  const labels = [t(saveKeys[model.save])];
  const sync = model.sync;
  if (sync) {
    if (sync.access && sync.access.code !== 'available')
      labels.push(t(accessKeys[sync.access.code]));
    const progress = sync.phase === 'syncing' ? sync.progress : undefined;
    labels.push(
      t(syncKeys[sync.phase]) + (progress ? ` ${progress.loaded}/${progress.total}` : ''),
    );
  }
  if (model.hasIssues) labels.push(t('sync.showIssues'));
  return [...new Set(labels)].join(' · ');
}
