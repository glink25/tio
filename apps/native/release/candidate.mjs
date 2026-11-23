import { execFileSync } from 'node:child_process';
import { readFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import { api } from './index-github.mjs';
import { hash } from './lib.mjs';
const directory = process.argv[2];
const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
if (receipt.sourceCommit !== process.env.TIO_SOURCE_COMMIT)
  throw new Error('Candidate source mismatch');
for (const [name, digest] of Object.entries(receipt.checksums))
  if (!/^[\w.-]+$/.test(name) || hash(await readFile(join(directory, name))) !== digest)
    throw new Error('Candidate changed');
let release = await api('/releases/tags/' + encodeURIComponent(receipt.distTag));
if (!release)
  release = await api('/releases', {
    tag_name: receipt.distTag,
    target_commitish: receipt.sourceCommit,
    name: `Tio ${receipt.version} · ${receipt.channel}`,
    draft: true,
    prerelease: receipt.track === 'preview',
    make_latest: 'false',
  });
if (!release.draft) throw new Error('Candidate release is already public; retry to reuse it');
if (release.target_commitish !== receipt.sourceCommit)
  throw new Error('Candidate release source mismatch');
await copyFile(join(directory, 'receipt.json'), join(directory, 'candidate-receipt.json'));
execFileSync(
  'gh',
  [
    'release',
    'upload',
    receipt.distTag,
    ...Object.keys(receipt.checksums).map((name) => join(directory, name)),
    join(directory, 'candidate-receipt.json'),
    '--repo',
    'glink25/tio',
    '--clobber',
  ],
  { stdio: 'inherit' },
);
