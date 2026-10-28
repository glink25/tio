import { t } from '@tio/i18n';
import {
  Button,
  Modal,
  ChoiceSelect,
  LanguageSwitcher,
  SettingsGroup,
  SettingsRow,
  SettingsAction,
  cn,
  useOverlayBack,
} from '@tio/ui';
import { Palette, HardDrive, ArrowRightLeft } from 'lucide-react';
import { useState } from 'react';

import { ConnectionInfo } from '../components/identity';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { usePresentation, setPresentation } from '../services/browser-presentation';
const sections = ['general', 'storage', 'transfer'] as const;
const icons = { general: Palette, storage: HardDrive, transfer: ArrowRightLeft };
export function SettingsDialog({ model: m }: { model: WorkspaceController }) {
  const [section, setSection] = useState<(typeof sections)[number] | null>(null);
  useOverlayBack(() => m.setSettingsOpen(false));
  const presentation = usePresentation();
  const selected = section ?? 'general';
  const actions = m.session ? m.workspaceActions(m.session) : {};
  const label = (key: typeof selected) => t(`ui.${key}`);
  return (
    <Modal
      wide
      trackHistory={false}
      title={t('ui.settings')}
      close={() => m.setSettingsOpen(false)}
    >
      <div className="-m-6 flex min-h-[60dvh] flex-col md:flex-row">
        <nav
          aria-label={t('ui.settings')}
          className={cn('shrink-0 space-y-1 bg-surface p-4 md:w-52', section && 'hidden md:block')}
        >
          {sections.map((key) => {
            const Icon = icons[key];
            return (
              <Button
                key={key}
                aria-current={key === selected ? 'page' : undefined}
                className={cn(
                  'w-full justify-start text-sm',
                  key === selected && 'bg-surface-hover text-ink',
                )}
                onClick={() => setSection(key)}
              >
                <Icon size={16} />
                {label(key)}
              </Button>
            );
          })}
        </nav>
        <div className={cn('min-w-0 flex-1 px-6 py-7 md:px-10', !section && 'hidden md:block')}>
          <Button className="mb-4 md:hidden" onClick={() => setSection(null)}>
            ← {t('ui.back')}
          </Button>
          <h2 className="mb-8 text-xl font-semibold">{label(selected)}</h2>
          <div className="space-y-9">
            {selected === 'general' && (
              <SettingsGroup title={t('settings.preferences')}>
                <SettingsRow
                  title={t('ui.appearance')}
                  description={t('settings.appearanceDescription')}
                >
                  <ChoiceSelect
                    label={t('ui.appearance')}
                    value={presentation.themePreference}
                    className="w-36"
                    search={false}
                    options={(['light', 'dark', 'system'] as const).map((id) => ({
                      id,
                      text: t(`theme.${id}`),
                      label: t(`theme.${id}`),
                    }))}
                    onValueChange={(value) =>
                      setPresentation({ themePreference: value as 'light' | 'dark' | 'system' })
                    }
                  />
                </SettingsRow>
                <SettingsRow
                  title={t('common.language')}
                  description={t('settings.languageDescription')}
                >
                  <LanguageSwitcher
                    value={presentation.locale}
                    onChange={(locale) => setPresentation({ locale })}
                  />
                </SettingsRow>
              </SettingsGroup>
            )}
            {selected === 'storage' && (
              <>
                <SettingsGroup title={t('settings.connection')}>
                  <div className="py-4">
                    <ConnectionInfo identity={m.identity} />
                  </div>
                </SettingsGroup>
                <SettingsGroup title={t('workspace.manage')}>
                  {actions.share && (
                    <SettingsRow title={t('workspace.share')}>
                      <SettingsAction onClick={() => m.requestWorkspaceAction(m.session!, 'share')}>
                        {t('workspace.share')}
                      </SettingsAction>
                    </SettingsRow>
                  )}
                  <SettingsRow title={t('workspace.disconnect')}>
                    <SettingsAction onClick={() => m.setLogoutOpen(true)}>
                      {t('workspace.disconnect')}
                    </SettingsAction>
                  </SettingsRow>
                  {actions.delete && (
                    <SettingsRow title={t('workspace.delete')}>
                      <SettingsAction
                        danger
                        onClick={() => m.requestWorkspaceAction(m.session!, 'delete')}
                      >
                        {t('workspace.delete')}
                      </SettingsAction>
                    </SettingsRow>
                  )}
                </SettingsGroup>
              </>
            )}
            {selected === 'transfer' && (
              <SettingsGroup title={t('settings.data')}>
                <SettingsRow
                  title={t('workspace.import')}
                  description={t('settings.importDescription')}
                >
                  <SettingsAction onClick={() => m.importRef.current?.click()}>
                    {t('workspace.import')}
                  </SettingsAction>
                </SettingsRow>
                <SettingsRow
                  title={t('workspace.exportFull')}
                  description={t('settings.exportDescription')}
                >
                  <SettingsAction onClick={() => void m.download()}>
                    {t('workspace.exportFull')}
                  </SettingsAction>
                </SettingsRow>
                <SettingsRow
                  title={t('workspace.exportMarkdown')}
                  description={t('settings.markdownDescription')}
                >
                  <SettingsAction onClick={() => void m.download(true)}>
                    {t('workspace.exportMarkdown')}
                  </SettingsAction>
                </SettingsRow>
              </SettingsGroup>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
