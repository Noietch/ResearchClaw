import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Note: Electron startup is handled by scripts/dev.mjs, not vite-plugin-electron
// to avoid duplicate window issues (see vite.config.ts vs dev.mjs)

export default defineConfig({
  plugins: [react()],
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
