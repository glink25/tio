import { t, translateStatus } from '@tio/i18n';
import { IconButton, Tooltip } from '@tio/ui';
import { AlertCircle, Check, LoaderCircle, Cloud } from 'lucide-react';

import type { WorkspaceController } from '../features/workspace/use-workspace';

export function SyncStatus({ model: m }: { model: WorkspaceController }) {
  const failed = m.saveStatus === '本地保存失败';
  const needsAttention =
    failed ||
    m.issues.length > 0 ||
    [
      'reauthorization-required',
      'unreachable',
      'unrecoverable',
      'forbidden',
      'failed',
      'permission',
      'issues',
    ].includes(m.syncStatus);
  const pending = m.saveStatus === '正在保存本地' || m.syncStatus.startsWith('syncing');
  const label = [
    ...new Set([
      translateStatus(m.saveStatus),
      ...(m.supportsSync ? [translateStatus(m.syncStatus)] : []),
      ...(m.issues.length ? [t('sync.showIssues')] : []),
    ]),
  ].join(' · ');
  const Icon = needsAttention
    ? AlertCircle
    : pending
      ? LoaderCircle
      : m.supportsSync
        ? Cloud
        : Check;
  return (
    <Tooltip label={label}>
      <IconButton
        label={label}
        className={needsAttention ? 'text-red-600' : 'text-muted'}
        onClick={() => {
          if (failed) void m.retrySave();
          else if (m.syncStatus === 'reauthorization-required') void m.syncNow();
          else if (m.issues.length) m.setIssuesOpen(true);
          else if (m.supportsSync) void m.syncNow();
        }}
      >
        <Icon size={17} className={pending && !needsAttention ? 'animate-spin' : ''} />
      </IconButton>
    </Tooltip>
  );
}
