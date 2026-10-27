import { defineConfig } from 'vitest/config';

import { testsRoot } from './paths.ts';

export default defineConfig({
  root: testsRoot,
  cacheDir: '.cache/vitest',
  test: { include: ['unit/**/*.test.ts'], setupFiles: ['./setup.ts'] },
});
