import { IconButton, Tooltip } from '@tio/ui';
import { AlertCircle, Check, LoaderCircle, Cloud } from 'lucide-react';

import { statusLabel } from '../features/workspace/status';
import type { WorkspaceController } from '../features/workspace/use-workspace';

const icons = { attention: AlertCircle, busy: LoaderCircle, cloud: Cloud, saved: Check };
export function SyncStatus({ model: m }: { model: WorkspaceController }) {
  const label = statusLabel(m.status);
  const Icon = icons[m.status.visual];
  return (
    <Tooltip label={label}>
      <IconButton
        label={label}
        className={m.status.visual === 'attention' ? 'text-red-600' : 'text-muted'}
        onClick={() => void m.activateStatus()}
      >
        <Icon size={17} className={m.status.visual === 'busy' ? 'animate-spin' : ''} />
      </IconButton>
    </Tooltip>
  );
}
