import { existsSync } from 'node:fs';

import { defineConfig } from '@playwright/test';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:6789',
    headless: true,
    locale: 'zh-CN',
    launchOptions: { ...(existsSync(chrome) ? { executablePath: chrome } : {}) },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    { command: 'corepack pnpm dev', url: 'http://127.0.0.1:6789', reuseExistingServer: true },
    {
      command: 'corepack pnpm build && corepack pnpm preview --port 4175',
      url: 'http://127.0.0.1:4175',
      reuseExistingServer: true,
    },
  ],
  reporter: 'list',
});
