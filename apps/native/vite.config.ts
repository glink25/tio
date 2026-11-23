import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { editorCss } from '../../scripts/editor-css.mjs';
import { contract, productVersion, runtimeIdentity } from './release/lib.mjs';
const channel =
  process.env.VITE_TIO_CHANNEL ??
  (
    { darwin: 'macos-direct', win32: 'windows-direct', linux: 'linux-direct' } as Record<
      string,
      string
    >
  )[process.platform];
const compatibility = contract(channel);
export default defineConfig({
  publicDir: '../../packages/app/public',
  build: { target: compatibility.runtimeTarget, cssTarget: compatibility.runtimeTarget },
  resolve: { dedupe: ['react', 'react-dom', 'sonner', 'zustand', 'zod'] },
  css: { postcss: { plugins: [editorCss()] } },
  plugins: [
    {
      name: 'tio-boot-logo',
      transformIndexHtml(html) {
        return html.replace(
          '<!--tio-boot-logo-->',
          readFileSync(new URL('../../packages/app/src/brand/logo.svg', import.meta.url), 'utf8'),
        );
      },
    },
    {
      name: 'tio-native-contract',
      async generateBundle() {
        const kernel = readFileSync(
          new URL('./src-tauri/gen/apple/assets/headless.js', import.meta.url),
        );
        this.emitFile({ type: 'asset', fileName: 'native-kernel.js', source: kernel });
        this.emitFile({
          type: 'asset',
          fileName: 'native-contract.json',
          source: JSON.stringify({
            ...compatibility,
            ...(await runtimeIdentity(channel, createHash('sha256').update(kernel).digest('hex'))),
            productVersion: productVersion(),
            kernelSha256: createHash('sha256').update(kernel).digest('hex'),
          }),
        });
      },
    },
    react(),
    tailwindcss(),
  ],
  server: { port: 6790, strictPort: true },
});
