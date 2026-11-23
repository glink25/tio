import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { hash, signed, contract, assetURL, productVersion } from './lib.mjs';
const directory = process.argv[2];
const receipt = JSON.parse(await readFile(join(directory, 'receipt.json'), 'utf8'));
if (receipt.sourceCommit !== process.env.TIO_SOURCE_COMMIT || receipt.version !== productVersion())
  throw new Error('Signing source mismatch');
for (const [name, digest] of Object.entries(receipt.checksums)) {
  if (!/^[\w.-]+$/.test(name) || hash(await readFile(join(directory, name))) !== digest)
    throw new Error('Artifact changed before signing');
}
const key = await readFile(process.env.TIO_RELEASE_KEY_FILE);
if (['runtime', 'host'].includes(receipt.mode)) {
  const payload = JSON.parse(await readFile(join(directory, 'runtime-payload.json'), 'utf8'));
  const meta = JSON.parse(await readFile(join(directory, 'runtime-metadata.json'), 'utf8'));
  const target = contract(receipt.channel);
  const archiveName = `tio-${receipt.channel}-frontend-${payload.archiveSha256}.tar.gz`;
  if (
    payload.channel !== receipt.channel ||
    payload.productVersion !== receipt.version ||
    payload.revision !== receipt.revision ||
    payload.compatibleContractIds.length !== 1 ||
    payload.compatibleContractIds[0] !== target.contractId ||
    meta.contractId !== target.contractId ||
    payload.runtimeId !== meta.runtimeId ||
    receipt.checksums[archiveName] !== payload.archiveSha256 ||
    payload.archiveUrl !== assetURL(receipt.version, receipt.channel, archiveName)
  )
    throw new Error('Runtime signing contract mismatch');
  await writeFile(join(directory, 'runtime.json'), JSON.stringify(signed(payload, key)));
}
if (receipt.mode === 'content') {
  const payload = JSON.parse(await readFile(join(directory, 'content-payload.json'), 'utf8'));
  const meta = receipt.previous.runtime;
  if (
    payload.channel !== receipt.channel ||
    payload.revision !== receipt.revision ||
    payload.compatibleRuntimeIds.length !== 1 ||
    payload.compatibleRuntimeIds[0] !== meta.runtimeId
  )
    throw new Error('Content signing contract mismatch');
  for (const [lang, entries] of Object.entries(payload.translations))
    for (const [name, value] of Object.entries(entries))
      if (!meta.translationKeys[lang]?.includes(name) || typeof value !== 'string')
        throw new Error('Content introduces unknown keys');
  await writeFile(join(directory, 'content.json'), JSON.stringify(signed(payload, key)));
}
// Store binaries remain pipeline artifacts and are never public Release assets.
if (receipt.channel === 'android-play')
  for (const name of await readdir(directory))
    if (name.endsWith('.aab')) await unlink(join(directory, name));
receipt.checksums = {};
for (const entry of await readdir(directory, { withFileTypes: true }))
  if (entry.isFile() && entry.name !== 'receipt.json')
    receipt.checksums[entry.name] = hash(await readFile(join(directory, entry.name)));
await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
