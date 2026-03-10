import { spawnSync } from 'node:child_process';

const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(cmd, ['rebuild', 'better-sqlite3'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_build_from_source: 'true',
    npm_config_runtime: 'node',
  },
});

if (result.error) {
  console.error('[native] Failed to run npm rebuild for better-sqlite3:', result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
