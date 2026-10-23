import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { editorCss } from '../../scripts/editor-css.mjs';
export default defineConfig({
  css: { postcss: { plugins: [editorCss()] } },
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
});
