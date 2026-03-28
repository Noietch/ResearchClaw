import {
  getSemanticSearchSettings,
  type SemanticSearchSettings,
} from '../store/app-settings-store';
import type { EmbeddingProvider } from './embedding-provider';
import { OpenAICompatibleEmbeddingProvider } from './openai-compatible-embedding-provider';

export class LocalSemanticService {
  private provider: EmbeddingProvider | null = null;
  private currentProviderKey: string | null = null;

  private getSettings(overrides: Partial<SemanticSearchSettings> = {}): SemanticSearchSettings {
    return {
      ...getSemanticSearchSettings(),
      ...overrides,
    };
  }

  private getProviderKey(settings: SemanticSearchSettings): string {
    return JSON.stringify({
      provider: settings.embeddingProvider ?? 'openai-compatible',
      model: settings.embeddingModel,
      dimensions: settings.embeddingDimensions ?? null,
      baseUrl: settings.embeddingApiBase?.trim().replace(/\/+$/, '') ?? '',
      apiKey: settings.embeddingApiKey ?? '',
    });
  }

  getOrCreateProvider(overrides: Partial<SemanticSearchSettings> = {}): EmbeddingProvider {
    const settings = this.getSettings(overrides);
    const providerKey = this.getProviderKey(settings);

    if (this.provider && this.currentProviderKey === providerKey) {
      return this.provider;
    }

    // Recreate the provider whenever the effective embedding config changes.
    this.provider?.dispose();

    this.provider = new OpenAICompatibleEmbeddingProvider(settings);
    this.currentProviderKey = providerKey;
    return this.provider;
  }

  isEnabled(): boolean {
    return this.getSettings().enabled;
  }

  async embedTexts(
    texts: string[],
    overrides: Partial<SemanticSearchSettings> = {},
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const provider = this.getOrCreateProvider(overrides);
    await provider.initialize();
    return provider.embedTexts(texts);
  }

  switchProvider(): void {
    this.provider?.dispose();
    this.provider = null;
    this.currentProviderKey = null;
  }

  getProviderStatus() {
    return this.provider?.getStatus() ?? { ready: false };
  }

  /**
   * Check if the embedding provider is properly configured.
   * For openai-compatible provider, we need either:
   * - A custom API base URL, or
   * - An API key (to use the default OpenAI endpoint)
   */
  hasValidConfig(overrides: Partial<SemanticSearchSettings> = {}): boolean {
    const settings = this.getSettings(overrides);
    const providerId = settings.embeddingProvider ?? 'openai-compatible';

    if (providerId === 'openai-compatible') {
      // Valid if we have a custom base URL or an API key
      return !!(settings.embeddingApiBase?.trim() || settings.embeddingApiKey?.trim());
    }

    return false;
  }
}

export const localSemanticService = new LocalSemanticService();
