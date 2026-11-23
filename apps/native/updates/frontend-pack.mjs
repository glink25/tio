import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  channels,
  hash,
  signed,
  assetURL,
  productVersion,
  contract,
  runtimeIdentity,
} from '../release/lib.mjs';
const { values } = parseArgs({
  options: Object.fromEntries(
    ['channel', 'dir', 'revision', 'private-key', 'out', 'contracts'].map((k) => [
      k,
      { type: 'string' },
    ]),
  ),
});
if (!channels.includes(values.channel) || values.channel === 'web')
  throw new Error('Invalid native channel');
const revision = Number(values.revision);
if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid revision');
const root = resolve(values.dir),
  output = resolve(values.out);
if (!relative(root, output).startsWith('..')) throw new Error('Output must be outside bundle');
const meta = JSON.parse(await readFile(join(root, 'native-contract.json'), 'utf8'));
if (
  meta.channel !== values.channel ||
  meta.productVersion !== productVersion() ||
  meta.contractId !== contract(values.channel).contractId
)
  throw new Error('Rebuild matching frontend');
const kernelSha256 = hash(await readFile(join(root, 'native-kernel.js')));
if (kernelSha256 !== meta.kernelSha256) throw new Error('Kernel mismatch');
if ((await runtimeIdentity(values.channel, kernelSha256)).runtimeId !== meta.runtimeId)
  throw new Error('Runtime identity mismatch');
const compatibleContractIds = values.contracts?.split(',') ?? [meta.contractId];
// Cross-contract approval must supply real contract descriptors, not arbitrary IDs.
if (compatibleContractIds.some((id) => id !== meta.contractId))
  throw new Error('Build separately against each supported contract');
const files = {};
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isSymbolicLink() || name.includes('\\') || name.includes(':'))
      throw new Error('Unsafe bundle asset');
    if (entry.isDirectory()) await collect(join(dir, entry.name), name + '/');
    else if (entry.isFile()) files[name] = hash(await readFile(join(dir, entry.name)));
    else throw new Error('Invalid bundle asset');
  }
}
await collect(root);
if (!files['index.html'] || Object.keys(files).length > 10000) throw new Error('Invalid frontend');
await mkdir(output, { recursive: true });
const temp = join(output, '.frontend-' + process.pid + '.tar.gz');
try {
  const result = spawnSync('tar', ['-czf', temp, '-C', root, '.'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
    stdio: 'inherit',
  });
  if (result.status !== 0) throw result.error ?? new Error('Archive failed');
  const archive = await readFile(temp);
  if (archive.length > 32 * 1024 * 1024) throw new Error('Archive exceeds host limit');
  const archiveSha256 = hash(archive);
  const name = `tio-${values.channel}-frontend-${archiveSha256}.tar.gz`;
  const payload = {
    format: 1,
    kind: 'frontend-patch',
    channel: values.channel,
    productVersion: productVersion(),
    revision,
    compatibleContractIds,
    runtimeId: meta.runtimeId,
    archiveUrl: assetURL(productVersion(), values.channel, name),
    archiveSha256,
    kernelSha256,
    files,
  };
  await writeFile(join(output, name), archive);
  await writeFile(join(output, 'runtime-payload.json'), JSON.stringify(payload));
  if (values['private-key'])
    await writeFile(
      join(output, 'runtime.json'),
      JSON.stringify(signed(payload, await readFile(values['private-key']))),
    );
  await writeFile(join(output, 'runtime-metadata.json'), JSON.stringify(meta, null, 2));
} finally {
  await rm(temp, { force: true });
}
