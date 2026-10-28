import { t, errorMessage } from '@tio/i18n';
import { Button, IconButton, Popover, LoadingIndicator } from '@tio/ui';
import { AlertCircle, Check, LoaderCircle, Cloud } from 'lucide-react';
import { useState } from 'react';

import { statusLabel } from '../features/workspace/status';
import type { WorkspaceController } from '../features/workspace/use-workspace';

const icons = { attention: AlertCircle, busy: LoaderCircle, cloud: Cloud, saved: Check };
export function SyncStatus({ model: m }: { model: WorkspaceController }) {
  const [authorizing, setAuthorizing] = useState(false);
  const label = statusLabel(m.status);
  const Icon = icons[m.status.visual];
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
      <div className="max-h-[min(28rem,70dvh)] space-y-3 overflow-y-auto break-words">
        <p className="text-sm" aria-live="polite">
          {m.status.save === 'loading' ? <LoadingIndicator label={label} /> : label}
        </p>
        {m.hasReplicaSync && (
          <Button variant="outline" disabled={m.syncing} onClick={() => void m.syncWorkspace()}>
            {t('sync.now')}
          </Button>
        )}
        {errors.map((error) => (
          <p key={error} className="text-sm text-secondary">
            {error}
          </p>
        ))}
        {m.issues
          .filter((issue) => issue.path)
          .map((issue, index) => (
            <div key={index} className="border-t border-line pt-2 text-xs">
              <p>{errorMessage(issue.error)}</p>
              <code className="mt-1 block break-all text-muted">{issue.path}</code>
            </div>
          ))}
        {m.status.access?.code === 'reauthorization-required' && m.canReauthorize && (
          <Button
            variant="outline"
            disabled={authorizing}
            onClick={() => {
              setAuthorizing(true);
              void m.restoreAuthorization().finally(() => setAuthorizing(false));
            }}
          >
            {t('sync.authorize')}
          </Button>
        )}
      </div>
    </Popover>
  );
}
