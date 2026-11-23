import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { hash } from './lib.mjs';
const directory = process.argv[2];
const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
if (
  receipt.channel !== 'web' ||
  receipt.mode !== 'web' ||
  receipt.sourceCommit !== process.env.TIO_SOURCE_COMMIT
)
  throw new Error('Not a Web deployment');
const archive = join(directory, 'web.tar.gz');
if (hash(await readFile(archive)) !== receipt.checksums['web.tar.gz'])
  throw new Error('Web artifact checksum mismatch');
const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
if (
  entries.length > 10000 ||
  entries.some(
    (n) => n.startsWith('/') || n.includes('\\') || n.includes(':') || n.split('/').includes('..'),
  )
)
  throw new Error('Unsafe Web archive');
const path = join(directory, 'web-dist');
await mkdir(path, { recursive: true });
execFileSync('tar', ['-xzf', archive, '-C', path], { stdio: 'inherit' });
const endpoint = `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/tio`;
const headers = {
  Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN,
  'Content-Type': 'application/json',
};
const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Cannot inspect Pages project');
const project = await response.json();
if (!project.success) throw new Error('Pages project unavailable');
if (project.result.source) {
  const source = {
    ...project.result.source,
    config: {
      ...project.result.source.config,
      production_deployments_enabled: false,
      preview_deployment_setting: 'none',
    },
  };
  const update = await fetch(endpoint, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ source }),
    signal: AbortSignal.timeout(30000),
  });
  if (!update.ok || !(await update.json()).success)
    throw new Error('Cannot disable automatic Pages builds');
}
const branch =
  receipt.track === 'stable' ? project.result.production_branch : `preview-${receipt.version}`;
execFileSync(
  'corepack',
  [
    'pnpm',
    'exec',
    'wrangler',
    'pages',
    'deploy',
    path,
    '--project-name',
    'tio',
    '--branch',
    branch,
    '--commit-hash',
    receipt.sourceCommit,
    '--commit-dirty=false',
  ],
  { stdio: 'inherit' },
);
