import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { ensureStorageDir, getSshServersPath } from './storage-path';
import { encryptString, decryptString, isEncryptionAvailable } from '../utils/encryption';
import type { SshServerConfig } from '@shared';

interface StoreData {
  servers: SshServerConfig[];
}

const DEFAULT_DATA: StoreData = {
  servers: [],
};

function getStorePath(): string {
  return getSshServersPath();
}

function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8');
    return { ...DEFAULT_DATA, ...(JSON.parse(raw) as Partial<StoreData>) };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function writeStore(data: StoreData): void {
  ensureStorageDir();
  const storePath = getStorePath();
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function listSshServers(): SshServerConfig[] {
  return readStore().servers;
}

export function getSshServer(id: string): SshServerConfig | undefined {
  const data = readStore();
  return data.servers.find((s) => s.id === id);
}

export interface SaveSshServerInput {
  id?: string;
  label: string;
  host: string;
  port?: number;
  username: string;
  authMethod: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  defaultCwd?: string;
}

export function saveSshServer(input: SaveSshServerInput): SshServerConfig {
  const data = readStore();

  const id = input.id || uuidv4();
  const existingIdx = data.servers.findIndex((s) => s.id === id);
  const existing = existingIdx >= 0 ? data.servers[existingIdx] : undefined;

  const config: SshServerConfig = {
    id,
    label: input.label,
    host: input.host,
    port: input.port || 22,
    username: input.username,
    authMethod: input.authMethod,
    passwordEncrypted: existing?.passwordEncrypted,
    privateKeyPath: input.privateKeyPath,
    passphraseEncrypted: existing?.passphraseEncrypted,
    defaultCwd: input.defaultCwd,
  };

  // Handle password encryption
  if (input.authMethod === 'password' && input.password) {
    if (!isEncryptionAvailable()) {
      throw new Error(
        'Password encryption is not available on this system. ' +
          'Please ensure you are running on a supported platform.',
      );
    }
    config.passwordEncrypted = encryptString(input.password);
  }

  // Handle passphrase encryption for private key
  if (input.authMethod === 'privateKey' && input.passphrase) {
    if (!isEncryptionAvailable()) {
      throw new Error(
        'Passphrase encryption is not available on this system. ' +
          'Please ensure you are running on a supported platform.',
      );
    }
    config.passphraseEncrypted = encryptString(input.passphrase);
  }

  if (existingIdx >= 0) {
    data.servers[existingIdx] = config;
  } else {
    data.servers.push(config);
  }

  writeStore(data);
  return config;
}

export function removeSshServer(id: string): void {
  const data = readStore();
  data.servers = data.servers.filter((s) => s.id !== id);
  writeStore(data);
}

export function getDecryptedSshPassword(id: string): string | undefined {
  const server = getSshServer(id);
  if (!server?.passwordEncrypted) return undefined;
  return decryptString(server.passwordEncrypted);
}

export function getDecryptedSshPassphrase(id: string): string | undefined {
  const server = getSshServer(id);
  if (!server?.passphraseEncrypted) return undefined;
  return decryptString(server.passphraseEncrypted);
}

export function updateDefaultCwd(id: string, cwd: string): void {
  const data = readStore();
  const idx = data.servers.findIndex((s) => s.id === id);
  if (idx >= 0) {
    data.servers[idx].defaultCwd = cwd;
    writeStore(data);
  }
}

/**
 * Returns the SSH connection config with decrypted credentials.
 * Throws if server not found or encryption not available.
 */
export function getSshConnectConfig(id: string): {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
} {
  const server = getSshServer(id);
  if (!server) {
    throw new Error(`SSH server not found: ${id}`);
  }

  const config: {
    host: string;
    port: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
  } = {
    host: server.host,
    port: server.port,
    username: server.username,
  };

  if (server.authMethod === 'password') {
    const password = getDecryptedSshPassword(id);
    if (password) {
      config.password = password;
    }
  } else if (server.authMethod === 'privateKey') {
    config.privateKeyPath = server.privateKeyPath;
    const passphrase = getDecryptedSshPassphrase(id);
    if (passphrase) {
      config.passphrase = passphrase;
    }
  }

  return config;
}
