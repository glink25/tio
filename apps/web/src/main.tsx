import { mountApp } from '@tio/app';

import { createWebPlatform } from './platform';
const platform = createWebPlatform(import.meta.env.VITE_GITHUB_AUTH_URL);
platform.afterReady = async () => {
  setTimeout(() => {
    void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
  }, 1000);
};
mountApp(platform);
