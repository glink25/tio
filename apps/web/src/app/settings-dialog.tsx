import { t } from '@tio/i18n';
import {
  Modal,
  ChoiceSelect,
  LanguageSwitcher,
  SettingsGroup,
  SettingsRow,
  SettingsAction,
} from '@tio/ui';
import { Palette, HardDrive, ArrowRightLeft } from 'lucide-react';
import { useId } from 'react';

import { ConnectionInfo } from '../components/identity';
import type { WorkspaceController } from '../features/workspace/use-workspace';
import { usePresentation, setPresentation } from '../services/browser-presentation';
const sections = ['general', 'storage', 'transfer'] as const;
const icons = { general: Palette, storage: HardDrive, transfer: ArrowRightLeft };
export function SettingsDialog({ model: m }: { model: WorkspaceController }) {
  const id = useId();
  const presentation = usePresentation();
  const actions = m.session ? m.workspaceActions(m.session) : {};
  const label = (key: (typeof sections)[number]) => t(`ui.${key}`);
  return (
    <Modal wide title={t('ui.settings')} close={() => m.setSettingsOpen(false)}>
      <div className="tio-settings flex min-h-0 gap-8">
        <nav
          aria-label={t('ui.settings')}
          className="sticky top-0 hidden w-44 shrink-0 space-y-1 self-start md:block"
        >
          {sections.map((key) => {
            const Icon = icons[key];
            return (
              <a
                key={key}
                href={`#${id}-${key}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-secondary no-underline hover:bg-surface-hover"
                onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(`${id}-${key}`)?.scrollIntoView({ block: 'start' });
                }}
              >
                <Icon size={16} />
                {label(key)}
              </a>
            );
          })}
        </nav>
        <div className="min-w-0 flex-1 space-y-7 md:space-y-9">
          <section id={`${id}-general`} className="scroll-mt-4 space-y-4">
            <h2 className="text-lg font-semibold">{label('general')}</h2>
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
          </section>
          <section id={`${id}-storage`} className="scroll-mt-4 space-y-4">
            <h2 className="text-lg font-semibold">{label('storage')}</h2>
            <SettingsGroup title={t('settings.connection')}>
              <div className="py-4">
                <ConnectionInfo identity={m.identity} />
              </div>
            </SettingsGroup>
            {m.hasReplicaSync && m.workspace && (
              <SettingsGroup title={t('settings.synchronization')}>
                <SettingsRow
                  title={t('settings.manualSync')}
                  description={t('settings.manualSyncDescription')}
                >
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={m.manualSync}
                    aria-label={t('settings.manualSync')}
                    className="h-4 w-4 accent-ink"
                    checked={m.manualSync}
                    disabled={!m.canSetManualSync}
                    onChange={(event) =>
                      m.patch(m.workspace!, { manualSync: event.target.checked })
                    }
                  />
                </SettingsRow>
              </SettingsGroup>
            )}
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
          </section>
          <section id={`${id}-transfer`} className="scroll-mt-4 space-y-4">
            <h2 className="text-lg font-semibold">{label('transfer')}</h2>
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
          </section>
        </div>
      </div>
    </Modal>
  );
}
