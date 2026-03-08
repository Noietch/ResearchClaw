import {
  getProviders,
  saveProvider,
  getActiveProviderId,
  setActiveProvider,
  getDecryptedApiKey,
  type ProviderConfig,
} from '../store/provider-store';
import {
  getAppSettings,
  setEditorCommand,
  getEditorCommand,
  getProxy,
  setProxy,
  getProxyScope,
  setProxyScope,
  getSemanticSearchSettings,
  setSemanticSearchSettings,
  getStorageRoot as getStorageRootPath,
  type ProxyScope,
  type SemanticSearchSettings,
} from '../store/app-settings-store';
import {
  getStorageDir,
  setStorageDir as writeStorageDir,
  migrateStorageDir,
} from '../store/storage-path';
import { testProxy as runTestProxy, type ProxyTestResult } from './proxy-test.service';
import { localSemanticService } from './local-semantic.service';
import {
  listSemanticModelPullJobs,
  startSemanticModelPull,
  warmupOllamaService,
  type SemanticModelPullJob,
} from './ollama.service';
import { proxyFetch } from './proxy-fetch';
import {
  PapersRepository,
  type SemanticIndexDebugSummary,
} from '../../db/repositories/papers.repository';
import { getSelectedModelInfo } from './ai-provider.service';
import * as vecIndex from './vec-index.service';

export interface SemanticEmbeddingTestResult {
  success: boolean;
  model: string;
  baseUrl: string;
  dimensions: number;
  elapsedMs: number;
  startedOllama: boolean;
  preview: number[];
}

export interface SemanticDebugProbeResult {
  ok: boolean;
  status?: number;
  error?: string;
  bodyPreview?: string;
  rawBody?: string;
}

export interface LightweightModelDebugInfo {
  configured: boolean;
  backend?: 'api' | 'cli';
  provider?: string;
  model?: string;
  baseURL?: string;
  hasApiKey?: boolean;
}

