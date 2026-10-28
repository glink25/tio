import { defineConfig } from '@playwright/test';

import { repoRoot, testsRoot } from './paths';

const port = Number(process.env.TIO_PAGES_TEST_PORT ?? 6790);
export default defineConfig({
  testDir: testsRoot + '/e2e-pages',
  outputDir: testsRoot + '/test-results/pages',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command:
      'corepack pnpm --filter @glink25/tio-pages exec tsx ../../tests/scripts/serve-pages.ts',
    cwd: repoRoot,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
  reporter: 'list',
});
