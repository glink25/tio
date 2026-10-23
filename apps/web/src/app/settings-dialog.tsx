import { t, translateStatus } from '@tio/i18n';
import { Button, Modal, ThemeSwitcher, LanguageSwitcher, cn } from '@tio/ui';
import { useState } from 'react';

import type { WorkspaceController } from '../features/workspace/use-workspace';
import { usePresentation, setPresentation } from '../services/browser-presentation';
const sections = ['appearance', 'workspace', 'storage', 'transfer'] as const;
export function SettingsDialog({ model: m }: { model: WorkspaceController }) {
  const [section, setSection] = useState<(typeof sections)[number] | null>(null);
  const presentation = usePresentation();
  const selected = section ?? 'appearance';
  const label = (key: typeof selected) =>
    key === 'workspace' ? t('workspace.name') : t(`ui.${key}`);
  return (
    <Modal wide title={t('ui.settings')} close={() => m.setSettingsOpen(false)}>
      <div className="flex min-h-[55dvh] flex-col gap-6 md:flex-row">
        <nav className={cn('shrink-0 space-y-1 md:w-48', section && 'hidden md:block')}>
          {sections.map((key) => (
            <Button
              key={key}
              className={cn('w-full justify-start', key === selected && 'bg-surface-hover')}
              onClick={() => setSection(key)}
            >
              {label(key)}
            </Button>
          ))}
        </nav>
        <section className={cn('min-w-0 flex-1 md:px-7', !section && 'hidden md:block')}>
          <Button className="mb-4 md:hidden" onClick={() => setSection(null)}>
            ← {t('ui.back')}
          </Button>
          <h2 className="mb-7 text-2xl font-semibold">{label(selected)}</h2>
          {selected === 'appearance' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-line pb-5">
                <span>{t('ui.appearance')}</span>
                <ThemeSwitcher
                  value={presentation.theme}
                  onChange={(theme) => setPresentation({ theme })}
                />
              </div>
              <div className="flex items-center justify-between">
                <span>{t('common.language')}</span>
                <LanguageSwitcher
                  value={presentation.locale}
                  onChange={(locale) => setPresentation({ locale })}
                />
              </div>
            </div>
          )}
          {selected === 'workspace' && (
            <div className="space-y-4">
              <p className="text-sm text-muted">{t('ui.isolated')}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = new FormData(e.currentTarget).get('name');
                  if (typeof name === 'string') m.renameWorkspace(name);
                }}
              >
                <label className="block text-sm">
                  {t('workspace.rename')}
                  <input
                    name="name"
                    required
                    defaultValue={m.workspace?.name}
                    className="mt-2 w-full"
                  />
                </label>
                <Button variant="primary" className="mt-4" type="submit">
                  {t('ui.done')}
                </Button>
              </form>
            </div>
          )}
          {selected === 'storage' && (
            <div className="space-y-4">
              <p>{m.connection?.name ?? t('workspace.localStorage')}</p>
              <p className="text-sm text-muted">
                {translateStatus(m.saveStatus)} · {translateStatus(m.syncStatus)}
              </p>
              {m.supportsSync && (
                <Button variant="outline" onClick={() => void m.syncNow()}>
                  {t('sync.showIssues')}
                </Button>
              )}
              {m.issues.length > 0 && (
                <Button onClick={() => m.setIssuesOpen(true)}>{t('sync.showIssues')}</Button>
              )}
              <Button className="block" onClick={() => void m.retrySave()}>
                {t('common.retry')}
              </Button>
              <Button className="block" onClick={() => void m.logout()}>
                {t('workspace.disconnect')}
              </Button>
            </div>
          )}
          {selected === 'transfer' && (
            <div className="flex flex-col items-start gap-3">
              <Button variant="outline" onClick={() => m.importRef.current?.click()}>
                {t('workspace.import')}
              </Button>
              <Button variant="outline" onClick={() => void m.download()}>
                {t('workspace.exportFull')}
              </Button>
              <Button variant="outline" onClick={() => void m.download(true)}>
                {t('workspace.exportMarkdown')}
              </Button>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
