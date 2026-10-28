import { t } from '@tio/i18n';
import { Button, Modal, ThemeSwitcher, LanguageSwitcher, cn } from '@tio/ui';
import { useState } from 'react';

import { Identity } from '../components/identity';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { usePresentation, setPresentation } from '../services/browser-presentation';
const sections = ['general', 'storage', 'transfer'] as const;
export function SettingsDialog({ model: m }: { model: WorkspaceController }) {
  const [section, setSection] = useState<(typeof sections)[number] | null>(null);
  const presentation = usePresentation();
  const selected = section ?? 'general';
  const label = (key: typeof selected) => t(`ui.${key}`);
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
          <Button
            className="w-full justify-start"
            onClick={() => {
              m.setTrashOpen(true);
            }}
          >
            {t('ui.trash')}
          </Button>
        </nav>
        <section className={cn('min-w-0 flex-1 md:px-7', !section && 'hidden md:block')}>
          <Button className="mb-4 md:hidden" onClick={() => setSection(null)}>
            ← {t('ui.back')}
          </Button>
          <h2 className="mb-7 text-2xl font-semibold">{label(selected)}</h2>
          {selected === 'general' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-line pb-5">
                <span>{t('ui.appearance')}</span>
                <ThemeSwitcher
                  value={presentation.themePreference}
                  onChange={(theme) => setPresentation({ themePreference: theme })}
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
          {selected === 'storage' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Identity identity={m.identity} />
              </div>
              {m.identity?.details.map((detail) => (
                <div key={detail.label} className="text-sm">
                  <span className="text-muted">{detail.label}</span> · {detail.value}
                </div>
              ))}
              <Button className="block" onClick={() => m.setLogoutOpen(true)}>
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
