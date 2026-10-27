import { i18n, setLanguage, type Language } from '@tio/i18n';
import { useSyncExternalStore } from 'react';
type Preference = { theme: 'light' | 'dark'; locale: Language; readOnly: boolean };
let state: Preference = { theme: 'light', locale: 'zh', readOnly: false };
const listeners = new Set<() => void>();
export function setPresentation(next: Partial<Preference>) {
  state = { ...state, ...next };
  document.documentElement.classList.toggle('dark', state.theme === 'dark');
  document.documentElement.style.colorScheme = state.theme;
  document.documentElement.lang = state.locale;
  if (i18n.language !== state.locale) setLanguage(state.locale);
  try {
    localStorage.setItem('tio.presentation', JSON.stringify(state));
  } catch {
    /* optional preference storage */
  }
  listeners.forEach((fn) => fn());
}
export function initializePresentation() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem('tio.presentation') ?? '{}');
  } catch {
    /* defaults */
  }
  const value = saved as Partial<Preference>;
  setPresentation({
    theme: value.theme === 'dark' ? 'dark' : 'light',
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
