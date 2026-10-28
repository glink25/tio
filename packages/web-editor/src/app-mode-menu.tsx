import { canToggleAppMode, isAppMode, type TioObject } from '@tio/core';
import { useT } from '@tio/i18n';
import { MenuItem } from '@tio/ui';
import { AppWindow } from 'lucide-react';

/** The editor owns eligibility, permissions and commands; hosts only place this item. */
export function AppModeMenuItem({
  page,
  disabled,
  onToggle,
}: {
  page: TioObject;
  disabled: boolean;
  onToggle: () => void;
}) {
  const t = useT();
  if (!canToggleAppMode(page)) return null;
  return (
    <MenuItem disabled={disabled} onSelect={onToggle}>
      <AppWindow size={15} />
      {t(isAppMode(page) ? 'ui.disableAppMode' : 'ui.enableAppMode')}
    </MenuItem>
  );
}
