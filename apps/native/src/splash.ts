import { invoke } from '@tauri-apps/api/core';

export function reportMobileStartup(status: 'ready' | 'failed') {
  if (!import.meta.env.VITE_TIO_NATIVE_SPLASH) return;

  const report = () => {
    void invoke('mobile_startup', { status }).catch((error: unknown) => {
      console.warn('Native startup state unavailable', error);
    });
  };
  if (status === 'ready') requestAnimationFrame(() => requestAnimationFrame(report));
  else report();
}
