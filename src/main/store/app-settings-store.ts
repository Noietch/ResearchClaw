import fs from 'fs';
import {
  ensureStorageDir,
  getAppSettingsPath,
  getPapersBaseDir,
  getStorageDir,
} from './storage-path';
import type { UserProfile } from '@shared';

export interface ProxyScope {
  pdfDownload: boolean; // PDF downloads from arxiv etc.
  aiApi: boolean; // AI API calls (Anthropic, OpenAI, Gemini)
  cliTools: boolean; // CLI tools (claude, codex, gemini)
}

export interface SemanticSearchSettings {
  enabled: boolean;
  autoProcess: boolean;
  autoEnrich: boolean;
  autoStartOllama: boolean;
  baseUrl: string;
  embeddingModel: string;
  embeddingProvider: 'builtin' | 'ollama';
  recommendationExploration: number;
}

interface AppSettings {
  papersDir?: string; // legacy field — ignored, papers are always at {storageRoot}/papers
  editorCommand: string; // e.g. "code" or "cursor"
  proxy?: string; // HTTP/SOCKS proxy URL, e.g. "http://127.0.0.1:7890" or "socks5://127.0.0.1:1080"
  proxyScope?: ProxyScope; // Where to use the proxy
  semanticSearch?: SemanticSearchSettings;
  tagMigrationV1Done?: boolean;
  userProfile?: UserProfile;
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
  autoStartOllama: true,
  baseUrl: 'http://127.0.0.1:11434',
  embeddingModel: 'nomic-embed-text',
  embeddingProvider: 'builtin',
  recommendationExploration: 0.35,
};

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
      // Migration: if user had custom Ollama settings but no explicit embeddingProvider,
      // default them to 'ollama' to preserve their existing setup
      if (
        saved.semanticSearch &&
        !saved.semanticSearch.embeddingProvider &&
        (saved.semanticSearch.baseUrl !== DEFAULT_SEMANTIC_SEARCH_SETTINGS.baseUrl ||
          saved.semanticSearch.embeddingModel !== DEFAULT_SEMANTIC_SEARCH_SETTINGS.embeddingModel)
      ) {
        saved.semanticSearch.embeddingProvider = 'ollama';
      }
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
