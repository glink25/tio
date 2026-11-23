import { execFileSync, spawnSync } from 'node:child_process';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { hash } from './lib.mjs';
const bundle = process.argv[2];
const app = join(bundle, 'macos', 'Tio.app');
const metadata = JSON.parse(await readFile('apps/native/package.json', 'utf8'));
const plist = (key) =>
  execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print :' + key, join(app, 'Contents/Info.plist')],
    { encoding: 'utf8' },
  ).trim();
if (
  plist('CFBundleIdentifier') !== 'com.glink25.tio' ||
  plist('CFBundleShortVersionString') !== metadata.version.split('-')[0] ||
  plist('CFBundleVersion') !== String(metadata.buildNumber)
)
  throw new Error('macOS application identity differs from the release');
const arch = execFileSync(
  'lipo',
  ['-archs', join(app, 'Contents/MacOS', plist('CFBundleExecutable'))],
  { encoding: 'utf8' },
)
  .trim()
  .split(/\s+/)
  .sort()
  .join(',');
if (arch !== 'arm64,x86_64') throw new Error('macOS release must contain both architectures');
execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
const prefix = join(process.env.RUNNER_TEMP, 'tio-app-certificate-');
execFileSync('codesign', ['-d', '--extract-certificates', prefix, app], {
  stdio: ['ignore', 'ignore', 'pipe'],
});
if (hash(await readFile(prefix + '0')) !== process.env.APPLE_CERTIFICATE_SHA256)
  throw new Error('Unexpected app signing certificate');
for (let n = 0; n < 4; n++) await unlink(prefix + n).catch(() => {});
execFileSync('xcrun', ['stapler', 'validate', app], { stdio: 'inherit' });
execFileSync('spctl', ['--assess', '--type', 'execute', app], { stdio: 'inherit' });
const dmgs = (await readdir(join(bundle, 'dmg'))).filter((n) => n.endsWith('.dmg'));
if (dmgs.length !== 1) throw new Error('Expected one macOS disk image');
const dmg = join(bundle, 'dmg', dmgs[0]);
if (spawnSync('xcrun', ['stapler', 'validate', dmg], { stdio: 'ignore' }).status !== 0) {
  const result = spawnSync(
    'xcrun',
    [
      'notarytool',
      'submit',
      dmg,
      '--apple-id',
      process.env.APPLE_ID,
      '--password',
      process.env.APPLE_PASSWORD,
      '--team-id',
      process.env.APPLE_TEAM_ID,
      '--wait',
      '--output-format',
      'json',
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || JSON.parse(result.stdout).status !== 'Accepted')
    throw new Error('Disk image notarization failed');
  execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
}
execFileSync('xcrun', ['stapler', 'validate', dmg], { stdio: 'inherit' });
