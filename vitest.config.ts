import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared/index.ts'),
      '@db': path.resolve(__dirname, 'src/db/index.ts'),
      '@': path.resolve(__dirname, 'src/renderer'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    fileParallelism: false,
    setupFiles: ['tests/support/electron-mock.ts'],
    deps: {
      interopDefault: true,
    },
  },
});
