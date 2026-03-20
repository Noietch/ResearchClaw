import fs from 'fs';
import {
  ensureStorageDir,
  getAppSettingsPath,
  getPapersBaseDir,
  getStorageDir,
} from './storage-path';
import type { UserProfile } from '@shared';
import { encryptString, decryptString } from '../utils/encryption';

export interface ProxyScope {
  pdfDownload: boolean; // PDF downloads from arxiv etc.
  aiApi: boolean; // AI API calls (Anthropic, OpenAI, Gemini)
  cliTools: boolean; // CLI tools (claude, codex, gemini)
}

export interface EmbeddingConfig {
  id: string; // random 8-char id
  name: string; // user-facing label
  provider: 'openai-compatible';
  embeddingModel: string;
  embeddingApiBase?: string;
  embeddingApiKey?: string;
}

export interface SemanticSearchSettings {
  enabled: boolean;
  autoProcess: boolean;
  autoEnrich: boolean;
  embeddingModel: string;
  embeddingProvider: 'openai-compatible';
  embeddingApiBase?: string; // OpenAI-compatible base URL, e.g. https://api.openai.com/v1
  embeddingApiKey?: string; // API key for OpenAI-compatible provider
  recommendationExploration: number;
  // Legacy fields kept for migration only
  autoStartOllama?: boolean;
  baseUrl?: string;
}

interface AppSettings {
  papersDir?: string; // legacy field — ignored, papers are always at {storageRoot}/papers
  editorCommand: string; // e.g. "code" or "cursor"
  proxy?: string; // HTTP/SOCKS proxy URL, e.g. "http://127.0.0.1:7890" or "socks5://127.0.0.1:1080"
  proxyEnabled?: boolean; // Whether proxy is enabled (separate from URL to allow toggling)
  proxyScope?: ProxyScope; // Where to use the proxy
  semanticSearch?: SemanticSearchSettings;
  embeddingConfigs?: EmbeddingConfig[]; // saved embedding configs
  activeEmbeddingConfigId?: string; // which config is active
  tagMigrationV1Done?: boolean;
  userProfile?: UserProfile;
  builtinModelPath?: string; // deprecated: kept for migration only
  devMode?: boolean; // Developer mode: show welcome modal on every startup
  language?: 'en' | 'zh'; // Display language; undefined = auto-detected from OS on first launch
  overleafSessionCookieEncrypted?: string; // Encrypted Overleaf session cookie (overleaf_session2)
}

const DEFAULT_PROXY_SCOPE: ProxyScope = {
  pdfDownload: true,
  aiApi: true,
  cliTools: true,
};

const DEFAULT_SEMANTIC_SEARCH_SETTINGS: SemanticSearchSettings = {
  enabled: true,
  autoProcess: true,
  autoEnrich: true,
  embeddingModel: 'text-embedding-3-small',
  embeddingProvider: 'openai-compatible',
  recommendationExploration: 0.35,
};

// OpenAI embedding models
export const OPENAI_EMBEDDING_MODELS = [
  { id: 'text-embedding-ada-002', name: 'text-embedding-ada-002', dimensions: 1536 },
  { id: 'text-embedding-3-small', name: 'text-embedding-3-small', dimensions: 1536 },
  { id: 'text-embedding-3-large', name: 'text-embedding-3-large', dimensions: 3072 },
];

function getSettingsPath(): string {
  return getAppSettingsPath();
}

function getDefaultPapersDir(): string {
  return getPapersBaseDir();
}

function load(): AppSettings {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
      // Only reset papersDir if it's empty
      if (!saved.papersDir || saved.papersDir.trim() === '') {
        saved.papersDir = getDefaultPapersDir();
      }
      saved.semanticSearch = {
        ...DEFAULT_SEMANTIC_SEARCH_SETTINGS,
        ...saved.semanticSearch,
      };
      // Migration: remap legacy 'builtin' or 'ollama' provider to 'openai-compatible'
      if (saved.semanticSearch) {
        const p = saved.semanticSearch.embeddingProvider as string;
        if (p === 'builtin' || p === 'ollama') {
          saved.semanticSearch.embeddingProvider = 'openai-compatible';
          if (!saved.semanticSearch.embeddingApiBase && saved.semanticSearch.baseUrl) {
            saved.semanticSearch.embeddingApiBase = saved.semanticSearch.baseUrl;
          }
          // Default to text-embedding-3-small if coming from builtin
          if (p === 'builtin') {
            saved.semanticSearch.embeddingModel = 'text-embedding-3-small';
          }
        }
        // If no provider set yet, default to openai-compatible
        if (!saved.semanticSearch.embeddingProvider) {
          saved.semanticSearch.embeddingProvider = 'openai-compatible';
        }
      }
      // Migration: update embeddingConfigs to remove builtin provider
      if (saved.embeddingConfigs) {
        saved.embeddingConfigs = saved.embeddingConfigs
          .filter((c) => (c.provider as string) !== 'builtin')
          .map((c) => ({
            ...c,
            provider: 'openai-compatible',
          }));
        // Clear activeEmbeddingConfigId if all configs were builtin
        if (saved.embeddingConfigs.length === 0) {
          saved.activeEmbeddingConfigId = undefined;
        }
      }
      // No default embedding config created - user must configure one in Welcome/Settings
      return saved;
    }
  } catch {
    // ignore
  }
  return {
    papersDir: getDefaultPapersDir(),
    editorCommand: 'code',
    proxy: undefined,
    semanticSearch: DEFAULT_SEMANTIC_SEARCH_SETTINGS,
  };
}

