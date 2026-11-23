import { readFileSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  channels,
  root,
  readJSON,
  hash,
  canonical,
  contract,
  productVersion,
  trackFor,
  distTag,
  git,
} from './lib.mjs';
const { values } = parseArgs({
  options: {
    baseline: { type: 'string' },
    targets: { type: 'string' },
    out: { type: 'string' },
    tag: { type: 'string' },
    automatic: { type: 'boolean' },
  },
});
const config = readJSON('apps/native/release-plan.json');
const version = productVersion();
const track = trackFor(version);
if (values.tag && values.tag !== 'v' + version)
  throw new Error('Source tag differs from product version');
if (
  config.format !== 1 ||
  !Number.isSafeInteger(config.revision) ||
  config.revision < 1 ||
  !Number.isSafeInteger(config.hostBuild) ||
  config.hostBuild < 1 ||
  config.hostBuild > 2100000000
)
  throw new Error('Invalid release plan');
if (
  !['existing-behavior', 'review-required'].includes(config.apple?.intent) ||
  !config.apple.reason?.trim()
)
  throw new Error('Declare iOS release intent and reason');
if (!['tag', 'manual'].includes(config.web?.deployment))
  throw new Error('Declare Web deployment policy');
if (
  !Array.isArray(config.forceHost) ||
  config.forceHost.some((channel) => !channels.includes(channel) || channel === 'web')
)
  throw new Error('Invalid forced host selection');
const selected = values.targets ? values.targets.split(',') : config.targets;
if (
  selected !== 'auto' &&
  (!Array.isArray(selected) ||
    !selected.length ||
    selected.some((c) => !channels.includes(c)) ||
    new Set(selected).size !== selected.length)
)
  throw new Error('Invalid target selection');
