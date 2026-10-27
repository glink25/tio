import { titleOf } from '@tio/core';
import { t, errorMessage } from '@tio/i18n';
import { Button, Modal } from '@tio/ui';
import { FileText } from 'lucide-react';

import { EmptyStateIllustration } from '../components/empty-state-illustration';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { SearchDialog } from './search-dialog';
import { SettingsDialog } from './settings-dialog';
export function WorkspaceDialogs({ model: m }: { model: WorkspaceController }) {
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
      {m.issuesOpen && (
        <Modal title={t('sync.issues')} close={() => m.setIssuesOpen(false)}>
          {m.issues.map((issue, i) => (
            <div className="border-b border-line py-3 text-sm" key={i}>
              <strong>{errorMessage(issue.error)}</strong>
              <code className="mt-2 block text-xs break-all text-muted">{issue.path}</code>
              {issue.code === 'permission' && issue.id && (
                <div className="flex gap-2">
                  <Button onClick={() => void m.syncNow()}>{t('common.retry')}</Button>
                  <Button onClick={() => void m.download()}>{t('workspace.exportFull')}</Button>
                  <Button onClick={() => void m.discardDraft(issue.id!)}>
                    {t('sync.discardDraft')}
                  </Button>
                </div>
              )}
              {issue.code === 'missing' && issue.id && (
                <Button onClick={() => void m.restoreFile(issue.id!)}>{t('sync.restore')}</Button>
              )}
            </div>
          ))}
        </Modal>
      )}
      {m.moveTarget && (
        <Modal title={t('workspace.move')} close={() => m.setMoveTarget(null)}>
          <div className="flex flex-col">
            <Button
              className="justify-start"
              onClick={() => {
                m.movePage(m.moveTarget!, null);
                m.setMoveTarget(null);
              }}
            >
              {t('workspace.root')}
            </Button>
            {m.nav
              .filter((o) => o.id !== m.moveTarget)
              .map((o) => (
                <Button
                  className="justify-start"
                  key={o.id}
                  onClick={() => {
                    m.movePage(m.moveTarget!, o.id);
                    m.setMoveTarget(null);
                  }}
                >
                  <FileText size={16} />
                  {titleOf(o)}
                </Button>
              ))}
          </div>
        </Modal>
      )}
    </>
  );
}