function save(settings: AppSettings) {
  ensureStorageDir();
  const settingsPath = getSettingsPath();
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

export function getAppSettings(): AppSettings {
  return load();
}

export function setEditorCommand(cmd: string) {
  const settings = load();
  settings.editorCommand = cmd;
  save(settings);
}

export function getEditorCommand(): string {
  return load().editorCommand ?? 'code';
}

export function getPapersDir(): string {
  return getPapersBaseDir();
}

export function getProxy(): string | undefined {
  return load().proxy;
}

export function setProxy(proxy: string | undefined) {
  const settings = load();
  settings.proxy = proxy;
  save(settings);
}

export function getProxyEnabled(): boolean {
  const settings = load();
  // Default to true if proxy URL exists but enabled flag is not set (backward compatibility)
  if (settings.proxyEnabled === undefined && settings.proxy) {
    return true;
  }
  return settings.proxyEnabled ?? false;
}

export function setProxyEnabled(enabled: boolean) {
  const settings = load();
  settings.proxyEnabled = enabled;
  save(settings);
}

export function getProxyScope(): ProxyScope {
  const settings = load();
  return { ...DEFAULT_PROXY_SCOPE, ...settings.proxyScope };
}

export function setProxyScope(scope: ProxyScope) {
  const settings = load();
  settings.proxyScope = scope;
  save(settings);
}

export function getStorageRoot(): string {
  return getStorageDir();
}

export function getSemanticSearchSettings(): SemanticSearchSettings {
  return {
    ...DEFAULT_SEMANTIC_SEARCH_SETTINGS,
    ...load().semanticSearch,
  };
}

export function setSemanticSearchSettings(settings: Partial<SemanticSearchSettings>) {
  const current = load();
  current.semanticSearch = {
    ...DEFAULT_SEMANTIC_SEARCH_SETTINGS,
    ...current.semanticSearch,
    ...settings,
  };
  save(current);
}

export function setTagMigrationDone() {
  const settings = load();
  (settings as unknown as Record<string, unknown>).tagMigrationV1Done = true;
  save(settings);
}

export function isTagMigrationDone(): boolean {
  return !!(load() as unknown as Record<string, unknown>).tagMigrationV1Done;
}

export function getUserProfile(): UserProfile | undefined {
  return load().userProfile;
}

export function setUserProfile(profile: UserProfile) {
  const settings = load();
  settings.userProfile = profile;
  save(settings);
}

export function getEmbeddingConfigs(): EmbeddingConfig[] {
  return load().embeddingConfigs ?? [];
}

export function saveEmbeddingConfig(config: EmbeddingConfig): void {
  const settings = load();
  const configs = settings.embeddingConfigs ?? [];
  const idx = configs.findIndex((c) => c.id === config.id);
  if (idx >= 0) {
    configs[idx] = config;
  } else {
    configs.push(config);
  }
  settings.embeddingConfigs = configs;
  // Auto-activate if no active config
  if (!settings.activeEmbeddingConfigId) {
    settings.activeEmbeddingConfigId = config.id;
  }
  save(settings);
}

export function deleteEmbeddingConfig(id: string): void {
  const settings = load();
  settings.embeddingConfigs = (settings.embeddingConfigs ?? []).filter((c) => c.id !== id);
  if (settings.activeEmbeddingConfigId === id) {
    settings.activeEmbeddingConfigId = undefined;
  }
  save(settings);
}

export function getActiveEmbeddingConfigId(): string | null {
  return load().activeEmbeddingConfigId ?? null;
}

export function setActiveEmbeddingConfigId(id: string): void {
  const settings = load();
  settings.activeEmbeddingConfigId = id;
  save(settings);
}

export function getActiveEmbeddingConfig(): EmbeddingConfig | null {
  const settings = load();
  const activeId = settings.activeEmbeddingConfigId;
  if (!activeId) return null;
  return (settings.embeddingConfigs ?? []).find((c) => c.id === activeId) ?? null;
}

// Deprecated: builtin model path no longer used
export function getBuiltinModelPath(): string | undefined {
  return undefined;
}

// Deprecated: no-op
export function setBuiltinModelPath(_dirPath: string | undefined): void {
  // no-op
}

export function getDevMode(): boolean {
  return load().devMode ?? false;
}

export function setDevMode(enabled: boolean): void {
  const settings = load();
  settings.devMode = enabled;
  save(settings);
}

export function getLanguage(): 'en' | 'zh' {
  return load().language ?? 'zh';
}

export function setLanguage(lang: 'en' | 'zh'): void {
  const settings = load();
  settings.language = lang;
  save(settings);
}

/** Returns true if the user has explicitly set a language preference. */
export function hasLanguagePreference(): boolean {
  return load().language !== undefined;
}

// ── Overleaf Session Cookie ───────────────────────────────────────────────────

/**
 * Get the decrypted Overleaf session cookie.
 * Returns undefined if not set or decryption fails.
 */
export function getOverleafSessionCookie(): string | undefined {
  const encrypted = load().overleafSessionCookieEncrypted;
  if (!encrypted) return undefined;
  return decryptString(encrypted);
}

/**
 * Set the Overleaf session cookie (will be encrypted).
 * Pass undefined to clear.
 */
export function setOverleafSessionCookie(cookie: string | undefined): void {
  const settings = load();
  if (cookie) {
    settings.overleafSessionCookieEncrypted = encryptString(cookie);
  } else {
    settings.overleafSessionCookieEncrypted = undefined;
  }
  save(settings);
}

/**
 * Check if an Overleaf session cookie is configured.
 */
export function hasOverleafSessionCookie(): boolean {
  return !!load().overleafSessionCookieEncrypted;
}
