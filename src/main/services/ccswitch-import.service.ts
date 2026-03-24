import fs from 'fs';
import path from 'path';
import os from 'os';
import type { AgentToolKind, CcSwitchProvider, AddAgentInput } from '@shared';

// ── CC Switch config types ──────────────────────────────────────────────────

interface CcSwitchClaudeProvider {
  id: string;
  name: string;
  settingsConfig: Record<string, unknown>;
  websiteUrl?: string;
  category?: string;
  createdAt?: number;
  meta?: Record<string, unknown>;
}

interface CcSwitchCodexProvider {
  id: string;
  name: string;
  settingsConfig: {
    auth?: Record<string, string>;
    config?: string;
  };
  websiteUrl?: string;
  category?: string;
  createdAt?: number;
  meta?: Record<string, unknown>;
}

interface CcSwitchConfig {
  version: number;
  claude?: {
    providers: Record<string, CcSwitchClaudeProvider>;
    current: string;
  };
  codex?: {
    providers: Record<string, CcSwitchCodexProvider>;
    current: string;
  };
  gemini?: {
    providers: Record<string, CcSwitchClaudeProvider>;
    current: string;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CC_SWITCH_CONFIG_PATH = path.join(os.homedir(), '.cc-switch', 'config.json');

function maskApiKey(key?: string): string | undefined {
  if (!key || key.length < 10) return key ? '***' : undefined;
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}

function extractClaudeFields(settingsConfig: Record<string, unknown>): {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
} {
  const env = settingsConfig.env as Record<string, string> | undefined;
  return {
    apiKey: env?.ANTHROPIC_AUTH_TOKEN || env?.ANTHROPIC_API_KEY,
    baseUrl: env?.ANTHROPIC_BASE_URL?.trim() || undefined,
    defaultModel: (settingsConfig.model as string) || undefined,
  };
}

function extractCodexFields(settingsConfig: { auth?: Record<string, string>; config?: string }): {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
} {
  const result: { apiKey?: string; baseUrl?: string; defaultModel?: string } = {};
  if (settingsConfig.auth?.OPENAI_API_KEY) {
    result.apiKey = settingsConfig.auth.OPENAI_API_KEY;
  }
  if (settingsConfig.config) {
    const modelMatch = settingsConfig.config.match(/^model\s*=\s*"([^"]+)"/m);
    if (modelMatch) result.defaultModel = modelMatch[1];
    const providerMatch = settingsConfig.config.match(/^model_provider\s*=\s*"([^"]+)"/m);
    if (providerMatch) {
      const providerName = providerMatch[1];
      const sectionRegex = new RegExp(
        `\\[model_providers\\.${providerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=\\n\\[|$)`,
      );
      const sectionMatch = settingsConfig.config.match(sectionRegex);
      if (sectionMatch) {
        const urlMatch = sectionMatch[1].match(/base_url\s*=\s*"([^"]+)"/);
        if (urlMatch) result.baseUrl = urlMatch[1];
      }
    }
  }
  return result;
}

// ── Public API ───────────────────────────────────────────────────────────────

export function readCcSwitchConfig(): CcSwitchConfig | null {
  if (!fs.existsSync(CC_SWITCH_CONFIG_PATH)) return null;
  try {
    const raw = fs.readFileSync(CC_SWITCH_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as CcSwitchConfig;
  } catch {
    return null;
  }
}

export function scanCcSwitchProviders(existingAgentNames: Set<string>): CcSwitchProvider[] {
  const config = readCcSwitchConfig();
  if (!config) return [];

  const providers: CcSwitchProvider[] = [];

  // Claude providers
  if (config.claude?.providers) {
    for (const p of Object.values(config.claude.providers)) {
      const fields = extractClaudeFields(p.settingsConfig);
      providers.push({
        id: p.id,
        name: p.name,
        toolType: 'claude',
        agentTool: 'claude-code',
        maskedApiKey: maskApiKey(fields.apiKey),
        baseUrl: fields.baseUrl,
        defaultModel: fields.defaultModel,
        category: p.category,
        isCurrent: config.claude!.current === p.id,
        alreadyExists: existingAgentNames.has(`claude-code:${p.name}`),
      });
    }
  }

  // Codex providers
  if (config.codex?.providers) {
    for (const p of Object.values(config.codex.providers)) {
      const fields = extractCodexFields(p.settingsConfig);
      providers.push({
        id: p.id,
        name: p.name,
        toolType: 'codex',
        agentTool: 'codex',
        maskedApiKey: maskApiKey(fields.apiKey),
        baseUrl: fields.baseUrl,
        defaultModel: fields.defaultModel,
        category: p.category,
        isCurrent: config.codex!.current === p.id,
        alreadyExists: existingAgentNames.has(`codex:${p.name}`),
      });
    }
  }

  // Gemini providers
  if (config.gemini?.providers) {
    for (const p of Object.values(config.gemini.providers)) {
      const fields = extractClaudeFields(p.settingsConfig);
      providers.push({
        id: p.id,
        name: p.name,
        toolType: 'gemini',
        agentTool: 'gemini',
        maskedApiKey: maskApiKey(fields.apiKey),
        baseUrl: fields.baseUrl,
        defaultModel: fields.defaultModel,
        category: p.category,
        isCurrent: config.gemini!.current === p.id,
        alreadyExists: existingAgentNames.has(`gemini:${p.name}`),
      });
    }
  }

  return providers;
}

export function mapCcSwitchProviderToAddInput(providerId: string): AddAgentInput | null {
  const config = readCcSwitchConfig();
  if (!config) return null;

  // Search in Claude providers
  const claudeProvider = config.claude?.providers[providerId];
  if (claudeProvider) {
    const fields = extractClaudeFields(claudeProvider.settingsConfig);
    return {
      name: claudeProvider.name,
      backend: 'claude-code',
      cliPath: 'npx @zed-industries/claude-agent-acp',
      acpArgs: [],
      agentTool: 'claude-code',
      configContent: JSON.stringify(claudeProvider.settingsConfig, null, 2),
      apiKey: fields.apiKey,
      baseUrl: fields.baseUrl,
      defaultModel: fields.defaultModel,
      isCustom: true,
    };
  }

  // Search in Codex providers
  const codexProvider = config.codex?.providers[providerId];
  if (codexProvider) {
    const fields = extractCodexFields(codexProvider.settingsConfig);
    return {
      name: codexProvider.name,
      backend: 'codex',
      cliPath: 'npx @zed-industries/codex-acp',
      acpArgs: [],
      agentTool: 'codex',
      configContent: codexProvider.settingsConfig.config || undefined,
      authContent: codexProvider.settingsConfig.auth
        ? JSON.stringify(codexProvider.settingsConfig.auth, null, 2)
        : undefined,
      apiKey: fields.apiKey,
      baseUrl: fields.baseUrl,
      defaultModel: fields.defaultModel,
      isCustom: true,
    };
  }

  // Search in Gemini providers
  const geminiProvider = config.gemini?.providers[providerId];
  if (geminiProvider) {
    const fields = extractClaudeFields(geminiProvider.settingsConfig);
    return {
      name: geminiProvider.name,
      backend: 'gemini',
      cliPath: 'gemini',
      acpArgs: ['--acp'],
      agentTool: 'gemini',
      configContent: JSON.stringify(geminiProvider.settingsConfig, null, 2),
      apiKey: fields.apiKey,
      baseUrl: fields.baseUrl,
      defaultModel: fields.defaultModel,
      isCustom: true,
    };
  }

  return null;
}
