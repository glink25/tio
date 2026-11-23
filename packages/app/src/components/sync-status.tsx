import { t, errorMessage } from '@tio/i18n';
import { Button, IconButton, Popover, cn } from '@tio/ui';
import { AlertCircle, Check, LoaderCircle, Cloud, HardDrive, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { accessKeys, saveKeys, statusLabel, syncKeys } from '../features/workspace/status';
import type { WorkspaceController } from '../features/workspace/use-workspace';

const icons = { attention: AlertCircle, busy: LoaderCircle, cloud: Cloud, saved: Check };
export function SyncStatus({ model: m }: { model: WorkspaceController }) {
  const [authorizing, setAuthorizing] = useState(false);
  const label = statusLabel(m.status);
  const Icon = icons[m.status.visual];
  const sync = m.status.sync;
  const access = m.status.access;
  const syncing = sync?.phase === 'syncing';
  const progress = syncing ? sync.progress : undefined;
  const percent =
    progress &&
    Number.isFinite(progress.total) &&
    progress.total > 0 &&
    Number.isFinite(progress.loaded)
      ? Math.min(100, Math.max(0, (progress.loaded / progress.total) * 100))
      : undefined;
  const primary =
    access && access.code !== 'available'
      ? t(accessKeys[access.code])
      : m.status.save !== 'saved'
        ? t(saveKeys[m.status.save])
        : sync
          ? t(syncKeys[sync.phase])
          : t(saveKeys[m.status.save]);
  const errors = [
    ...new Set(
      [m.saveError, m.statusError, ...m.issues.map((issue) => issue.error)]
        .filter(Boolean)
        .map((error) => errorMessage(error)),
    ),
  ];
  const tooltip = [label, ...errors].join('\n');
  return (
    <Popover
      label={t('sync.details')}
      tooltip={tooltip}
      align="end"
      mobilePlacement="anchor"
      className="!w-72 !p-0"
      trigger={
        <IconButton
          label={label}
          className={
            m.status.visual === 'attention' ? 'text-red-600 dark:text-red-400' : 'text-muted'
          }
        >
          <Icon size={17} className={m.status.visual === 'busy' ? 'animate-spin' : ''} />
        </IconButton>
      }
    >
      <div className="max-h-[min(28rem,70dvh)] overflow-y-auto break-words">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <span
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface text-secondary',
              m.status.visual === 'attention' && 'text-red-600 dark:text-red-400',
            )}
          >
            <Icon size={18} className={m.status.visual === 'busy' ? 'animate-spin' : ''} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium" aria-live="polite">
              {primary}
            </p>
            <p className="mt-0.5 text-xs text-muted">{t('sync.details')}</p>
          </div>
        </div>
        <div className="space-y-2 px-4 pb-4 text-xs">
          <div className="flex items-center gap-2 text-secondary">
            <HardDrive size={14} className="shrink-0" />
            <span>{t('sync.local')}</span>
            <span className="ml-auto text-right text-ink">{t(saveKeys[m.status.save])}</span>
          </div>
          {access && (
            <div className="flex items-center gap-2 text-secondary">
              <ShieldCheck size={14} className="shrink-0" />
              <span>{t('sync.connection')}</span>
              <span className="ml-auto text-right text-ink">
                {access.code === 'available' ? t('sync.connected') : t(accessKeys[access.code])}
              </span>
            </div>
          )}
          {sync && (
            <div className="flex items-center gap-2 text-secondary">
              <Cloud size={14} className="shrink-0" />
              <span>{t('sync.remote')}</span>
              <span className="ml-auto text-right text-ink">{t(syncKeys[sync.phase])}</span>
            </div>
          )}
          {syncing && (
            <div className="pt-1">
              <progress
                aria-label={t('status.syncing')}
                max={100}
                value={percent}
                className={cn(
                  'tio-sync-progress block h-1.5 w-full overflow-hidden rounded-full',
                  percent === undefined && 'motion-safe:animate-pulse',
                )}
              />
            </div>
          )}
        </div>
        {errors.length > 0 && (
          <div className="space-y-2 border-t border-line px-4 py-3">
            {errors.map((error) => (
              <p key={error} className="text-xs text-secondary">
                {error}
              </p>
            ))}
            {m.issues.some((issue) => issue.path) && (
              <details className="text-xs text-secondary">
                <summary className="cursor-pointer py-1 font-medium text-ink">
                  {t('sync.showIssues')}
                </summary>
                <div className="mt-2 space-y-3">
                  {m.issues
                    .filter((issue) => issue.path)
                    .map((issue, index) => (
                      <div key={index}>
                        <p>{errorMessage(issue.error)}</p>
                        <code className="mt-1 block break-all text-muted">{issue.path}</code>
                      </div>
                    ))}
                </div>
              </details>
            )}
          </div>
        )}
        {(m.hasReplicaSync ||
          (access?.code === 'reauthorization-required' && m.canReauthorize)) && (
          <div className="flex flex-wrap gap-2 border-t border-line bg-surface/50 px-3 py-2">
            {m.hasReplicaSync && (
              <Button
                className="flex-1 text-xs"
                disabled={m.syncing}
                onClick={() => void m.syncWorkspace()}
              >
                {m.syncing && <LoaderCircle size={14} className="animate-spin" />}
                {t(m.syncing ? 'status.syncing' : 'sync.now')}
              </Button>
            )}
            {access?.code === 'reauthorization-required' && m.canReauthorize && (
              <Button
                variant="outline"
                className="flex-1 text-xs"
                disabled={authorizing}
                onClick={() => {
                  setAuthorizing(true);
                  void m.restoreAuthorization().finally(() => setAuthorizing(false));
                }}
              >
                {authorizing && <LoaderCircle size={14} className="animate-spin" />}
                {t('sync.authorize')}
              </Button>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}
