import { BrowserWindow } from 'electron';
import {
  getProviders,
  saveProvider,
  getActiveProviderId,
  setActiveProvider,
  getDecryptedApiKey,
  type ProviderConfig,
} from '../store/provider-store';
import { BuiltinEmbeddingProvider, type ModelDownloadProgress } from './builtin-embedding-provider';
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
  getEmbeddingConfigs,
  saveEmbeddingConfig,
  deleteEmbeddingConfig,
  getActiveEmbeddingConfigId,
  setActiveEmbeddingConfigId,
  type ProxyScope,
  type SemanticSearchSettings,
  type EmbeddingConfig,
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
  type SemanticModelPullJob,
} from './ollama.service';
import {
  PapersRepository,
  type SemanticIndexDebugSummary,
} from '../../db/repositories/papers.repository';
import { getSelectedModelInfo } from './ai-provider.service';
import * as vecIndex from './vec-index.service';
import * as searchUnitIndex from './search-unit-index.service';

export interface SemanticEmbeddingTestResult {
  success: boolean;
  model: string;
  baseUrl: string;
  dimensions: number;
  elapsedMs: number;
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
  autoEnrich: boolean;
  indexSummary: SemanticIndexDebugSummary;
  lightweightModel: LightweightModelDebugInfo;
  notes: string[];
}

function buildSemanticNotes(input: {
  lightweightModel: LightweightModelDebugInfo;
  indexSummary: SemanticIndexDebugSummary;
}): string[] {
  const notes: string[] = [];

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
      `${input.indexSummary.failedPapers} paper(s) failed semantic processing and may need retry.`,
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

  async testProxy(
    proxyUrl?: string | null,
  ): Promise<{ hasProxy: boolean; results: ProxyTestResult[] }> {
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

    // If embedding model or provider changed, reset vec index and clear indexedAt
    const modelChanged =
      settings.embeddingModel && settings.embeddingModel !== current.embeddingModel;
    const providerChanged =
      settings.embeddingProvider && settings.embeddingProvider !== current.embeddingProvider;

    if (modelChanged || providerChanged) {
      const reason = providerChanged
        ? `provider changed: ${current.embeddingProvider} → ${settings.embeddingProvider}`
        : `model changed: ${current.embeddingModel} → ${settings.embeddingModel}`;
      console.log(`[providers] ${reason}, resetting vec index`);
      try {
        vecIndex.resetIndex();
        searchUnitIndex.resetIndex();
      } catch (err) {
        console.warn('[providers] Failed to reset vec index:', err);
      }
      void this.papersRepository
        .clearAllIndexedAt()
        .catch((err) => console.warn('[providers] Failed to clear indexedAt:', err));
      localSemanticService.switchProvider();
    }

    return { success: true };
  }

  listEmbeddingConfigs(): { configs: EmbeddingConfig[]; activeId: string | null } {
    // Filter out builtin configs — the builtin card is always shown as a fixed card in the UI
    const allConfigs = getEmbeddingConfigs();
    const userConfigs = allConfigs.filter((c) => c.provider !== 'builtin');
    const rawActiveId = getActiveEmbeddingConfigId();
    // Map to '__builtin__' if: no active set, active is the virtual builtin id, or active config has builtin provider
    const activeConfig = allConfigs.find((c) => c.id === rawActiveId);
    const activeId =
      !rawActiveId || rawActiveId === '__builtin__' || activeConfig?.provider === 'builtin'
        ? '__builtin__'
        : rawActiveId;
    return { configs: userConfigs, activeId };
  }

  saveEmbeddingConfig(config: EmbeddingConfig): { success: boolean } {
    saveEmbeddingConfig(config);
    return { success: true };
  }

  deleteEmbeddingConfig(id: string): { success: boolean } {
    deleteEmbeddingConfig(id);
    return { success: true };
  }

  switchEmbeddingConfig(config: EmbeddingConfig): { success: boolean } {
    const current = getSemanticSearchSettings();
    setActiveEmbeddingConfigId(config.id);

    // Merge config into semanticSearch settings
    setSemanticSearchSettings({
      embeddingProvider: config.provider,
      embeddingModel: config.embeddingModel,
      embeddingApiBase: config.embeddingApiBase,
      embeddingApiKey: config.embeddingApiKey,
    });

    const modelChanged = config.embeddingModel !== current.embeddingModel;
    const providerChanged = config.provider !== current.embeddingProvider;

    if (modelChanged || providerChanged) {
      const reason = providerChanged
        ? `provider changed: ${current.embeddingProvider} → ${config.provider}`
        : `model changed: ${current.embeddingModel} → ${config.embeddingModel}`;
      console.log(`[providers] ${reason}, resetting vec index`);
      try {
        vecIndex.resetIndex();
        searchUnitIndex.resetIndex();
      } catch (err) {
        console.warn('[providers] Failed to reset vec index:', err);
      }
      void this.papersRepository
        .clearAllIndexedAt()
        .catch((err) => console.warn('[providers] Failed to clear indexedAt:', err));
      localSemanticService.switchProvider();
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

    const [embedding] = await localSemanticService.embedTexts(
      ['ResearchClaw semantic embedding test.'],
      settings,
    );

    if (!embedding?.length) {
      throw new Error('Embedding model returned an empty vector.');
    }

    const providerName =
      (settings.embeddingProvider ?? 'builtin') === 'builtin'
        ? 'all-MiniLM-L6-v2'
        : settings.embeddingModel;

    return {
      success: true,
      model: providerName,
      baseUrl:
        settings.embeddingProvider === 'openai-compatible'
          ? (settings.embeddingApiBase ?? 'https://api.openai.com/v1')
          : 'local',
      dimensions: embedding.length,
      elapsedMs: Date.now() - startedAt,
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

  getBuiltinModelStatus() {
    return localSemanticService.getProviderStatus();
  }

  checkBuiltinModelExists(): { exists: boolean; modelPath: string } {
    const provider = new BuiltinEmbeddingProvider();
    return { exists: provider.checkModelExists(), modelPath: provider.getModelPath() };
  }

  startBuiltinModelDownload(): void {
    const provider = new BuiltinEmbeddingProvider();

    const broadcast = (progress: ModelDownloadProgress) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('settings:builtinModelDownloadProgress', progress);
      }
    };

    provider.downloadModel(broadcast).catch((err: unknown) => {
      const error = err instanceof Error ? err.message : String(err);
      broadcast({ phase: 'error', error });
    });
  }

  async getSemanticDebugInfo(
    settingsOverrides: Partial<SemanticSearchSettings> = {},
  ): Promise<SemanticDebugResult> {
    const settings = {
      ...getSemanticSearchSettings(),
      ...settingsOverrides,
    };

    const [indexSummary] = await Promise.all([
      this.papersRepository.getSemanticIndexDebugSummary(),
    ]);

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
      baseUrl:
        settings.embeddingProvider === 'openai-compatible'
          ? (settings.embeddingApiBase ?? 'https://api.openai.com/v1')
          : 'local',
      embeddingModel: settings.embeddingModel,
      enabled: settings.enabled,
      autoProcess: settings.autoProcess,
      autoEnrich: settings.autoEnrich,
      indexSummary,
      lightweightModel,
      notes: buildSemanticNotes({ lightweightModel, indexSummary }),
    };
  }
}

export const providersService = new ProvidersService();
