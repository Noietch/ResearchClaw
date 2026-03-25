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
  getProxyEnabled,
  setProxyEnabled,
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
  getDevMode,
  setDevMode,
  getLanguage,
  setLanguage,
  getEffectiveEmbeddingDimensions,
  hasLanguagePreference,
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

  getProxyEnabledState(): boolean {
    return getProxyEnabled();
  }

  setProxyEnabledState(enabled: boolean): { success: boolean } {
    setProxyEnabled(enabled);
    return { success: true };
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

  async setSemanticSearchSettings(
    settings: Partial<SemanticSearchSettings>,
  ): Promise<{ success: boolean }> {
    const current = getSemanticSearchSettings();
    const next = {
      ...current,
      ...settings,
    };
    setSemanticSearchSettings(settings);

    const currentDimensions = getEffectiveEmbeddingDimensions(current);
    const nextDimensions = getEffectiveEmbeddingDimensions(next);
    const modelChanged = next.embeddingModel !== current.embeddingModel;
    const providerChanged = next.embeddingProvider !== current.embeddingProvider;
    const baseUrlChanged =
      settings.embeddingApiBase !== undefined &&
      settings.embeddingApiBase !== current.embeddingApiBase;
    const apiKeyChanged =
      settings.embeddingApiKey !== undefined &&
      settings.embeddingApiKey !== current.embeddingApiKey;
    const dimensionsChanged =
      settings.embeddingDimensions !== undefined && nextDimensions !== currentDimensions;

    if (modelChanged || providerChanged || baseUrlChanged || apiKeyChanged || dimensionsChanged) {
      console.log('[providers] Semantic search settings changed, refreshing provider');
      localSemanticService.switchProvider();

      if (modelChanged || providerChanged || dimensionsChanged) {
        console.log('[providers] Model/provider/dimensions changed, resetting vec index');
        try {
          vecIndex.clear();
        } catch (err) {
          console.warn('[providers] Failed to reset vec index:', err);
        }
        void this.papersRepository
          .clearAllIndexedAt()
          .catch((err) => console.warn('[providers] Failed to clear indexedAt:', err));
      }
    }

    return { success: true };
  }

  listEmbeddingConfigs(): { configs: EmbeddingConfig[]; activeId: string | null } {
    const allConfigs = getEmbeddingConfigs();
    const activeId = getActiveEmbeddingConfigId();
    return { configs: allConfigs, activeId };
  }

  saveEmbeddingConfig(config: EmbeddingConfig): { success: boolean } {
    saveEmbeddingConfig(config);
    return { success: true };
  }

  deleteEmbeddingConfig(id: string): { success: boolean } {
    deleteEmbeddingConfig(id);
    return { success: true };
  }

  async switchEmbeddingConfig(config: EmbeddingConfig): Promise<{ success: boolean }> {
    const current = getSemanticSearchSettings();
    setActiveEmbeddingConfigId(config.id);

    // Merge config into semanticSearch settings
    setSemanticSearchSettings({
      embeddingProvider: config.provider,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
      embeddingApiBase: config.embeddingApiBase,
      embeddingApiKey: config.embeddingApiKey,
    });

    const currentDimensions = getEffectiveEmbeddingDimensions(current);
    const nextDimensions = getEffectiveEmbeddingDimensions({
      ...current,
      embeddingProvider: config.provider,
      embeddingModel: config.embeddingModel,
      embeddingDimensions: config.embeddingDimensions,
    });
    const modelChanged = config.embeddingModel !== current.embeddingModel;
    const providerChanged = config.provider !== current.embeddingProvider;
    const baseUrlChanged = config.embeddingApiBase !== current.embeddingApiBase;
    const apiKeyChanged = config.embeddingApiKey !== current.embeddingApiKey;
    const dimensionsChanged = nextDimensions !== currentDimensions;

    // Always refresh provider when any config field changes
    if (modelChanged || providerChanged || baseUrlChanged || apiKeyChanged || dimensionsChanged) {
      const changes: string[] = [];
      if (providerChanged)
        changes.push(`provider: ${current.embeddingProvider} → ${config.provider}`);
      if (modelChanged) changes.push(`model: ${current.embeddingModel} → ${config.embeddingModel}`);
      if (dimensionsChanged)
        changes.push(
          `dimensions: ${currentDimensions ?? '<default>'} → ${nextDimensions ?? '<default>'}`,
        );
      if (baseUrlChanged)
        changes.push(
          `baseUrl: ${current.embeddingApiBase ?? '<none>'} → ${config.embeddingApiBase ?? '<none>'}`,
        );
      if (apiKeyChanged) changes.push('apiKey changed');
      console.log(`[providers] Embedding config changed (${changes.join(', ')})`);

      // Force provider to recreate with new settings
      localSemanticService.switchProvider();

      if (modelChanged || providerChanged || dimensionsChanged) {
        try {
          vecIndex.clear();
        } catch (err) {
          console.warn('[providers] Failed to reset vec index:', err);
        }
        void this.papersRepository
          .clearAllIndexedAt()
          .catch((err) => console.warn('[providers] Failed to clear indexedAt:', err));
      }
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

    return {
      success: true,
      model: settings.embeddingModel || 'unknown',
      baseUrl: settings.embeddingApiBase ?? 'https://api.openai.com/v1',
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

  getDevMode(): boolean {
    return getDevMode();
  }

  setDevMode(enabled: boolean): { success: boolean } {
    setDevMode(enabled);
    return { success: true };
  }

  getLanguage(): 'en' | 'zh' {
    return getLanguage();
  }

  setLanguage(lang: 'en' | 'zh'): { success: boolean } {
    setLanguage(lang);
    return { success: true };
  }

  hasLanguagePreference(): boolean {
    return hasLanguagePreference();
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
      baseUrl: settings.embeddingApiBase ?? 'https://api.openai.com/v1',
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
