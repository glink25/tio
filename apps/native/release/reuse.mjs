import { execFileSync } from 'node:child_process';
import { readFile, mkdir, appendFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

import { hash } from './lib.mjs';
const plan = JSON.parse(process.env.TIO_TARGET);
const response = await fetch(
  'https://api.github.com/repos/glink25/tio/releases/tags/' + encodeURIComponent(plan.distTag),
  {
    headers: {
      Authorization: 'Bearer ' + process.env.GH_TOKEN,
      Accept: 'application/vnd.github+json',
    },
    signal: AbortSignal.timeout(20000),
  },
);
async function output(reuse, published = false) {
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `reuse=${reuse}\npublished=${published}\n`);
}
if (response.status === 404) await output(false);
else {
  if (!response.ok) throw new Error('Cannot inspect existing release');
  const release = await response.json();
  const name = release.draft ? 'candidate-receipt.json' : 'receipt.json';
  if (!release.assets.some((a) => a.name === name)) {
    if (!release.draft) throw new Error('Published release has no receipt');
    await output(false);
  } else {
    const out = process.argv[2];
    await mkdir(out, { recursive: true });
    const download = (names) =>
      execFileSync(
        'gh',
        [
          'release',
          'download',
          plan.distTag,
          '--repo',
          'glink25/tio',
          '--dir',
          out,
          ...names.flatMap((n) => ['--pattern', n]),
        ],
        { stdio: 'inherit' },
      );
    download([name]);
    if (name !== 'receipt.json') await rename(join(out, name), join(out, 'receipt.json'));
    const receipt = JSON.parse(await readFile(join(out, 'receipt.json'), 'utf8'));
    for (const field of [
      'sourceCommit',
      'channel',
      'mode',
      'version',
      'revision',
      'runtimeFingerprint',
      'nativeFingerprint',
    ])
      if (receipt[field] !== plan[field])
        throw new Error('Existing candidate belongs to another build');
    const names = Object.keys(receipt.checksums);
    if (names.some((n) => !/^[\w.-]+$/.test(n))) throw new Error('Invalid receipt filename');
    download(names);
    for (const [file, digest] of Object.entries(receipt.checksums))
      if (hash(await readFile(join(out, file))) !== digest)
        throw new Error('Existing candidate is corrupt');
    await output(true, !release.draft);
  }
}
