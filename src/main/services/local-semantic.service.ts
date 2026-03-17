import {
  getSemanticSearchSettings,
  type SemanticSearchSettings,
} from '../store/app-settings-store';
import type { EmbeddingProvider } from './embedding-provider';
import { OpenAICompatibleEmbeddingProvider } from './openai-compatible-embedding-provider';

export class LocalSemanticService {
  private provider: EmbeddingProvider | null = null;
  private currentProviderId: 'openai-compatible' | 'ollama' | null = null;

  private getSettings(overrides: Partial<SemanticSearchSettings> = {}): SemanticSearchSettings {
    return {
      ...getSemanticSearchSettings(),
      ...overrides,
    };
  }

  getOrCreateProvider(overrides: Partial<SemanticSearchSettings> = {}): EmbeddingProvider {
    const settings = this.getSettings(overrides);
    const providerId = settings.embeddingProvider ?? 'openai-compatible';
    const hasOverrides = Object.keys(overrides).length > 0;

    // Reuse cached provider only if no overrides and provider type is unchanged
    if (this.provider && this.currentProviderId === providerId && !hasOverrides) {
      return this.provider;
    }

    // If overrides are present, create a temporary provider (don't cache)
    if (hasOverrides) {
      return new OpenAICompatibleEmbeddingProvider(settings);
    }

    // Provider changed — dispose old one and cache new
    this.provider?.dispose();

    this.provider = new OpenAICompatibleEmbeddingProvider(settings);
    this.currentProviderId = providerId;
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
    this.currentProviderId = null;
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
