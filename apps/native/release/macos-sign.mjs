import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { hash } from './lib.mjs';
const directory = process.env.RUNNER_TEMP;
for (const key of [
  'APPLE_CERTIFICATE',
  'APPLE_CERTIFICATE_PASSWORD',
  'APPLE_CERTIFICATE_SHA256',
  'APPLE_SIGNING_IDENTITY',
  'APPLE_ID',
  'APPLE_PASSWORD',
  'APPLE_TEAM_ID',
])
  if (!process.env[key]) throw new Error('Configure ' + key);
const file = join(directory, 'tio-developer-id.p12');
await writeFile(file, Buffer.from(process.env.APPLE_CERTIFICATE, 'base64'), { mode: 0o600 });
try {
  const certificate = execFileSync(
    'openssl',
    ['pkcs12', '-in', file, '-passin', 'env:APPLE_CERTIFICATE_PASSWORD', '-clcerts', '-nokeys'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (hash(new X509Certificate(certificate).raw) !== process.env.APPLE_CERTIFICATE_SHA256)
    throw new Error('Unexpected Developer ID certificate');
} catch {
  throw new Error('Cannot validate the configured Developer ID certificate');
} finally {
  await unlink(file);
}
const metadata = JSON.parse(await readFile('apps/native/package.json', 'utf8'));
await writeFile(
  join(directory, 'tio-macos.json'),
  JSON.stringify({
    bundle: {
      macOS: {
        minimumSystemVersion: '13.0',
        bundleVersion: String(metadata.buildNumber),
        signingIdentity: process.env.APPLE_SIGNING_IDENTITY,
      },
    },
  }),
);
