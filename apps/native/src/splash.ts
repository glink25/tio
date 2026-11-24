import { invoke } from '@tauri-apps/api/core';

export function reportMobileStartup(status: 'ready' | 'failed') {
  if (!import.meta.env.VITE_TIO_NATIVE_SPLASH) return;

  const report = () => {
    const dark =
      status === 'ready' ? document.documentElement.classList.contains('dark') : undefined;
    void invoke('mobile_startup', { status, dark }).catch((error: unknown) => {
      console.warn('Native startup state unavailable', error);
    });
  };
  if (status === 'ready') requestAnimationFrame(() => requestAnimationFrame(report));
  else report();
}
