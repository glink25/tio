import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import { App } from './app/app';
import '@tio/i18n';

import { ErrorBoundary } from './app/error-boundary';
import { initializePresentation } from './services/browser-presentation';

import './styles/tailwind.css';
initializePresentation();
createRoot(document.getElementById('root')!).render(
  <>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <BootHandoff />
  </>,
);

// Runs after React commits the real page (or its workspace loading skeleton).
function BootHandoff() {
  useEffect(() => {
    // Let the first React frame paint before starting service-worker precaching.
    const registration = setTimeout(() => registerSW({ immediate: true }), 1000);
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.setAttribute('aria-hidden', 'true');
    boot.inert = true;
    boot.dataset.ready = '';
    const timeout = setTimeout(
      () => boot.remove(),
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160,
    );
    return () => {
      clearTimeout(timeout);
      clearTimeout(registration);
    };
  }, []);
  return null;
}
