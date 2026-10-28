#!/usr/bin/env node
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { buildSiteDirectory } from './node';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help: { type: 'boolean', short: 'h' },
    outDir: { type: 'string', short: 'o' },
    config: { type: 'string', short: 'c' },
  },
});
if (values.help || positionals.length === 0) {
  console.log(
    'Usage: tio-pages build [workspace] [-o output] [-c config]\n\nReads .tio-page/config.ts; defaults to .tio-page/dist.',
  );
} else {
  if (positionals[0] !== 'build' || positionals.length > 2)
    throw new Error('Expected: tio-pages build [workspace]');
  // Preserve the invocation directory when used through a pnpm workspace script.
  const caller = process.env.INIT_CWD ?? process.cwd();
  const root = resolve(caller, positionals[1] ?? '.');
  const output = values.outDir ? resolve(caller, values.outDir) : join(root, '.tio-page/dist');
  const config = values.config ? resolve(caller, values.config) : undefined;
  const site = await buildSiteDirectory(root, output, config);
  console.log(`Built ${site.routes.length} routes and ${site.files.size} files in ${output}`);
}
