import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: {
      '@tio/database/repository': resolve('packages/database/src/repository.ts'),
      '@tio/database/search-browser': resolve('packages/database/src/search-browser.ts'),
      ...Object.fromEntries(
        readdirSync('packages').map((p) => [
          `@tio/${p}`,
          resolve(
            `packages/${p}/src/index.${['views', 'editor-blocknote', 'ui', 'web-editor'].includes(p) ? 'tsx' : 'ts'}`,
          ),
        ]),
      ),
    },
  },
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
