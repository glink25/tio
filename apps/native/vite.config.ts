import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { editorCss } from '../../scripts/editor-css.mjs';
import { contract, productVersion, runtimeIdentity } from './release/lib.mjs';
export default defineConfig(({ mode }) => {
  const desktopChannels: Record<string, string> = {
    darwin: 'macos-direct',
    win32: 'windows-direct',
    linux: 'linux-direct',
  };
  const channel =
    process.env.VITE_TIO_CHANNEL ??
    (mode === 'android' ? 'android-play' : desktopChannels[process.platform]);
  const compatibility = contract(channel);
  const mobilePlatforms: Partial<Record<string, 'ios' | 'android'>> = {
    'ios-store': 'ios',
    'android-play': 'android',
  };
  const mobilePlatform = mobilePlatforms[channel];
  return {
    publicDir: '../../packages/app/public',
    define: {
      'import.meta.env.VITE_TIO_PLATFORM': JSON.stringify(mobilePlatform ?? 'desktop'),
      'import.meta.env.VITE_TIO_NATIVE_SPLASH': JSON.stringify(!!mobilePlatform),
    },
    build: { target: compatibility.runtimeTarget, cssTarget: compatibility.runtimeTarget },
    resolve: { dedupe: ['react', 'react-dom', 'sonner', 'zustand', 'zod'] },
    css: { postcss: { plugins: [editorCss()] } },
    plugins: [
      {
        name: 'tio-boot-logo',
        transformIndexHtml(html) {
          if (mobilePlatform)
            return html
              .replace(/\s*<!-- web-boot -->[\s\S]*?<!-- \/web-boot -->/g, '')
              .replace('<html ', '<html data-tio-native-mobile ')
              .replace('initial-scale=1,', 'initial-scale=1, maximum-scale=1, user-scalable=no,');
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
              ...(await runtimeIdentity(
                channel,
                createHash('sha256').update(kernel).digest('hex'),
              )),
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
  };
});
