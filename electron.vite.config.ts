import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

const rootDir = __dirname;

export default defineConfig({
  main: {
    build: {
      outDir: 'dist/main',
      emptyOutDir: false,
      externalizeDeps: true,
      rollupOptions: {
        input: {
          main: resolve(rootDir, 'src/main/main.ts'),
        },
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    build: {
      outDir: 'dist/preload',
      emptyOutDir: false,
      externalizeDeps: false,
      rollupOptions: {
        input: {
          preload: resolve(rootDir, 'src/preload/preload.ts'),
        },
        output: {
          entryFileNames: '[name].cjs',
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: rootDir,
    base: './',
    plugins: [react()],
    build: {
      outDir: 'dist/renderer',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve(rootDir, 'index.html'),
        },
      },
    },
  },
});
