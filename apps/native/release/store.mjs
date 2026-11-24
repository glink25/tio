import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { hash } from './lib.mjs';
const directory = process.argv[2];
const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
if (
  receipt.sourceCommit !== process.env.TIO_SOURCE_COMMIT ||
  receipt.mode !== 'host' ||
  receipt.channel !== 'android-play'
)
  throw new Error('Play receipt mismatch');
for (const [name, digest] of Object.entries(receipt.checksums))
  if (!/^[\w.-]+$/.test(name) || hash(await readFile(join(directory, name))) !== digest)
    throw new Error('Play artifact changed');
const bundles = (await readdir(directory)).filter((n) => n.endsWith('.aab'));
if (bundles.length !== 1) throw new Error('Expected one signed Play bundle');
const bundle = join(directory, bundles[0]);
execFileSync('jarsigner', ['-verify', bundle], { stdio: 'inherit' });
const certificate = execFileSync('keytool', ['-printcert', '-rfc', '-jarfile', bundle], {
  encoding: 'utf8',
}).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/);
if (
  !certificate ||
  !process.env.TIO_ANDROID_PLAY_UPLOAD_CERT_SHA256 ||
  hash(new X509Certificate(certificate[0]).raw) !== process.env.TIO_ANDROID_PLAY_UPLOAD_CERT_SHA256
)
  throw new Error('Unexpected Play upload certificate');
if (process.env.TIO_PUBLISH_PLAY === 'true') {
  execFileSync(
    'node',
    ['apps/native/release/play.mjs', bundle, join(directory, 'store-state.json'), receipt.track],
    { stdio: 'inherit' },
  );
  receipt.checksums['store-state.json'] = hash(await readFile(join(directory, 'store-state.json')));
}
await unlink(bundle);
delete receipt.checksums[bundles[0]];
await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
