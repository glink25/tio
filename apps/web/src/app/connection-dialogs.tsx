import { t } from '@tio/i18n';
import { Button, Modal } from '@tio/ui';

import type { WorkspaceController } from '../features/workspace/use-workspace';

export function ConnectionDialogs({ model: m }: { model: WorkspaceController }) {
  return (
    <>
      {m.creating && (
        <Modal
          mobilePlacement="center"
          title={t('workspace.new')}
          close={() => {
            if (!m.busy) m.setCreating(false);
          }}
        >
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const input = event.currentTarget.elements.namedItem('name') as HTMLInputElement;
              if (!input.value.trim()) {
                input.setCustomValidity(t('workspace.nameRequired'));
                input.reportValidity();
                return;
              }
              void m.createWorkspace(input.value);
            }}
          >
            <input
              name="name"
              aria-label={t('workspace.name')}
              required
              disabled={m.busy}
              className="w-full"
              onInput={(event) => event.currentTarget.setCustomValidity('')}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" disabled={m.busy} onClick={() => m.setCreating(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={m.busy}>
                {t(m.busy ? 'workspace.creating' : 'common.create')}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {m.logoutOpen && (
        <Modal
          title={t('workspace.disconnect')}
          close={() => {
            if (!m.loggingOut) m.setLogoutOpen(false);
          }}
        >
          <p className="text-sm">{t('workspace.logoutWarning')}</p>
          {m.identity?.localOnly && <p className="mt-3 text-sm">{t('workspace.localWarning')}</p>}
          {m.logoutError && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {m.logoutError}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button disabled={m.loggingOut} onClick={() => m.setLogoutOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={m.loggingOut && !m.logoutError}
              onClick={() => void m.logout()}
            >
              {t(
                m.logoutError
                  ? 'common.retry'
                  : m.loggingOut
                    ? 'workspace.clearing'
                    : 'workspace.disconnect',
              )}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
