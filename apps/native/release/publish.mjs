import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { api, changeIndex, findRelease } from './index-github.mjs';
import { hash, signed, decoded, assetURL, canonical, distTag, channels } from './lib.mjs';
const { values } = parseArgs({
  options: { dir: { type: 'string' } },
});
const dir = values.dir;
const receipt = JSON.parse(await readFile(join(dir, 'receipt.json'), 'utf8'));
const token = process.env.GH_TOKEN;
if (!token || !process.env.TIO_RELEASE_KEY_FILE) throw new Error('Release credentials unavailable');
const key = await readFile(process.env.TIO_RELEASE_KEY_FILE);
const repository = 'glink25/tio';
if (
  receipt.format !== 1 ||
  !['stable', 'preview'].includes(receipt.track) ||
  !Number.isSafeInteger(receipt.revision)
)
  throw new Error('Invalid receipt');
for (const [name, digest] of Object.entries(receipt.checksums)) {
  if (!/^[\w.-]+$/.test(name) || hash(await readFile(join(dir, name))) !== digest)
    throw new Error('Artifact checksum mismatch');
}
const names = Object.keys(receipt.checksums);
if (names.some((n) => /\.(?:aab|ipa|pkg|apk)$/.test(n)))
  throw new Error('Store binaries cannot be published to GitHub');
let storeState;
if (receipt.mode === 'host' && receipt.channel === 'android-play') {
  if (!receipt.checksums['store-state.json']) throw new Error('Store submission receipt missing');
  storeState = JSON.parse(await readFile(join(dir, 'store-state.json'), 'utf8'));
  if (
    storeState.channel !== receipt.channel ||
    storeState.version !== receipt.version ||
    storeState.build !== receipt.hostBuild
  )
    throw new Error('Store submission receipt mismatch');
}
const lookup = (name) => {
  if (!receipt.checksums[name]) throw new Error('Missing ' + name);
  return { url: assetURL(receipt.version, receipt.channel, name), sha256: receipt.checksums[name] };
};
let runtimeMetadata;
if (receipt.mode === 'host' || receipt.mode === 'runtime') {
  const runtime = decoded(
    JSON.parse(await readFile(join(dir, 'runtime.json'), 'utf8')),
    process.env.TIO_RESOURCE_PUBLIC_KEY,
  );
  runtimeMetadata = JSON.parse(await readFile(join(dir, 'runtime-metadata.json'), 'utf8'));
  if (
    runtime.productVersion !== receipt.version ||
    runtime.revision !== receipt.revision ||
    runtime.channel !== receipt.channel ||
    runtime.runtimeId !== runtimeMetadata.runtimeId ||
    !runtime.compatibleContractIds.includes(receipt.contract.contractId)
  )
    throw new Error('Runtime receipt mismatch');
}
if (
  !channels.includes(receipt.channel) ||
  receipt.distTag !== distTag(receipt.version, receipt.channel) ||
  !['host', 'runtime', 'content', 'web'].includes(receipt.mode)
)
  throw new Error('Invalid release target');
if (receipt.mode === 'content') {
  const content = decoded(
    JSON.parse(await readFile(join(dir, 'content.json'), 'utf8')),
    process.env.TIO_RESOURCE_PUBLIC_KEY,
  );
  if (content.channel !== receipt.channel || content.revision !== receipt.revision)
    throw new Error('Content target mismatch');
}
const sourceRef = await api('/git/ref/tags/v' + receipt.version);
if (!sourceRef) throw new Error('Source release tag missing');
const source =
  sourceRef.object.type === 'tag'
    ? (await api('/git/tags/' + sourceRef.object.sha)).object
    : sourceRef.object;
if (source.sha !== receipt.sourceCommit) throw new Error('Source tag does not match the build');
if (receipt.mode === 'host' && ['ios-store'].includes(receipt.channel)) {
  const ref = await api(
    '/git/ref/tags/' + encodeURIComponent(`host/${receipt.channel}/v${receipt.version}`),
  );
  if (ref?.object?.type !== 'commit' || ref.object.sha !== receipt.sourceCommit)
    throw new Error('Matching Xcode Cloud host tag missing');
}
decoded(signed({ channel: receipt.channel }, key), process.env.TIO_RESOURCE_PUBLIC_KEY);
// Each platform has its own immutable release. Published assets are reused only
// when their server-side digests agree; a rerun never replaces a published file.
let release = await findRelease(receipt.distTag);
if (!release)
  release = await api('/releases', {
    tag_name: receipt.distTag,
    target_commitish: receipt.sourceCommit,
    name: `Tio ${receipt.version} · ${receipt.channel}`,
    draft: true,
    prerelease: receipt.track === 'preview',
    make_latest: 'false',
  });
