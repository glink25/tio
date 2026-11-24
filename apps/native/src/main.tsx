import { mountApp } from '@tio/app';

import { createNativePlatform } from './platform';
const host = await createNativePlatform();
if (host.desktopChrome) {
  document.documentElement.dataset.tioNativeDesktop = '';
  history.scrollRestoration = 'manual';
}
mountApp(host);
