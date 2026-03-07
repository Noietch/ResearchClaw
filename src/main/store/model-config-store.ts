import fs from 'fs';
import path from 'path';
import { ensureStorageDir, getStorageDir } from './storage-path';
import { encryptString, decryptString, isEncryptionAvailable } from '../utils/encryption';

export type ModelKind = 'agent' | 'lightweight' | 'chat';
export type ModelBackend = 'api' | 'cli';

export interface ModelConfig {
  id: string;
  name: string;
  kind: ModelKind;
  backend: ModelBackend;
  provider?: 'anthropic' | 'openai' | 'gemini' | 'custom';
  model?: string;
  baseURL?: string;
  command?: string;
  envVars?: string;
  apiKeyEncrypted?: string;
}

interface ModelStoreData {
  models: ModelConfig[];
  activeIds: Record<ModelKind, string | null>;
}

const DEFAULT_DATA: ModelStoreData = {
  models: [],
  activeIds: { agent: null, lightweight: null, chat: null },
};

function getStorePath(): string {
  return path.join(getStorageDir(), 'model-configs.json');
}

function readStore(): ModelStoreData {
  const storePath = getStorePath();
  try {
    const content = fs.readFileSync(storePath, 'utf-8');
    const data = JSON.parse(content) as Partial<ModelStoreData>;
    return { ...DEFAULT_DATA, ...data };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function writeStore(data: ModelStoreData): void {
  ensureStorageDir();
  const storePath = getStorePath();
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2));
}

export function getModelConfigs(): ModelConfig[] {
  return readStore().models;
}

export function getModelConfig(id: string): ModelConfig | undefined {
  return getModelConfigs().find((m) => m.id === id);
}

export function getActiveModelId(kind: ModelKind): string | null {
  return readStore().activeIds[kind];
}

export function getActiveModel(kind: ModelKind): ModelConfig | null {
  const id = getActiveModelId(kind);
  if (!id) return null;
  return getModelConfig(id) ?? null;
}

export function getActiveModelIds(): Record<ModelKind, string | null> {
  return readStore().activeIds;
}

export function setActiveModel(kind: ModelKind, id: string): void {
  const data = readStore();
  data.activeIds[kind] = id;
  writeStore(data);
}

export function saveModelConfig(config: ModelConfig & { apiKey?: string }): void {
  const data = readStore();
  const idx = data.models.findIndex((m) => m.id === config.id);

  const updated: ModelConfig = {
    id: config.id,
    name: config.name,
    kind: config.kind,
    backend: config.backend,
    provider: config.provider,
    model: config.model,
    baseURL: config.baseURL,
    command: config.command,
    envVars: config.envVars,
  };

  // Encrypt API key if provided
  if (config.apiKey && config.backend === 'api') {
    if (!isEncryptionAvailable()) {
      // SECURITY: Do not store API keys without encryption
      throw new Error(
        'API key encryption is not available on this system. ' +
          'Please ensure you are running on a supported platform (macOS Keychain, Windows Credential Vault, or Linux Secret Service).',
      );
    }
    updated.apiKeyEncrypted = encryptString(config.apiKey);
  }

  const isNewModel = idx < 0;
  if (idx >= 0) {
    data.models[idx] = updated;
  } else {
    data.models.push(updated);
  }

  // Auto-activate if this is a new model and no active model for this kind
  if (isNewModel && !data.activeIds[config.kind]) {
    data.activeIds[config.kind] = config.id;
  }

  writeStore(data);
}

export function deleteModelConfig(id: string): void {
  const data = readStore();
  data.models = data.models.filter((m) => m.id !== id);
  // Clear active if deleted
  for (const kind of ['agent', 'lightweight', 'chat'] as ModelKind[]) {
    if (data.activeIds[kind] === id) {
      data.activeIds[kind] = null;
    }
  }
  writeStore(data);
}

export function getDecryptedApiKey(modelId: string): string | undefined {
  const models = getModelConfigs();
  const model = models.find((m) => m.id === modelId);
  if (!model?.apiKeyEncrypted) return undefined;
  return decryptString(model.apiKeyEncrypted);
}

export function getModelWithKey(id: string): (ModelConfig & { apiKey?: string }) | undefined {
  const model = getModelConfig(id);
  if (!model) return undefined;
  return {
    ...model,
    apiKey: getDecryptedApiKey(id),
  };
}
