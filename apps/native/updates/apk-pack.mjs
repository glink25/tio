import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, X509Certificate, sign } from 'node:crypto';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { assetURL, productVersion } from '../release/lib.mjs';

const { values } = parseArgs({
  options: Object.fromEntries(
    ['apk', 'private-key', 'out', 'apksigner', 'apkanalyzer'].map((name) => [
      name,
      { type: 'string' },
    ]),
  ),
});
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
function run(tool, args) {
  const result = spawnSync(tool, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Android package validation failed: ' + result.stderr);
  return result.stdout.trim();
}
run(values.apksigner ?? 'apksigner', ['verify', '--verbose', values.apk]);
if (process.env.CI) {
  const expected = process.env.TIO_ANDROID_APK_CERT_SHA256?.toLowerCase().replaceAll(':', '');
  if (!expected) throw new Error('Configure the independent APK signing certificate hash');
  const certificates =
    run(values.apksigner ?? 'apksigner', ['verify', '--print-certs-pem', values.apk]).match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    ) ?? [];
  if (
    certificates.length !== 1 ||
    new X509Certificate(certificates[0]).fingerprint256.toLowerCase().replaceAll(':', '') !==
      expected
  )
    throw new Error('Unexpected APK signing certificate');
}
const analyzer = values.apkanalyzer ?? 'apkanalyzer';
for (const [field, expected] of [
  ['application-id', 'com.glink25.tio.apk'],
  ['version-name', metadata.version],
  ['version-code', String(metadata.buildNumber)],
]) {
  if (run(analyzer, ['manifest', field, values.apk]) !== expected)
    throw new Error('APK ' + field + ' differs from release metadata');
}
const bytes = await readFile(values.apk);
if (!bytes.length || bytes.length > 256 * 1024 * 1024) throw new Error('Invalid APK size');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const payload = Buffer.from(
  JSON.stringify({
    format: 1,
    kind: 'android-host',
    channel: 'android-apk',
    applicationId: 'com.glink25.tio.apk',
    version: metadata.version,
    build: metadata.buildNumber,
    sha256,
    size: bytes.length,
    url: assetURL(productVersion(), 'android-apk', 'tio-android-apk-' + sha256 + '.apk'),
  }),
);
const key = createPrivateKey(await readFile(values['private-key']));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected Ed25519 key');
const expected = process.env.TIO_RESOURCE_PUBLIC_KEY;
if (
  expected &&
  createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') !==
    expected
)
  throw new Error('APK manifest signing key differs from the configured host public key');
await mkdir(values.out, { recursive: true });
await copyFile(values.apk, join(values.out, 'tio-android-apk-' + sha256 + '.apk'));
await writeFile(
  join(values.out, 'tio-android-apk-host.json'),
  JSON.stringify({
    payload: payload.toString('base64'),
    signature: sign(null, payload, key).toString('base64'),
  }),
);
