import { resolve } from 'node:path';

import { defineConfig } from '@playwright/test';

import { repoRoot, testsRoot } from './paths.ts';

const port = Number(process.env.TIO_TEST_PORT ?? 6789);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: resolve(testsRoot, 'e2e'),
  testIgnore: ['**/tmp/**'],
  outputDir: resolve(testsRoot, 'test-results'),
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: `corepack pnpm build && corepack pnpm dev --port ${port} --strictPort`,
    cwd: repoRoot,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: 'list',
});
