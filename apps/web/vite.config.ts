import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

import { editorCss } from '../../scripts/editor-css.mjs';
export default defineConfig({
  css: { postcss: { plugins: [editorCss()] } },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Tio 本地工作空间',
        short_name: 'Tio',
        theme_color: '#191919',
        background_color: '#191919',
        display: 'standalone',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
      },
    }),
  ],
  server: { port: 6789 },
});
