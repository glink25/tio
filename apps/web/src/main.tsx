import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import { App } from './app/app';
import '@tio/i18n';

import { ErrorBoundary } from './app/error-boundary';
import { initializePresentation } from './services/browser-presentation';

import './styles/tailwind.css';
initializePresentation();
registerSW({ immediate: true });
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
