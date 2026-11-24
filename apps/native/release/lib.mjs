import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const repositoryURL = new URL('../../../', import.meta.url);
export const root = fileURLToPath(repositoryURL);
export const channels = [
  'ios-store',
  'macos-direct',
  'windows-direct',
  'linux-direct',
  'android-play',
  'web',
];
export const readJSON = (path) => JSON.parse(readFileSync(new URL(path, repositoryURL), 'utf8'));
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export const hash = (value) => createHash('sha256').update(value).digest('hex');
export function contract(channel) {
  const config = readJSON('apps/native/host-contract.json');
  if (!config.runtimeTargets[channel]) throw new Error('Unknown native channel');
  const value = {
    format: config.format,
    channel,
    bridgeApiVersion: config.bridgeApiVersion,
    storageEpoch: config.storageEpoch,
    reviewEpoch: config.reviewEpochs?.[channel] ?? 0,
    capabilities: [...config.capabilities].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    runtimeTarget: config.runtimeTargets[channel],
  };
  return { ...value, contractId: hash(canonical(value)) };
}
export function trackFor(version) {
  const match = /^(?:\d+\.\d+\.\d+)(-rc\.\d+)?$/.exec(version);
  if (!match) throw new Error('Expected a release version or rc version');
  return match[1] ? 'preview' : 'stable';
}
export function productVersion() {
  const { version } = readJSON('package.json');
  trackFor(version);
  return version;
}
export const distTag = (version, channel) => `dist/${version}/${channel}`;
export function assetURL(version, channel, file) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(file)) throw new Error('Unsafe asset filename');
  return (
    'https://github.com/glink25/tio/releases/download/' +
    encodeURIComponent(distTag(version, channel)) +
    '/' +
    file
  );
}
export function signed(payload, privateKey) {
  const key = createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Expected Ed25519 key');
  const bytes = Buffer.from(canonical(payload));
  return {
    payload: bytes.toString('base64'),
    signature: sign(null, bytes, key).toString('base64'),
  };
}
export function decoded(envelope, publicKey) {
  const bytes = Buffer.from(envelope.payload, 'base64');
  const key = createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(publicKey, 'base64'),
    ]),
    type: 'spki',
    format: 'der',
  });
  if (!verify(null, bytes, key, Buffer.from(envelope.signature, 'base64')))
    throw new Error('Invalid release signature');
  return JSON.parse(bytes);
}
export function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
export async function runtimeIdentity(channel, kernelSha256) {
  const { locales } = await import('../../../packages/i18n/src/locales.ts');
  const translationKeys = Object.fromEntries(
    Object.entries(locales).map(([language, { translation }]) => [
      language,
      Object.keys(translation).sort(),
    ]),
  );
  const value = {
    contractId: contract(channel).contractId,
    productVersion: productVersion(),
    kernelSha256,
    translationKeys,
  };
  return { runtimeId: hash(canonical(value)), translationKeys };
}
