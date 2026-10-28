import { readFileSync } from 'node:fs';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { editorCss } from '../../scripts/editor-css.mjs';
export default defineConfig({
  css: { postcss: { plugins: [editorCss()] } },
  plugins: [
    {
      name: 'tio-boot-logo',
      transformIndexHtml(html) {
        return html.replace(
          '<!--tio-boot-logo-->',
          readFileSync(new URL('./src/brand/logo.svg', import.meta.url), 'utf8'),
        );
      },
    },
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'favicon-32.png', 'apple-touch-icon.png', 'pwa-*.png'],
      manifest: {
        name: 'Tio 本地工作空间',
        short_name: 'Tio',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
      },
    }),
  ],
  server: { port: 6789 },
});
