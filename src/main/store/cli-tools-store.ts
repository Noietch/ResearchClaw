import fs from 'fs';
import { ensureStorageDir, getCliToolsPath } from './storage-path';

// Lazy import safeStorage to avoid Electron dependency in tests
let _safeStorage: {
  isEncryptionAvailable: () => boolean;
  encryptString: (s: string) => Buffer;
  decryptString: (b: Buffer) => string;
} | null = null;

function getSafeStorage(): {
  isEncryptionAvailable: () => boolean;
  encryptString: (s: string) => Buffer;
  decryptString: (b: Buffer) => string;
} {
  if (_safeStorage === null) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _safeStorage = require('electron').safeStorage;
    } catch {
      // Electron not available (e.g., in tests)
      _safeStorage = {
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.from(''),
        decryptString: () => '',
      };
    }
  }
  return _safeStorage!;
}

export type ProviderKind = 'anthropic' | 'openai' | 'gemini' | 'custom';

export interface CliConfig {
  id: string; // uuid-ish
  name: string;
  command: string; // e.g. "claude --dangerously-skip-permissions"
  envVars?: string; // plaintext for display (masked), encrypted version stored separately
  envVarsEncrypted?: string; // encrypted envVars containing API keys
  provider: ProviderKind;
  active: boolean;
  useProxy?: boolean; // whether to use global proxy for this tool
}

interface StoreData {
  tools: CliConfig[];
}

function getStorePath(): string {
  return getCliToolsPath();
}

function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8');
    return JSON.parse(raw) as StoreData;
  } catch {
    return { tools: [] };
  }
}

function writeStore(data: StoreData): void {
  ensureStorageDir();
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Encrypt sensitive envVars (containing API keys)
 */
function encryptEnvVars(envVars: string): string | undefined {
  if (!envVars) return undefined;
  const safeStorage = getSafeStorage();
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(envVars).toString('base64');
  }
  // Fallback: base64 encode (not secure, but better than plaintext)
  return Buffer.from(envVars).toString('base64');
}

/**
 * Decrypt envVars
 */
function decryptEnvVars(encrypted?: string): string | undefined {
  if (!encrypted) return undefined;
  try {
    const safeStorage = getSafeStorage();
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
    // Fallback: base64 decode
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  } catch {
    return undefined;
  }
}

export function getCliTools(): CliConfig[] {
  return readStore().tools;
}

export function getCliToolsWithDecryptedEnv(): (CliConfig & { envVarsDecrypted?: string })[] {
  const tools = getCliTools();
  return tools.map((t) => ({
    ...t,
    envVarsDecrypted: decryptEnvVars(t.envVarsEncrypted),
    envVars: t.envVars, // keep masked version if exists
  }));
}

export function saveCliTools(tools: CliConfig[]): void {
  // Encrypt envVars before saving
  const encryptedTools = tools.map((t) => {
    if (t.envVars && !t.envVarsEncrypted) {
      // New envVars provided, encrypt it
      const encrypted = encryptEnvVars(t.envVars);
      return {
        ...t,
        envVarsEncrypted: encrypted,
        envVars: undefined, // clear plaintext
      };
    }
    return t;
  });
  writeStore({ tools: encryptedTools });
}

export function saveCliTool(tool: CliConfig & { envVars?: string }): void {
  const tools = getCliTools();
  const idx = tools.findIndex((t) => t.id === tool.id);

  // Encrypt envVars if provided
  const encryptedTool: CliConfig = {
    id: tool.id,
    name: tool.name,
    command: tool.command,
    provider: tool.provider,
    active: tool.active,
    useProxy: tool.useProxy,
  };

  if (tool.envVars) {
    encryptedTool.envVarsEncrypted = encryptEnvVars(tool.envVars);
  } else if (tool.envVarsEncrypted) {
    encryptedTool.envVarsEncrypted = tool.envVarsEncrypted;
  }

  if (idx >= 0) {
    tools[idx] = encryptedTool;
  } else {
    tools.push(encryptedTool);
  }

  writeStore({ tools });
}

export function getActiveCliTool(): CliConfig | undefined {
  const tools = getCliTools();
  return tools.find((t) => t.active);
}

export function getActiveCliToolWithEnv(): (CliConfig & { envVarsDecrypted?: string }) | undefined {
  const tool = getActiveCliTool();
  if (!tool) return undefined;
  return {
    ...tool,
    envVarsDecrypted: decryptEnvVars(tool.envVarsEncrypted),
  };
}

export function setActiveCliTool(id: string): void {
  const tools = getCliTools();
  const updated = tools.map((t) => ({ ...t, active: t.id === id }));
  writeStore({ tools: updated });
}

export function deleteCliTool(id: string): void {
  const tools = getCliTools();
  const updated = tools.filter((t) => t.id !== id);
  writeStore({ tools: updated });
}

export function getDecryptedEnvVars(id: string): string | undefined {
  const tool = getCliTools().find((t) => t.id === id);
  if (!tool) return undefined;
  return decryptEnvVars(tool.envVarsEncrypted);
}