if (release.target_commitish !== receipt.sourceCommit)
  throw new Error('Artifact release points at another source commit');
if (release.draft) {
  execFileSync(
    'gh',
    [
      'release',
      'upload',
      receipt.distTag,
      ...names.map((n) => join(dir, n)),
      join(dir, 'receipt.json'),
      '--repo',
      repository,
      '--clobber',
    ],
    { stdio: 'inherit' },
  );
  const uploaded = await api('/releases/' + release.id);
  const expected = {
    ...receipt.checksums,
    'receipt.json': hash(await readFile(join(dir, 'receipt.json'))),
  };
  for (const [name, digest] of Object.entries(expected))
    if (
      !uploaded.assets.some(
        (asset) =>
          asset.name === name && asset.digest === 'sha256:' + digest && asset.state === 'uploaded',
      )
    )
      throw new Error('Uploaded artifact digest mismatch');
  for (const asset of uploaded.assets)
    if (!Object.hasOwn(expected, asset.name))
      await api('/releases/assets/' + asset.id, undefined, 'DELETE');
  release = await api('/releases/' + release.id, { draft: false, make_latest: 'false' }, 'PATCH');
} else {
  for (const [name, digest] of Object.entries(receipt.checksums))
    if (!release.assets.some((a) => a.name === name && a.digest === 'sha256:' + digest))
      throw new Error('Published artifact differs; use a new version');
}
await changeIndex(receipt.track, receipt.channel, async (previous) => {
  if (previous && receipt.revision < previous.releaseRevision)
    throw new Error('A newer release already exists');
  const update = {
    ...(previous ?? {}),
    format: 1,
    kind: 'release-index',
    channel: receipt.channel,
    track: receipt.track,
    version: receipt.version,
    mode: receipt.mode,
    sourceCommit: receipt.sourceCommit,
    nativeFingerprint: receipt.nativeFingerprint,
    storageFingerprint: receipt.storageFingerprint,
    bridgeFingerprint: receipt.bridgeFingerprint,
    releaseRevision: receipt.revision,
    revision: (previous?.revision ?? 0) + 1,
    runtimes: { ...(previous?.runtimes ?? {}) },
    contents: { ...(previous?.contents ?? {}) },
  };
  if (receipt.mode === 'host' && receipt.channel === 'ios-store')
    update.hostIntent = {
      sourceCommit: receipt.sourceCommit,
      tag: `host/ios-store/v${receipt.version}`,
      status: 'requested',
    };
  if (receipt.mode === 'host' && receipt.channel !== 'ios-store') {
    const manifest = ['macos-direct', 'windows-direct', 'linux-direct'].includes(receipt.channel)
      ? lookup('desktop-updates.json')
      : null;
    update.host = {
      version: receipt.version,
      build: receipt.hostBuild,
      contractId: receipt.contract.contractId,
      nativeFingerprint: receipt.nativeFingerprint,
      status: ['ios-store', 'android-play'].includes(receipt.channel) ? 'processing' : 'available',
      manifest,
      ...(storeState?.buildId ? { storeBuildId: storeState.buildId } : {}),
    };
  }
  if (
    receipt.mode === 'host' &&
    previous?.host?.build === receipt.hostBuild &&
    previous.host.version === receipt.version
  )
    update.host.status = previous.host.status;
  if (runtimeMetadata) {
    update.runtimeFingerprint = receipt.runtimeFingerprint;
    update.runtimes[receipt.contract.contractId] = lookup('runtime.json');
    update.runtime = { ...runtimeMetadata, metadata: lookup('runtime-metadata.json') };
  }
  if (receipt.mode === 'content') {
    const content = decoded(
      JSON.parse(await readFile(join(dir, 'content.json'), 'utf8')),
      process.env.TIO_RESOURCE_PUBLIC_KEY,
    );
    if (content.channel !== receipt.channel || content.revision !== receipt.revision)
      throw new Error('Content target mismatch');
    for (const id of content.compatibleRuntimeIds) update.contents[id] = lookup('content.json');
  }
  if (receipt.channel === 'web') update.runtimeFingerprint = receipt.runtimeFingerprint;
  // Replaying a completed publication is idempotent, not a new deployment.
  if (previous && canonical({ ...update, revision: previous.revision }) === canonical(previous))
    return null;
  return update;
});
console.log(`Published ${receipt.channel} ${receipt.version} (${receipt.mode})`);
