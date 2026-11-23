import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '@tio/i18n';

import { App } from './app/app';
import { ErrorBoundary } from './app/error-boundary';
import { configurePlatform, type AppPlatform } from './platform';
import { initializePresentation } from './services/browser-presentation';

import './styles/tailwind.css';

export function mountApp(host: AppPlatform, element = document.getElementById('root')!) {
  configurePlatform(host);
  initializePresentation();
  const root = createRoot(element);
  root.render(
    <>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
      <BootHandoff />
    </>,
  );
  return root;
}
function BootHandoff() {
  useEffect(() => {
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.setAttribute('aria-hidden', 'true');
    boot.inert = true;
    boot.dataset.ready = '';
    const timer = setTimeout(
      () => boot.remove(),
      matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160,
    );
    return () => clearTimeout(timer);
  }, []);
  return null;
}
