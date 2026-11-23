import { writeFileSync } from 'node:fs';
const key = process.env.TIO_RESOURCE_PUBLIC_KEY ?? '';
if (
  key &&
  (Buffer.from(key, 'base64').length !== 32 ||
    Buffer.from(key, 'base64').toString('base64') !== key)
)
  throw new Error('Expected a base64-encoded 32-byte Ed25519 public key');
writeFileSync(new URL('../src-tauri/resource-public-key', import.meta.url), key);
const channel = process.env.VITE_TIO_CHANNEL ?? '';
if (
  channel &&
  !['ios-store', 'android-play', 'macos-direct', 'windows-direct', 'linux-direct'].includes(channel)
)
  throw new Error('Unknown native distribution channel');
const updaterKey = process.env.TIO_UPDATER_PUBLIC_KEY ?? '';
if (updaterKey && Buffer.from(updaterKey, 'base64').toString('base64') !== updaterKey)
  throw new Error('Expected a base64-encoded Tauri updater public key');
writeFileSync(new URL('../src-tauri/updater-public-key', import.meta.url), updaterKey);
