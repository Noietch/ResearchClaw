import fs from 'fs';
import { ensureStorageDir, getCliToolsPath } from './storage-path';
import { encryptString, decryptString, isEncryptionAvailable } from '../utils/encryption';

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

const DEFAULT_DATA: StoreData = { tools: [] };

function getStorePath(): string {
  return getCliToolsPath();
}

function readStore(): StoreData {
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf-8');
    const data = JSON.parse(raw) as Partial<StoreData>;
    return { ...DEFAULT_DATA, ...data };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function writeStore(data: StoreData): void {
  ensureStorageDir();
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Encrypt sensitive envVars (containing API keys)
 * SECURITY: Requires encryption to be available - no fallback to insecure encoding
 */
function encryptEnvVars(envVars: string): string {
  if (!envVars) return '';
  if (!isEncryptionAvailable()) {
    // SECURITY: Do not store sensitive data without encryption
    throw new Error(
      'Encryption is not available on this system. ' +
        'Please ensure you are running on a supported platform (macOS Keychain, Windows Credential Vault, or Linux Secret Service) to store environment variables securely.',
    );
  }
  const encrypted = encryptString(envVars);
  return encrypted ?? '';
}

/**
 * Decrypt envVars
 */
function decryptEnvVars(encrypted?: string): string | undefined {
  if (!encrypted) return undefined;
  return decryptString(encrypted);
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
