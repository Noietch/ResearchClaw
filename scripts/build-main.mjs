#!/usr/bin/env node
import { build } from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Modules that must NOT be bundled:
// - electron: provided by Electron runtime
// - Node built-ins (both bare and node: prefixed): available in Node.js context
// - @prisma/client: CJS module that uses dynamic require() internally; must stay external
//   and be shipped as-is in node_modules (see electron-builder.yml files section)
const external = [
  'electron',
  // Node built-ins — both bare names and node: prefix
  'path',
  'fs',
  'os',
  'crypto',
  'child_process',
  'stream',
  'events',
  'util',
  'url',
  'http',
  'https',
  'net',
  'tls',
  'dns',
  'readline',
  'buffer',
  'assert',
  'module',
  'worker_threads',
  'perf_hooks',
  'zlib',
  'node:path',
  'node:fs',
  'node:os',
  'node:crypto',
  'node:child_process',
  'node:stream',
  'node:events',
  'node:util',
  'node:url',
  'node:http',
  'node:https',
  'node:net',
  'node:tls',
  'node:dns',
  'node:readline',
  'node:buffer',
  'node:assert',
  'node:module',
  'node:worker_threads',
  'node:perf_hooks',
  'node:zlib',
  'node:process',
  // Prisma: CJS with dynamic require — cannot be bundled into ESM
  '@prisma/client',
  // sql.js: uses dynamic WASM loading
  'sql.js',
];

const alias = {
  '@shared': path.join(root, 'src/shared/index.ts'),
  '@db': path.join(root, 'src/db/index.ts'),
};

// Main process — use CommonJS for better Electron compatibility
await build({
  entryPoints: [path.join(root, 'src/main/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(root, 'dist/main/index.js'),
  external,
  alias,
  tsconfig: path.join(root, 'tsconfig.main.json'),
  sourcemap: false, // Disable source maps for production (saves ~3.6MB)
  logLevel: 'info',
});

// Preload scripts MUST be CommonJS format for Electron
await build({
  entryPoints: [path.join(root, 'src/main/preload.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: path.join(root, 'dist/main/preload.js'),
  external: ['electron'],
  tsconfig: path.join(root, 'tsconfig.main.json'),
  sourcemap: false, // Disable source maps for production
  logLevel: 'info',
});

console.log('Main process build complete.');
