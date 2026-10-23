import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      readdirSync('packages').map((p) => [
        `@tio/${p}`,
        resolve(
          `packages/${p}/src/index.${['views', 'editor-blocknote', 'ui', 'web-editor'].includes(p) ? 'tsx' : 'ts'}`,
        ),
      ]),
    ),
  },
  test: { include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
