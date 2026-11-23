import { execFileSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { hash } from './lib.mjs';
const directory = process.argv[2],
  channel = process.argv[3];
const receipt = JSON.parse(await readFile(join(directory, 'apple-build.json'), 'utf8'));
for (const [name, digest] of Object.entries(receipt.checksums))
  if (!/^[\w.-]+$/.test(name) || hash(await readFile(join(directory, name))) !== digest)
    throw new Error('Cloud artifact checksum mismatch');
const source = join(directory, 'runtime-source.tar.gz');
const names = execFileSync('tar', ['-tzf', source], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
if (
  names.length > 10000 ||
  names.some(
    (n) => n.startsWith('/') || n.split('/').includes('..') || n.includes('\\') || n.includes(':'),
  )
)
  throw new Error('Unsafe Cloud runtime archive');
const out = `apps/native/dist/${channel === 'ios-store' ? 'ios' : 'desktop'}`;
await mkdir(out, { recursive: true });
execFileSync('tar', ['-xzf', source, '-C', out], { stdio: 'inherit' });
if (channel === 'macos-direct') {
  const archive = Object.keys(receipt.checksums).find((n) => /^Tio_.*_macos\.zip$/.test(n));
  if (!archive) throw new Error('Missing signed macOS app');
  const target = join(directory, 'verify-app');
  await mkdir(target, { recursive: true });
  execFileSync('ditto', ['-x', '-k', join(directory, archive), target]);
  const app = join(target, 'Tio.app');
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  // codesign details are written to stderr; use a separate checked invocation.
  const { spawnSync } = await import('node:child_process');
  const info = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' });
  if (
    info.status !== 0 ||
    !process.env.APPLE_TEAM_ID ||
    !info.stderr.split('\n').includes('TeamIdentifier=' + process.env.APPLE_TEAM_ID)
  )
    throw new Error('Unexpected Apple signing team');
  execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' });
  const arch = execFileSync('lipo', ['-archs', join(app, 'Contents/MacOS/Tio')], {
    encoding: 'utf8',
  })
    .trim()
    .split(/\s+/)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (arch.join(',') !== 'arm64,x86_64') throw new Error('macOS release must be universal');
  for (const [key, value] of [
    ['CFBundleShortVersionString', receipt.version.split('-')[0]],
    ['CFBundleVersion', String(receipt.build)],
  ])
    if (
      execFileSync(
        '/usr/libexec/PlistBuddy',
        ['-c', 'Print :' + key, join(app, 'Contents/Info.plist')],
        { encoding: 'utf8' },
      ).trim() !== value
    )
      throw new Error('Apple version mismatch');
}
