import { invoke } from '@tauri-apps/api/core';

import { reportMobileStartup } from './splash';

if (import.meta.env.VITE_TIO_PLATFORM === 'android') {
  const updateBack = (available: boolean) =>
    invoke<void>('set_overlay_back', { available }).catch((error) =>
      console.warn('Could not update Android Back availability', error),
    );
  let pending = updateBack(false);
  window.addEventListener('tio:overlay-back', (event) => {
    const { detail: available } = event as CustomEvent<boolean>;
    pending = pending.then(() => updateBack(available));
  });
}

const boot = document.getElementById('boot');
try {
  const preference = JSON.parse(localStorage.getItem('tio.presentation') ?? '{}');
  if (boot && (preference?.theme === 'light' || preference?.theme === 'dark'))
    boot.dataset.theme = preference.theme;
} catch {
  /* Optional preferences must never block startup. */
}

void import('./main').catch((error: unknown) => {
  console.error('Tio startup failed', error);
  reportMobileStartup('failed');
  if (boot) {
    boot.dataset.failed = '';
    boot.setAttribute('aria-busy', 'false');
  }
});
