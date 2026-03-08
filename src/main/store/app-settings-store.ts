import fs from 'fs';
import {
  ensureStorageDir,
  getAppSettingsPath,
  getPapersBaseDir,
  getStorageDir,
} from './storage-path';

export interface ProxyScope {
  pdfDownload: boolean; // PDF downloads from arxiv etc.
  aiApi: boolean; // AI API calls (Anthropic, OpenAI, Gemini)
  cliTools: boolean; // CLI tools (claude, codex, gemini)
}

export interface SemanticSearchSettings {
  enabled: boolean;
  autoProcess: boolean;
  autoStartOllama: boolean;
  baseUrl: string;
  metadataModel: string;
  embeddingModel: string;
}

interface AppSettings {
  papersDir: string;
  editorCommand: string; // e.g. "code" or "cursor"
  proxy?: string; // HTTP/SOCKS proxy URL, e.g. "http://127.0.0.1:7890" or "socks5://127.0.0.1:1080"
  proxyScope?: ProxyScope; // Where to use the proxy
  semanticSearch?: SemanticSearchSettings;
  tagMigrationV1Done?: boolean;
}

const DEFAULT_PAPERS_DIR = getPapersBaseDir();

const DEFAULT_PROXY_SCOPE: ProxyScope = {
  pdfDownload: true,
  aiApi: true,
  cliTools: true,
};

const DEFAULT_SEMANTIC_SEARCH_SETTINGS: SemanticSearchSettings = {
  enabled: true,
  autoProcess: true,
  autoStartOllama: true,
  baseUrl: 'http://127.0.0.1:11434',
  metadataModel: 'llama3.2',
  embeddingModel: 'nomic-embed-text',
};

function getSettingsPath(): string {
  return getAppSettingsPath();
}

function load(): AppSettings {
  try {
    const settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      const saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as AppSettings;
      // Only reset papersDir if it's empty
      if (!saved.papersDir || saved.papersDir.trim() === '') {
        saved.papersDir = DEFAULT_PAPERS_DIR;
      }
      saved.semanticSearch = {
        ...DEFAULT_SEMANTIC_SEARCH_SETTINGS,
        ...saved.semanticSearch,
      };
      return saved;
    }
  } catch {
    // ignore
  }
  return {
    papersDir: DEFAULT_PAPERS_DIR,
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

export function setPapersDir(dir: string) {
  const settings = load();
  settings.papersDir = dir;
  save(settings);
  process.env.VIBE_PAPERS_DIR = dir;
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
  const env = process.env.VIBE_PAPERS_DIR;
  if (env) return env;
  return load().papersDir;
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
