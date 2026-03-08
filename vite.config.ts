import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry (absolute path)
        entry: path.resolve(__dirname, 'src/main/index.ts'),
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist/main'),
            sourcemap: true,
            rollupOptions: {
              external: ['@prisma/client', 'better-sqlite3', 'sqlite-vec'],
            },
          },
          resolve: {
            alias: {
              '@shared': path.resolve(__dirname, 'src/shared/index.ts'),
              '@db': path.resolve(__dirname, 'src/db/index.ts'),
            },
          },
        },
      },
      {
        // Preload script (absolute path)
        entry: path.resolve(__dirname, 'src/main/preload.ts'),
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            outDir: path.resolve(__dirname, 'dist/main'),
            sourcemap: true,
          },
        },
      },
    ]),
  ],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared/index.ts'),
      '@db': path.resolve(__dirname, 'src/db/index.ts'),
    },
  },
  server: {
    port: 5173,
  },
});
