import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    target: 'es2022',
    outDir: 'src-tauri/gen/apple/assets',
    emptyOutDir: false,
    lib: {
      entry: '../../packages/native-core/src/headless.ts',
      name: 'TioKernel',
      formats: ['iife'],
      fileName: () => 'headless.js',
    },
  },
});
