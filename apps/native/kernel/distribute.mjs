import { copyFileSync, mkdirSync } from 'node:fs';

const assets = new URL('../src-tauri/gen/android/app/src/main/assets/', import.meta.url);
mkdirSync(assets, { recursive: true });
copyFileSync(
  new URL('../src-tauri/gen/apple/assets/headless.js', import.meta.url),
  new URL('tio-kernel.js', assets),
);
copyFileSync(new URL('bootstrap.js', import.meta.url), new URL('tio-bootstrap.js', assets));
