import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Bootstrap config file — always at a fixed location outside the storage root.
 * Stores the user-configured storage directory so it can be read before
 * anything else (DB path, etc.) is resolved.
 */
export function getBootstrapConfigPath(): string {
  return path.join(os.homedir(), '.researchclaw-config.json');
}

interface BootstrapConfig {
  storageDir?: string;
}

function readBootstrapConfig(): BootstrapConfig {
  try {
    const configPath = getBootstrapConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as BootstrapConfig;
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

function writeBootstrapConfig(config: BootstrapConfig): void {
  const configPath = getBootstrapConfigPath();
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Platform-appropriate default data directory for ResearchClaw:
 *   Windows : %APPDATA%\ResearchClaw
 *   macOS   : ~/.researchclaw
 *   Linux   : $XDG_DATA_HOME/researchclaw  (default: ~/.local/share/researchclaw)
 */
function getPlatformDefaultDir(): string {
  switch (process.platform) {
    case 'win32': {
      const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, 'ResearchClaw');
    }
    case 'linux': {
      const xdgData = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
      return path.join(xdgData, 'researchclaw');
    }
    default:
      // macOS — keep legacy path for backwards compatibility
      return path.join(os.homedir(), '.researchclaw');
  }
}

/**
 * Returns the configured storage directory.
 * Priority: env var > bootstrap config > platform default
 */
export function getConfiguredStorageDir(): string {
  if (process.env.RESEARCH_CLAW_STORAGE_DIR) {
    return process.env.RESEARCH_CLAW_STORAGE_DIR;
  }
  const config = readBootstrapConfig();
  if (config.storageDir) {
    return config.storageDir;
  }
  return getPlatformDefaultDir();
}

/**
 * Persists the new storage directory to the bootstrap config.
 * Does NOT migrate files — call migrateStorageDir() first.
 */
export function setStorageDir(newDir: string): void {
  const config = readBootstrapConfig();
  config.storageDir = newDir;
  writeBootstrapConfig(config);
}

function getBaseDir(): string {
  return getConfiguredStorageDir();
}

export function getStorageDir(): string {
  return getBaseDir();
}

export function ensureStorageDir(): void {
  const baseDir = getBaseDir();
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
}

export function getDbPath(): string {
  return path.join(getBaseDir(), 'researchclaw.db');
}

export function getProviderConfigPath(): string {
  return path.join(getBaseDir(), 'provider-config.json');
}

export function getAppSettingsPath(): string {
  return path.join(getBaseDir(), 'app-settings.json');
}

export function getCliToolsPath(): string {
  return path.join(getBaseDir(), 'cli-tools.json');
}

export function getSshServersPath(): string {
  return path.join(getBaseDir(), 'ssh-servers.json');
}

export function getDiscoveryCachePath(): string {
  return path.join(getBaseDir(), 'discovery-cache.json');
}

export function getPapersBaseDir(): string {
  return path.join(getBaseDir(), 'papers');
}

/**
 * Migrates all data files from oldDir to newDir.
 * Creates newDir if it doesn't exist.
 * Does NOT delete old files — user can clean up manually.
 */
export function migrateStorageDir(
  oldDir: string,
  newDir: string,
): { success: boolean; error?: string } {
  try {
    if (!fs.existsSync(newDir)) {
      fs.mkdirSync(newDir, { recursive: true });
    }

    const filesToCopy = [
      'researchclaw.db',
      'app-settings.json',
      'provider-config.json',
      'cli-tools.json',
      'model-config.json',
      'token-usage.json',
    ];

    for (const file of filesToCopy) {
      const src = path.join(oldDir, file);
      const dest = path.join(newDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }

    // Copy papers directory recursively
    const papersSrc = path.join(oldDir, 'papers');
    const papersDest = path.join(newDir, 'papers');
    if (fs.existsSync(papersSrc)) {
      copyDirRecursive(papersSrc, papersDest);
    }

    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
