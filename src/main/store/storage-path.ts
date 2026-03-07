import os from 'os';
import path from 'path';
import fs from 'fs';

/**
 * Platform-appropriate data directory for Vibe Research:
 *   Windows : %APPDATA%\VibeResearch
 *   macOS   : ~/.vibe-research
 *   Linux   : $XDG_DATA_HOME/vibe-research  (default: ~/.local/share/vibe-research)
 *
 * Override with VIBE_RESEARCH_STORAGE_DIR for testing or custom installs.
 */
function getBaseDir(): string {
  if (process.env.VIBE_RESEARCH_STORAGE_DIR) {
    return process.env.VIBE_RESEARCH_STORAGE_DIR;
  }
  switch (process.platform) {
    case 'win32': {
      const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
      return path.join(appData, 'VibeResearch');
    }
    case 'linux': {
      const xdgData = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share');
      return path.join(xdgData, 'vibe-research');
    }
    default:
      // macOS — keep legacy path for backwards compatibility
      return path.join(os.homedir(), '.vibe-research');
  }
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
  return path.join(getBaseDir(), 'vibe-research.db');
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

export function getPapersBaseDir(): string {
  return path.join(getBaseDir(), 'papers');
}
