import { LoadingSkeleton, useOverlayBack } from '@tio/ui';
import { lazy, Suspense, useRef, useEffect } from 'react';
const AutomationDialog = lazy(() => import('../features/automation/panel'));
import { titleOf } from '@tio/core';
import { t } from '@tio/i18n';
import { Button, Modal, OptionsPanel } from '@tio/ui';
import { EmptyStateIllustration } from '@tio/ui';
import { FileText } from 'lucide-react';

import type { WorkspaceController } from '../features/workspace/use-workspace';
import { SearchDialog } from './search-dialog';
import { SettingsDialog } from './settings-dialog';
export function WorkspaceDialogs({ model: m }: { model: WorkspaceController }) {
  const panelOpen = m.settingsOpen || m.trashOpen || m.automationOpen;
  const previous = useRef(panelOpen);
  useEffect(() => {
    if (previous.current && !panelOpen)
      requestAnimationFrame(() =>
        document.querySelector<HTMLButtonElement>('[data-settings-entry]')?.focus(),
      );
    previous.current = panelOpen;
  }, [panelOpen]);
  return (
    <>
      {m.renaming && (
        <Modal
          mobilePlacement="center"
          title={t('workspace.rename')}
          close={() => m.setRenaming(false)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = new FormData(e.currentTarget).get('name');
              if (typeof name === 'string') m.renameWorkspace(name);
            }}
          >
            <input
              name="name"
              aria-label={t('workspace.rename')}
              defaultValue={m.workspace?.name}
              required
              className="w-full"
            />
            <Button type="submit" className="mt-4" variant="primary">
              {t('common.edit')}
            </Button>
          </form>
        </Modal>
      )}
      {m.searching && <SearchDialog model={m} />}
      {m.automationOpen && m.runtime && m.session && <AutomationEntry model={m} />}
      {m.settingsOpen && <SettingsDialog model={m} />}
      {m.renameId && (
        <Modal mobilePlacement="center" title={t('ui.rename')} close={() => m.setRenameId(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const o = m.objects.find((o) => o.id === m.renameId);
              const name = new FormData(e.currentTarget).get('name');
              if (o && typeof name === 'string')
                m.patch(o, o.type === 'database' ? { name } : { title: name });
              m.setRenameId(null);
            }}
          >
            <input
              name="name"
              aria-label={t('ui.rename')}
              className="w-full"
              defaultValue={titleOf(m.objects.find((o) => o.id === m.renameId)!)}
              required
            />
            <Button type="submit" variant="primary" className="mt-4">
              {t('ui.done')}
            </Button>
          </form>
        </Modal>
      )}
      {m.trashOpen && (
        <Modal title={t('ui.trash')} close={() => m.setTrashOpen(false)}>
          {m.objects
            .filter((o) => o.deleted && ['page', 'database', 'record'].includes(o.type))
            .map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between gap-3 border-b border-line py-3"
              >
                <span className="truncate">{titleOf(o)}</span>
                <Button onClick={() => m.restoreObject(o.id)}>{t('ui.restore')}</Button>
              </div>
            ))}
          {!m.objects.some((o) => o.deleted && ['page', 'database', 'record'].includes(o.type)) && (
            <div className="flex justify-center py-12">
              <EmptyStateIllustration kind="trash" />
            </div>
          )}
        </Modal>
      )}
      {m.moveTarget && (
        <Modal title={t('workspace.move')} close={() => m.setMoveTarget(null)}>
          <OptionsPanel
            label={t('workspace.move')}
            options={[
              { id: '$root', text: t('workspace.root'), label: t('workspace.root') },
              ...m.nav
                .filter((o) => o.id !== m.moveTarget)
                .map((o) => ({
                  id: o.id,
                  text: titleOf(o),
                  label: titleOf(o),
                  icon: <FileText size={16} />,
                })),
            ]}
            onClose={() => m.setMoveTarget(null)}
            onSelect={(id) => {
              m.movePage(m.moveTarget!, id === '$root' ? null : id);
              m.setMoveTarget(null);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function AutomationEntry({ model: m }: { model: WorkspaceController }) {
  const requestClose = useRef(() => m.setAutomationOpen(false));
  useOverlayBack(() => requestClose.current());
  return (
    <Suspense
      fallback={
        <Modal
          trackHistory={false}
          title={t('automation.center')}
          close={() => m.setAutomationOpen(false)}
        >
          <LoadingSkeleton layout="inline" />
        </Modal>
      }
    >
      <AutomationDialog
        runtime={m.runtime!}
        workspaceId={m.session!.workspaceId}
        close={() => m.setAutomationOpen(false)}
        registerClose={(close) => {
          requestClose.current = close;
        }}
      />
    </Suspense>
  );
}
