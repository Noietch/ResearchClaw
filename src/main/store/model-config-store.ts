import fs from 'fs';
import path from 'path';
import { ensureStorageDir, getStorageDir } from './storage-path';
import { encryptString, decryptString, isEncryptionAvailable } from '../utils/encryption';
import { appendLog } from '../services/app-log.service';

export type ModelKind = 'agent' | 'lightweight' | 'chat';
export type ModelBackend = 'api' | 'cli';
export type AgentToolKind =
  | 'claude-code'
  | 'codex'
  | 'gemini'
  | 'openclaw'
  | 'opencode'
  | 'qwen'
  | 'goose'
  | 'custom';

export interface ModelConfig {
  id: string;
  name: string;
  backend: ModelBackend;
  provider?: 'anthropic' | 'openai' | 'gemini' | 'custom';
  model?: string;
  baseURL?: string;
  command?: string;
  envVars?: string;
  agentTool?: AgentToolKind;
  configContent?: string;
  authContent?: string;
  apiKeyEncrypted?: string;
}

interface StoredModelConfig extends ModelConfig {
  kind?: ModelKind;
}

interface ModelStoreData {
  models: StoredModelConfig[];
  activeIds: Record<ModelKind, string | null>;
}

const DEFAULT_AGENT_MODELS: ModelConfig[] = [
  {
    id: 'agent-claude-code',
    name: 'Claude Code',
    backend: 'cli',
    command: 'claude',
    envVars: '',
    agentTool: 'claude-code',
    configContent: '',
    authContent: '',
  },
  {
    id: 'agent-codex',
    name: 'Codex',
    backend: 'cli',
    command: 'npx @zed-industries/codex-acp',
    envVars: '',
    agentTool: 'codex',
    configContent: '',
    authContent: '',
  },
  {
    id: 'agent-gemini',
    name: 'Gemini CLI',
    backend: 'cli',
    command: 'gemini',
    envVars: '',
    agentTool: 'gemini',
    configContent: '',
    authContent: '',
  },
];

function normalizeModel(model: StoredModelConfig): ModelConfig {
  return {
    id: model.id,
    name: model.name,
    backend: model.backend,
    provider: model.provider,
    model: model.model,
    baseURL: model.baseURL,
    command: model.command,
    envVars: model.envVars,
    agentTool: model.agentTool,
    configContent: model.configContent,
    authContent: model.authContent,
    apiKeyEncrypted: model.apiKeyEncrypted,
  };
}

function withDefaultAgentModels(data: ModelStoreData): ModelStoreData {
  const models = data.models.map(normalizeModel);
  let changed = false;

  for (const preset of DEFAULT_AGENT_MODELS) {
    const exists = models.some(
      (model) =>
        model.id === preset.id || (model.backend === 'cli' && model.command === preset.command),
    );
    if (!exists) {
      models.push(preset);
      changed = true;
    }
  }

  const activeIds = { ...data.activeIds };
  if (!activeIds.agent || !models.some((model) => model.id === activeIds.agent)) {
    activeIds.agent = DEFAULT_AGENT_MODELS[0].id;
    changed = true;
  }

  return changed ? { models, activeIds } : data;
}

function getStorePath(): string {
  return path.join(getStorageDir(), 'model-configs.json');
}

function readStore(): ModelStoreData {
  const storePath = getStorePath();
  try {
    const content = fs.readFileSync(storePath, 'utf-8');
    const parsed = JSON.parse(content) as ModelStoreData;
    const normalized = withDefaultAgentModels(parsed);
    if (normalized !== parsed) {
      writeStore(normalized);
    }
    return normalized;
  } catch {
    const initial = withDefaultAgentModels({
      models: [],
      activeIds: { agent: null, lightweight: null, chat: null },
    });
    writeStore(initial);
    return initial;
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
  appendLog('models', 'setActiveModel:start', { kind, id }, 'models.log');
  const data = readStore();
  data.activeIds[kind] = id;
  writeStore(data);
  appendLog('models', 'setActiveModel:done', { kind, id }, 'models.log');
}

export function saveModelConfig(config: ModelConfig & { apiKey?: string }): void {
  appendLog(
    'models',
    'saveModelConfig:start',
    {
      id: config.id,
      backend: config.backend,
      agentTool: config.agentTool,
      name: config.name,
    },
    'models.log',
  );
  const data = readStore();
  const idx = data.models.findIndex((m) => m.id === config.id);

  const updated: ModelConfig = {
    id: config.id,
    name: config.name,
    backend: config.backend,
    provider: config.provider,
    model: config.model,
    baseURL: config.baseURL,
    command: config.command,
    envVars: config.envVars,
    agentTool: config.agentTool,
    configContent: config.configContent,
    authContent: config.authContent,
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

  writeStore(data);
  appendLog(
    'models',
    'saveModelConfig:done',
    {
      id: config.id,
      backend: config.backend,
      agentTool: config.agentTool,
      isNewModel,
    },
    'models.log',
  );
}

export function deleteModelConfig(id: string): void {
  appendLog('models', 'deleteModelConfig', { id }, 'models.log');
  const data = readStore();
  data.models = data.models.filter((m) => m.id !== id);
  // Clear active if deleted
  for (const kind of ['agent', 'lightweight'] as ModelKind[]) {
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
