import { t } from '@tio/i18n';
import { Button, Modal } from '@tio/ui';

import type { WorkspaceController } from '../features/workspace/use-workspace';

export function WorkspaceActionDialog({ model: m }: { model: WorkspaceController }) {
  const target = m.workspaceAction;
  if (!target) return null;
  const action = m.workspaceActions(target.session)[target.operation];
  if (!action) return null;
  return (
    <Modal mobilePlacement="center" title={action.title} close={m.closeWorkspaceAction}>
      <p className="mb-3 font-medium break-words">{target.session.name}</p>
      <p className="text-sm whitespace-pre-line text-muted">{action.description}</p>
      {m.actionError && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {m.actionError}
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        {m.actionError && m.canReauthorize && (
          <Button disabled={m.actionBusy} onClick={() => void m.restoreAuthorization()}>
            {t('status.reauthorize')}
          </Button>
        )}
        <Button disabled={m.actionBusy} onClick={m.closeWorkspaceAction}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={m.actionBusy}
          onClick={() => void m.executeWorkspaceAction()}
        >
          {action.confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