const sourceCommit = git('rev-parse', 'HEAD');
const files = [
  ...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0')),
]
  .filter((f) => f && existsSync(join(root, f)))
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
function nativeFile(file, channel) {
  if (file.startsWith('apps/native/apple/')) return channel === 'ios-store';
  if (file.startsWith('apps/native/src-tauri/gen/android/')) return channel.startsWith('android-');
  if (file.startsWith('apps/native/src-tauri/gen/apple/')) {
    if (/\/(assets|Externals|build|Mac)\//.test(file)) return false;
    return channel === 'ios-store';
  }
  if (file.endsWith('/shortcuts.rs')) return channel === 'ios-store';
  if (file.endsWith('/headless_io.rs'))
    return channel === 'ios-store' || channel.startsWith('android-');
  return (
    /^apps\/native\/src-tauri\/(src\/|capabilities\/|icons\/|Cargo\.|build\.rs|tauri\..*json$)/.test(
      file,
    ) || ['.node-version', 'rust-toolchain.toml'].includes(file)
  );
}
const workspacePackages = new Map(
  files
    .filter((file) => /^(apps|packages)\/[^/]+\/package\.json$/.test(file))
    .map((file) => {
      const manifest = JSON.parse(readFileSync(join(root, file), 'utf8'));
      return [manifest.name, { directory: file.slice(0, -'/package.json'.length), manifest }];
    }),
);
function runtimeDirectories(channel) {
  const start = channel === 'web' ? 'apps/web' : 'apps/native';
  const directories = new Set([start]);
  const pending = [...workspacePackages.values()].filter((pkg) => pkg.directory === start);
  while (pending.length) {
    const pkg = pending.pop();
    for (const name of Object.keys({
      ...pkg.manifest.dependencies,
      ...pkg.manifest.devDependencies,
    })) {
      const dependency = workspacePackages.get(name);
      if (dependency && !directories.has(dependency.directory)) {
        directories.add(dependency.directory);
        pending.push(dependency);
      }
    }
  }
  return directories;
}
function runtimeFile(file, channel) {
  if (file.endsWith('.md')) return false;
  if (file.startsWith('packages/'))
    return [...runtimeDirectories(channel)].some((dir) => file.startsWith(dir + '/'));
  if (channel === 'web' && file.startsWith('apps/web/')) return true;
  if (
    channel !== 'web' &&
    (/^apps\/native\/(src\/|index\.html|vite\.|kernel\/)/.test(file) ||
      file === 'apps/native/release/lib.mjs')
  )
    return true;
  return (
    ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc'].includes(file) ||
    file.startsWith('scripts/editor-css')
  );
}
function fingerprint(predicate, extra) {
  return hash(
    canonical({
      files: files.filter(predicate).map((f) => [f, hash(readFileSync(join(root, f)))]),
      ...extra,
    }),
  );
}
const matrix = [];
for (const channel of channels) {
  const appleStore = ['ios-store'].includes(channel);
  if (values.automatic && channel === 'web' && config.web?.deployment === 'manual') continue;
  if (selected !== 'auto' && !selected.includes(channel)) continue;
  const path = values.baseline && join(values.baseline, track, channel + '.json');
  const previous = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
  if (
    previous &&
    (previous.channel !== channel || previous.track !== track || previous.kind !== 'release-index')
  )
    throw new Error('Invalid baseline');
  const otherPath =
    values.baseline &&
    join(values.baseline, track === 'stable' ? 'preview' : 'stable', channel + '.json');
  const other =
    otherPath && existsSync(otherPath) ? JSON.parse(readFileSync(otherPath, 'utf8')) : undefined;
  const hostContract = channel === 'web' ? null : contract(channel);
  const nativeFingerprint =
    channel === 'web'
      ? null
      : fingerprint((f) => nativeFile(f, channel), {
          contract: hostContract,
          tooling: readJSON('apps/native/package.json').devDependencies['@tauri-apps/cli'],
          trustKeys: {
            resource: process.env.TIO_RESOURCE_PUBLIC_KEY ?? '',
            updater: channel.endsWith('-direct')
              ? (process.env.TIO_UPDATER_PUBLIC_KEY ?? '')
              : null,
          },
        });
  const entryManifest = readJSON(
    channel === 'web' ? 'apps/web/package.json' : 'apps/native/package.json',
  );
  const runtimeFingerprint = fingerprint((f) => runtimeFile(f, channel), {
    entry: {
      scripts: entryManifest.scripts ?? {},
      dependencies: entryManifest.dependencies ?? {},
      devDependencies: entryManifest.devDependencies ?? {},
    },
  });
  const storageFingerprint =
    channel === 'web'
      ? null
      : fingerprint(
          (f) =>
            /^packages\/core\/src\/(index|content|fields|json|references|automation|assistant)\.ts$/.test(
              f,
            ) || f === 'packages/file-storage/src/chunks.ts',
          {},
        );
  const bridgeFingerprint =
    channel === 'web'
      ? null
      : fingerprint(
          (f) =>
            (nativeFile(f, channel) && /\/(workspace|catalog|folder|headless_io)\.rs$/.test(f)) ||
            /^packages\/native-core\/src\/(native-repository|folder|replica)\.ts$/.test(f) ||
            f === 'apps/native/src/native-ipc.ts',
          {},
        );
  if (previous && channel !== 'web') {
    for (const [kind, fingerprint, field] of [
      ['storage', storageFingerprint, 'storageEpoch'],
      ['bridge', bridgeFingerprint, 'bridgeApiVersion'],
    ]) {
      const intent = config.compatibility?.[kind];
      if (!['unchanged', 'compatible', 'breaking'].includes(intent))
        throw new Error('Declare storage and bridge compatibility');
      if (previous[kind + 'Fingerprint'] !== fingerprint) {
        if (intent === 'unchanged' || !config.compatibility.reason?.trim())
          throw new Error(`Declare ${kind} compatibility and explain the protocol change`);
        if (intent === 'breaking' && hostContract[field] <= previous.runtime?.[field])
          throw new Error(`Increase ${field} for the breaking change`);
      }
    }
  }
  let mode =
    channel === 'web'
      ? 'web'
      : !(appleStore ? previous?.nativeFingerprint : previous?.host?.nativeFingerprint) ||
          (appleStore ? previous.nativeFingerprint : previous.host.nativeFingerprint) !==
            nativeFingerprint
        ? 'host'
        : previous.runtimeFingerprint !== runtimeFingerprint
          ? 'runtime'
          : 'skip';
  if (mode === 'web' && previous?.runtimeFingerprint === runtimeFingerprint) mode = 'skip';
  if (config.forceHost.includes(channel)) mode = 'host';
  if (appleStore && mode === 'runtime' && config.apple.intent === 'review-required') mode = 'host';
  if (config.content && mode === 'skip' && channel !== 'web') mode = 'content';
  if (
    appleStore &&
    mode === 'host' &&
    previous &&
    previous.runtimeFingerprint !== runtimeFingerprint &&
    config.apple.intent === 'review-required' &&
    previous.runtime?.contractId === hostContract.contractId
  )
    throw new Error('Increment the Apple reviewEpoch before shipping new functionality');
  const alreadyPublished =
    previous?.version === version &&
    previous.sourceCommit === sourceCommit &&
    previous.releaseRevision === config.revision &&
    previous.runtimeFingerprint === runtimeFingerprint &&
    (channel === 'web' ||
      (appleStore ? previous.nativeFingerprint : previous.host?.nativeFingerprint) ===
        nativeFingerprint);
  const retry = alreadyPublished && selected !== 'auto';
  if (alreadyPublished && !retry) continue;
  if (retry) mode = previous.mode;
  if (mode === 'skip') continue;
  if (
    mode === 'host' &&
    ['ios-store', 'macos-direct', 'android-play'].includes(channel) &&
    !Object.values(config.storeNotes?.[channel] ?? {}).some(
      (note) => typeof note === 'string' && note.trim().length > 0,
    )
  )
    throw new Error('Configure localized store release notes');
  if (previous && !retry && config.revision <= previous.releaseRevision)
    throw new Error(`Increase release revision for ${channel}`);
  if (
    mode === 'host' &&
    !appleStore &&
    !retry &&
    config.hostBuild <= Math.max(previous?.host?.build ?? 0, other?.host?.build ?? 0)
  )
    throw new Error(`Increase hostBuild for ${channel}`);
  if (mode === 'content' && !previous?.runtime)
    throw new Error('Content needs an existing runtime');
  matrix.push({
    channel,
    mode,
    version,
    track,
    revision: config.revision,
    hostBuild: config.hostBuild,
    sourceCommit,
    distTag: distTag(version, channel),
    nativeFingerprint,
    runtimeFingerprint,
    storageFingerprint,
    bridgeFingerprint,
    contract: hostContract,
    previous: previous ?? null,
    content: config.content ?? null,
  });
}
if (
  process.env.CI &&
  matrix.some((row) => row.channel !== 'web') &&
  Buffer.from(process.env.TIO_RESOURCE_PUBLIC_KEY ?? '', 'base64').length !== 32
)
  throw new Error('Configure the release metadata public key');
const result = { format: 1, version, track, sourceCommit, include: matrix };
if (values.out) writeFileSync(values.out, JSON.stringify(result, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    'matrix=' +
      JSON.stringify({
        include: matrix.map(
          ({
            channel,
            mode,
            version,
            track,
            revision,
            hostBuild,
            sourceCommit,
            nativeFingerprint,
            runtimeFingerprint,
            distTag,
          }) => ({
            channel,
            mode,
            version,
            track,
            revision,
            hostBuild,
            sourceCommit,
            nativeFingerprint,
            runtimeFingerprint,
            distTag,
          }),
        ),
      }) +
      '\nhas_jobs=' +
      (matrix.length > 0) +
      '\n',
  );
console.log(JSON.stringify(result, null, 2));
