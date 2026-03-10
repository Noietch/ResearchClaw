import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingProviderStatus,
} from './embedding-provider';
import type { SemanticSearchSettings } from '../store/app-settings-store';
import { proxyFetch } from './proxy-fetch';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly info: EmbeddingProviderInfo;
  private settings: SemanticSearchSettings;
  private status: EmbeddingProviderStatus = { ready: false };

  constructor(settings: SemanticSearchSettings) {
    this.settings = settings;
    this.info = {
      id: 'openai-compatible',
      name: 'OpenAI-compatible',
      modelName: settings.embeddingModel,
      dimensions: 0, // determined at runtime
    };
  }

  async initialize(): Promise<void> {
    this.status = { ready: true };
  }

  getStatus(): EmbeddingProviderStatus {
    return { ...this.status };
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const baseUrl = trimTrailingSlash(
      this.settings.embeddingApiBase ?? 'https://api.openai.com/v1',
    );
    const apiKey = this.settings.embeddingApiKey ?? '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await proxyFetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.settings.embeddingModel,
        input: texts,
      }),
      timeoutMs: 120_000,
    });

    if (!response.ok) {
      throw new Error(
        `Embedding request failed with status ${response.status}: ${response.text()}`,
      );
    }

    const parsed = JSON.parse(response.text()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    if (!parsed?.data?.length) {
      throw new Error('Embedding response did not include vectors');
    }

    // Sort by index to preserve order
    const sorted = [...parsed.data].sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  }

  dispose(): void {
    this.status = { ready: false };
  }
}
