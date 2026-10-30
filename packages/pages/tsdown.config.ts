import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: {
      index: 'src/index.ts',
      ssr: 'src/ssr.ts',
      page: 'src/page.ts',
      node: 'src/node.ts',
      code: 'src/code.ts',
      cli: 'src/cli.ts',
    },
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    format: 'esm',
    platform: 'node',
    target: 'node24',
    dts: { generator: 'tsgo', tsconfig: '../../tsconfig.pages.json' },
    deps: { alwaysBundle: [/^@tio\//] },
  },
  {
    entry: { 'client/code-client': 'src/code-client.ts' },
    outExtensions: () => ({ js: '.js' }),
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    dts: false,
    clean: false,
  },
]);
