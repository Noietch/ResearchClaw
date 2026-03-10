import {
  getSemanticSearchSettings,
  type SemanticSearchSettings,
} from '../store/app-settings-store';
import type { EmbeddingProvider } from './embedding-provider';
import { BuiltinEmbeddingProvider } from './builtin-embedding-provider';
import { OpenAICompatibleEmbeddingProvider } from './openai-compatible-embedding-provider';

export class LocalSemanticService {
  private provider: EmbeddingProvider | null = null;
  private currentProviderId: 'builtin' | 'openai-compatible' | null = null;

  private getSettings(overrides: Partial<SemanticSearchSettings> = {}): SemanticSearchSettings {
    return {
      ...getSemanticSearchSettings(),
      ...overrides,
    };
  }

  getOrCreateProvider(overrides: Partial<SemanticSearchSettings> = {}): EmbeddingProvider {
    const settings = this.getSettings(overrides);
    const providerId = settings.embeddingProvider ?? 'builtin';

    if (this.provider && this.currentProviderId === providerId) {
      return this.provider;
    }

    // Provider changed — dispose old one
    this.provider?.dispose();

    if (providerId === 'builtin') {
      this.provider = new BuiltinEmbeddingProvider();
    } else {
      this.provider = new OpenAICompatibleEmbeddingProvider(settings);
    }

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
}

export const localSemanticService = new LocalSemanticService();
