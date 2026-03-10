import type {
  EmbeddingProvider,
  EmbeddingProviderInfo,
  EmbeddingProviderStatus,
} from './embedding-provider';
import type { SemanticSearchSettings } from '../store/app-settings-store';
import { proxyFetch } from './proxy-fetch';
import { ensureOllamaRunning } from './ollama.service';

function trimTrailingSlash(value: string | undefined): string {
  return (value ?? '').replace(/\/+$/, '');
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly info: EmbeddingProviderInfo;
  private settings: SemanticSearchSettings;
  private status: EmbeddingProviderStatus = { ready: false };

  constructor(settings: SemanticSearchSettings) {
    this.settings = settings;
    this.info = {
      id: 'ollama',
      name: 'Ollama',
      modelName: settings.embeddingModel,
      dimensions: 0, // determined at runtime
    };
  }

  async initialize(): Promise<void> {
    await ensureOllamaRunning({ trigger: 'semantic:embed', settings: this.settings });
    this.status = { ready: true };
  }

  getStatus(): EmbeddingProviderStatus {
    return { ...this.status };
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    const baseUrl = trimTrailingSlash(this.settings.baseUrl);
    const body = JSON.stringify({
      model: this.settings.embeddingModel,
      input: texts,
    });

    const primary = await proxyFetch(`${baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      timeoutMs: 120_000,
    }).catch(() => null);

    if (primary?.ok) {
      const parsed = safeJsonParse<{ embeddings?: number[][]; embedding?: number[] }>(
        primary.text(),
      );
      if (parsed?.embeddings?.length) return parsed.embeddings;
      if (parsed?.embedding?.length) return [parsed.embedding];
    }

    // Fallback to legacy endpoint (one text at a time)
    const fallbackVectors: number[][] = [];
    for (const text of texts) {
      const response = await proxyFetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.settings.embeddingModel, prompt: text }),
        timeoutMs: 120_000,
      });
      if (!response.ok) {
        throw new Error(`Embedding request failed with status ${response.status}`);
      }
      const parsed = safeJsonParse<{ embedding?: number[] }>(response.text());
      if (!parsed?.embedding?.length) {
        throw new Error('Embedding response did not include a vector');
      }
      fallbackVectors.push(parsed.embedding);
    }

    return fallbackVectors;
  }

  dispose(): void {
    this.status = { ready: false };
  }
}
