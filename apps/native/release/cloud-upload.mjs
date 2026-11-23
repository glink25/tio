import { execFileSync } from 'node:child_process';
import { sign } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { productVersion, distTag, hash } from './lib.mjs';
const directory = process.argv[2];
const channel = process.env.CI_PRODUCT_PLATFORM === 'iOS' ? 'ios-store' : 'macos-direct';
const version = productVersion();
if (process.env.CI_TAG !== 'v' + version)
  throw new Error('Cloud signing only accepts release tags');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (commit !== process.env.CI_COMMIT) throw new Error('Cloud source mismatch');
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const platform = channel === 'ios-store' ? 'ios' : 'desktop';
execFileSync('tar', [
  '-czf',
  join(directory, 'runtime-source.tar.gz'),
  '-C',
  `apps/native/dist/${platform}`,
  '.',
]);
const files = {};
for (const entry of await readdir(directory, { withFileTypes: true }))
  if (entry.isFile()) files[entry.name] = hash(await readFile(join(directory, entry.name)));
await writeFile(
  join(directory, 'apple-build.json'),
  JSON.stringify({
    format: 1,
    channel,
    version,
    build: metadata.buildNumber,
    buildNumber: process.env.CI_BUILD_NUMBER,
    sourceCommit: commit,
    checksums: files,
  }),
);
const now = Math.floor(Date.now() / 1000);
const input =
  Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url') +
  '.' +
  Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: process.env.TIO_GITHUB_APP_ID }),
  ).toString('base64url');
const jwt =
  input +
  '.' +
  sign(
    'RSA-SHA256',
    Buffer.from(input),
    Buffer.from(process.env.TIO_GITHUB_APP_PRIVATE_KEY_BASE64 ?? '', 'base64'),
  ).toString('base64url');
const response = await fetch(
  `https://api.github.com/app/installations/${process.env.TIO_GITHUB_INSTALLATION_ID}/access_tokens`,
  {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + jwt, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ repositories: ['tio'], permissions: { contents: 'write' } }),
  },
);
if (!response.ok) throw new Error('Cannot authorize Cloud artifact upload');
const { token } = await response.json();
const env = { ...process.env, GH_TOKEN: token };
const tag = distTag(version, channel);
const view = execFileSync(
  'gh',
  ['api', 'repos/glink25/tio/releases/tags/' + encodeURIComponent(tag)],
  { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
);
// The Actions orchestrator creates the draft before starting Xcode Cloud.
const release = JSON.parse(view);
if (!release.draft || release.target_commitish !== commit)
  throw new Error('Cloud upload requires the matching unpublished release');
execFileSync(
  'gh',
  [
    'release',
    'upload',
    tag,
    ...(await readdir(directory)).map((name) => join(directory, name)),
    '--repo',
    'glink25/tio',
    '--clobber',
  ],
  { env, stdio: 'inherit' },
);
