import { t } from '@tio/i18n';
import { ChoiceSelect, IconButton, LanguageSwitcher, Popover } from '@tio/ui';
import { Settings } from 'lucide-react';

import { setPresentation, usePresentation } from '../services/browser-presentation';

export function WelcomeSettings() {
  const presentation = usePresentation();
  return (
    <Popover
      label={t('ui.settings')}
      align="end"
      mobilePlacement="anchor"
      className="w-72 p-4"
      trigger={
        <IconButton label={t('ui.settings')} className="size-11 text-inherit">
          <Settings size={19} />
        </IconButton>
      }
    >
      <div className="space-y-4">
        <h2 className="text-sm font-semibold">{t('settings.preferences')}</h2>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-secondary">{t('ui.appearance')}</span>
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
            onValueChange={(theme) =>
              setPresentation({ themePreference: theme as 'light' | 'dark' | 'system' })
            }
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-secondary">{t('common.language')}</span>
          <LanguageSwitcher
            value={presentation.locale}
            onChange={(locale) => setPresentation({ locale })}
          />
        </div>
      </div>
    </Popover>
  );
}
