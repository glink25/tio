import { useT } from '@tio/i18n';
import { Moon, Sun, Monitor } from 'lucide-react';
import { createContext, useContext } from 'react';

import { IconButton } from './index';
export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';
export const ThemeContext = createContext<Theme | null>(null);
export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('Presentation provider required');
  return theme;
}
export function ThemeSwitcher({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (theme: ThemePreference) => void;
}) {
  const t = useT();
  const next = value === 'light' ? 'dark' : value === 'dark' ? 'system' : 'light';
  return (
    <IconButton
      label={`${t(`theme.${value}`)} · ${t('theme.switchTo', { mode: t(`theme.${next}`) })}`}
      className="p-1.5"
      onClick={() => onChange(next)}
    >
      {value === 'light' ? (
        <Sun size={16} />
      ) : value === 'dark' ? (
        <Moon size={16} />
      ) : (
        <Monitor size={16} />
      )}
    </IconButton>
  );
}