export interface SemanticDebugResult {
  success: boolean;
  baseUrl: string;
  embeddingModel: string;
  enabled: boolean;
  autoProcess: boolean;
  autoStartOllama: boolean;
  startedOllama: boolean;
  health: SemanticDebugProbeResult;
  endpoints: {
    tags: SemanticDebugProbeResult;
    embed: SemanticDebugProbeResult;
    embeddings: SemanticDebugProbeResult;
  };
  availableModels: string[];
  embeddingModelInstalled: boolean;
  indexSummary: SemanticIndexDebugSummary;
  lightweightModel: LightweightModelDebugInfo;
  notes: string[];
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function previewText(body: string, max = 160): string | undefined {
  const compact = body.replace(/\s+/g, ' ').trim();
  return compact ? compact.slice(0, max) : undefined;
}

function normalizeOllamaModelName(value: string): string {
  return value.trim().toLowerCase();
}

function ollamaModelAliases(value: string): string[] {
  const normalized = normalizeOllamaModelName(value);
  if (!normalized) return [];
  const base = normalized.split(':')[0];
  const aliases = new Set([normalized, base, `${base}:latest`]);
  return Array.from(aliases).filter(Boolean);
}

function hasOllamaModel(availableModels: string[], configuredModel: string): boolean {
  const available = new Set(availableModels.flatMap((model) => ollamaModelAliases(model)));
  return ollamaModelAliases(configuredModel).some((alias) => available.has(alias));
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function probe(
  url: string,
  options: Parameters<typeof proxyFetch>[1] = {},
): Promise<SemanticDebugProbeResult> {
  try {
    const response = await proxyFetch(url, options);
    const rawBody = response.text();
    return {
      ok: response.ok,
      status: response.status,
      bodyPreview: previewText(rawBody),
      rawBody,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function buildSemanticNotes(input: {
  baseUrl: string;
  embeddingModel: string;
  health: SemanticDebugProbeResult;
  tags: SemanticDebugProbeResult;
  embed: SemanticDebugProbeResult;
  embeddings: SemanticDebugProbeResult;
  embeddingModelInstalled: boolean;
  indexSummary: SemanticIndexDebugSummary;
  lightweightModel: LightweightModelDebugInfo;
}): string[] {
  const notes: string[] = [];

  if (!input.health.ok) {
    notes.push(
      `Cannot reach Ollama at ${input.baseUrl}. Check whether the base URL is correct and whether the local service is running.`,
    );
  }

  if (input.tags.ok && !input.embeddingModelInstalled) {
    notes.push(
      `Embedding model \`${input.embeddingModel}\` is not installed in Ollama. Download it from Settings or run \`ollama pull ${input.embeddingModel}\`.`,
    );
  }

  if (input.tags.ok && !input.embed.ok && !input.embeddings.ok) {
    notes.push(
      'Both embedding endpoints failed. This usually means the configured embedding model is missing or the base URL is not an Ollama API server.',
    );
  } else if (!input.embed.ok && input.embeddings.ok) {
    notes.push('`/api/embed` is unavailable, but legacy `/api/embeddings` still responds.');
  }

  if (!input.lightweightModel.configured) {
    notes.push(
      'No lightweight model is configured, so metadata extraction after upload will be skipped.',
    );
  } else if (input.lightweightModel.backend === 'api' && !input.lightweightModel.hasApiKey) {
    notes.push(
      'The selected lightweight API model is missing an API key, so metadata extraction will fail until Settings > Models is fixed.',
    );
  }

  if (input.indexSummary.totalChunks === 0) {
    notes.push(
      'No semantic chunks are indexed yet, so semantic search will fall back to normal search.',
    );
  }

  if (input.indexSummary.failedPapers > 0) {
    notes.push(
      `${input.indexSummary.failedPapers} paper(s) failed semantic processing and may need retry after fixing the embedding model or base URL.`,
    );
  }

  return notes;
}

export class ProvidersService {
  private papersRepository = new PapersRepository();

  listProviders(): (ProviderConfig & { hasApiKey: boolean })[] {
    const providers = getProviders();
    return providers.map((p) => ({
      ...p,
      hasApiKey: !!p.apiKeyEncrypted,
      apiKeyEncrypted: undefined,
    }));
  }

  save(config: Omit<ProviderConfig, 'apiKeyEncrypted'> & { apiKey?: string }): {
    success: boolean;
  } {
    saveProvider(config);
    return { success: true };
  }

  getActiveId(): string {
    return getActiveProviderId();
  }

  setActive(id: string): { success: boolean } {
    setActiveProvider(id);
    return { success: true };
  }

  getMaskedApiKey(providerId: string): string | null {
    const key = getDecryptedApiKey(providerId);
    if (!key) return null;
    return key.slice(0, 8) + '...' + key.slice(-4);
  }

  getSettings() {
    return getAppSettings();
  }

  setStorageDir(newDir: string): { success: boolean; error?: string } {
    const oldDir = getStorageDir();
    if (oldDir === newDir) return { success: true };
    const result = migrateStorageDir(oldDir, newDir);
    if (!result.success) return result;
    writeStorageDir(newDir);
    return { success: true };
  }

  setEditor(cmd: string): { success: boolean } {
    setEditorCommand(cmd);
    return { success: true };
  }

  getEditor(): string {
    return getEditorCommand();
  }

  setProxy(proxy: string | undefined): { success: boolean } {
    setProxy(proxy || undefined);
    return { success: true };
  }

  getProxyUrl(): string | undefined {
    return getProxy();
  }

  getProxyScopeSettings(): ProxyScope {
    return getProxyScope();
  }

  setProxyScopeSettings(scope: ProxyScope): { success: boolean } {
    setProxyScope(scope);
    return { success: true };
  }

  async testProxy(proxyUrl?: string): Promise<{ hasProxy: boolean; results: ProxyTestResult[] }> {
    return runTestProxy(proxyUrl);
  }

  getStorageRoot(): string {
    return getStorageRootPath();
  }

  getSemanticSearchSettings(): SemanticSearchSettings {
    return getSemanticSearchSettings();
  }

  setSemanticSearchSettings(settings: Partial<SemanticSearchSettings>): { success: boolean } {
    const current = getSemanticSearchSettings();
    setSemanticSearchSettings(settings);

    // If embedding model changed, reset vec index and clear indexedAt
    if (settings.embeddingModel && settings.embeddingModel !== current.embeddingModel) {
      console.log(
        `[providers] Embedding model changed: ${current.embeddingModel} → ${settings.embeddingModel}, resetting vec index`,
      );
      try {
        vecIndex.resetIndex();
      } catch (err) {
        console.warn('[providers] Failed to reset vec index:', err);
      }
      void this.papersRepository
        .clearAllIndexedAt()
        .catch((err) => console.warn('[providers] Failed to clear indexedAt:', err));
    }

    return { success: true };
  }

  async testSemanticEmbedding(
    settingsOverrides: Partial<SemanticSearchSettings> = {},
  ): Promise<SemanticEmbeddingTestResult> {
    const settings = {
      ...getSemanticSearchSettings(),
      ...settingsOverrides,
    };
    const startedAt = Date.now();
    const startedOllama = await warmupOllamaService('settings-test-embedding', settings);
    const [embedding] = await localSemanticService.embedTexts(
      ['Vibe Research semantic embedding test.'],
      settings,
    );

    if (!embedding?.length) {
      throw new Error('Embedding model returned an empty vector.');
    }

    return {
      success: true,
      model: settings.embeddingModel,
      baseUrl: settings.baseUrl,
      dimensions: embedding.length,
      elapsedMs: Date.now() - startedAt,
      startedOllama,
      preview: embedding.slice(0, 5),
    };
  }

  startSemanticModelPull(
    settingsOverrides: Partial<SemanticSearchSettings> = {},
  ): SemanticModelPullJob {
    return startSemanticModelPull(settingsOverrides);
  }

  listSemanticModelPullJobs(): SemanticModelPullJob[] {
    return listSemanticModelPullJobs();
  }

  async getSemanticDebugInfo(
    settingsOverrides: Partial<SemanticSearchSettings> = {},
  ): Promise<SemanticDebugResult> {
    const settings = {
      ...getSemanticSearchSettings(),
      ...settingsOverrides,
    };
    const baseUrl = trimTrailingSlash(settings.baseUrl);
    const startedOllama = await warmupOllamaService('settings-debug', settings);

    const [health, tags, embed, embeddings, indexSummary] = await Promise.all([
      probe(`${baseUrl}/api/tags`),
      probe(`${baseUrl}/api/tags`),
      probe(`${baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.embeddingModel,
          input: ['Vibe Research semantic debug probe.'],
        }),
        timeoutMs: 30_000,
      }),
      probe(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.embeddingModel,
          prompt: 'Vibe Research semantic debug probe.',
        }),
        timeoutMs: 30_000,
      }),
      this.papersRepository.getSemanticIndexDebugSummary(),
    ]);

    const tagsPayload = safeJsonParse<{
      models?: Array<{ name?: string; model?: string }>;
    }>(tags.rawBody ?? '');
    const availableModels = (tagsPayload?.models ?? [])
      .map((model) => model.name ?? model.model ?? '')
      .map((name) => name.trim())
      .filter(Boolean);

    const embeddingModelInstalled = hasOllamaModel(availableModels, settings.embeddingModel);
    const selectedLightweightModel = getSelectedModelInfo('lightweight');
    const lightweightModel: LightweightModelDebugInfo = selectedLightweightModel
      ? {
          configured: true,
          backend: selectedLightweightModel.backend,
          provider: selectedLightweightModel.provider,
          model: selectedLightweightModel.model,
          baseURL: selectedLightweightModel.baseURL,
          hasApiKey: selectedLightweightModel.hasApiKey,
        }
      : { configured: false };

    return {
      success: true,
      baseUrl,
      embeddingModel: settings.embeddingModel,
      enabled: settings.enabled,
      autoProcess: settings.autoProcess,
      autoStartOllama: settings.autoStartOllama,
      startedOllama,
      health,
      endpoints: { tags, embed, embeddings },
      availableModels,
      embeddingModelInstalled,
      indexSummary,
      lightweightModel,
      notes: buildSemanticNotes({
        baseUrl,
        embeddingModel: settings.embeddingModel,
        health,
        tags,
        embed,
        embeddings,
        embeddingModelInstalled,
        indexSummary,
        lightweightModel,
      }),
    };
  }
}

export const providersService = new ProvidersService();
