import { defineConfig } from '@playwright/test';

import base from './playwright.config';
export default defineConfig({
  ...base,
  testMatch: 'web-slice.spec.ts',
  projects: [
    { name: 'chromium', use: { browserName: 'chromium', launchOptions: base.use?.launchOptions } },
    { name: 'firefox', use: { browserName: 'firefox', launchOptions: {} } },
    { name: 'webkit', use: { browserName: 'webkit', launchOptions: {} } },
  ],
});
