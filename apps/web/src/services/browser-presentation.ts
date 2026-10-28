import { i18n, setLanguage, type Language } from '@tio/i18n';
import { useSyncExternalStore } from 'react';
type ThemePreference = 'light' | 'dark' | 'system';
type Preference = { themePreference: ThemePreference; locale: Language; readOnly: boolean };
type Presentation = Preference & { theme: 'light' | 'dark' };
let state: Presentation = {
  themePreference: 'system',
  theme: 'light',
  locale: 'zh',
  readOnly: false,
};
const listeners = new Set<() => void>();
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
function apply() {
  state = {
    ...state,
    theme:
      state.themePreference === 'system'
        ? systemTheme.matches
          ? 'dark'
          : 'light'
        : state.themePreference,
  };
  document.documentElement.classList.toggle('dark', state.theme === 'dark');
  document.documentElement.style.colorScheme = state.theme;
  document.documentElement.lang = state.locale;
  if (i18n.language !== state.locale) setLanguage(state.locale);
  listeners.forEach((fn) => fn());
}
systemTheme.addEventListener('change', () => {
  if (state.themePreference === 'system') apply();
});
export function setPresentation(next: Partial<Preference>) {
  state = { ...state, ...next };
  apply();
  try {
    localStorage.setItem(
      'tio.presentation',
      JSON.stringify({ theme: state.themePreference, locale: state.locale }),
    );
  } catch {
    /* optional preference storage */
  }
}
export function initializePresentation() {
  let value: { theme?: unknown; locale?: unknown } = {};
  try {
    value = JSON.parse(localStorage.getItem('tio.presentation') ?? '{}') ?? {};
  } catch {
    /* defaults */
  }
  setPresentation({
    themePreference: value.theme === 'dark' || value.theme === 'light' ? value.theme : 'system',
    locale: value.locale === 'en' ? 'en' : 'zh',
  });
}
export function usePresentation() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => state,
  );
}
