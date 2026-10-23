import { useT } from '@tio/i18n';
import { Moon, Sun } from 'lucide-react';
import { createContext, useContext } from 'react';

import { IconButton } from './index';
export type Theme = 'light' | 'dark';
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
  value: Theme;
  onChange: (theme: Theme) => void;
}) {
  const t = useT();
  return (
    <IconButton
      label={t(value === 'light' ? 'theme.dark' : 'theme.light')}
      className="p-1.5"
      onClick={() => onChange(value === 'light' ? 'dark' : 'light')}
    >
      {value === 'light' ? <Moon size={16} /> : <Sun size={16} />}
    </IconButton>
  );
}
