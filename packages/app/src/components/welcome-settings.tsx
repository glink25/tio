import { t } from '@tio/i18n';
import { IconButton, OverlayPresence } from '@tio/ui';
import { Settings } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';

const SettingsDialog = lazy(() =>
  import('../app/settings-dialog').then((module) => ({ default: module.SettingsDialog })),
);

export function WelcomeSettings() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        label={t('ui.settings')}
        className="size-11 text-inherit"
        onClick={() => setOpen(true)}
      >
        <Settings size={19} />
      </IconButton>
      <Suspense fallback={null}>
        <OverlayPresence>{open && <SettingsDialog close={() => setOpen(false)} />}</OverlayPresence>
      </Suspense>
    </>
  );
}
