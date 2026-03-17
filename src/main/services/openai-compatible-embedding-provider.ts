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

/**
 * Normalize a base URL for OpenAI-compatible API.
 * Many users enter e.g. "http://localhost:11434" without the "/v1" suffix.
 * If the URL has no path or only "/" after the host, append "/v1".
 */
function normalizeBaseUrl(raw: string): string {
  const trimmed = trimTrailingSlash(raw);
  try {
    const parsed = new URL(trimmed);
    // Already has a meaningful path (e.g. /v1, /api, /openai) → use as-is
    if (parsed.pathname && parsed.pathname !== '/') {
      return trimmed;
    }
    // Bare host like http://127.0.0.1:11434 → append /v1
    return `${trimmed}/v1`;
  } catch {
    // Not a valid URL, return as-is
    return trimmed;
  }
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
    const baseUrl = normalizeBaseUrl(this.settings.embeddingApiBase ?? 'https://api.openai.com/v1');
    const apiKey = this.settings.embeddingApiKey ?? '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const url = `${baseUrl}/embeddings`;
    console.log(
      `[embedding] POST ${url} (model=${this.settings.embeddingModel}, texts=${texts.length}, rawBase=${this.settings.embeddingApiBase ?? '<undefined>'})`,
    );
    const response = await proxyFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.settings.embeddingModel,
        input: texts,
      }),
      timeoutMs: 120_000,
    });

    const body = response.text();

    // Try to parse even on non-200 status — some proxies (e.g. gptgod) return
    // valid embedding JSON with a wrong HTTP status code (502, etc.)
    let parsed: { data: Array<{ embedding: number[]; index: number }> } | null = null;
    try {
      const json = JSON.parse(body) as { data?: Array<{ embedding: number[]; index: number }> };
      if (json?.data?.length && json.data[0]?.embedding?.length) {
        parsed = json as { data: Array<{ embedding: number[]; index: number }> };
        if (!response.ok) {
          console.warn(
            `[embedding] Server returned HTTP ${response.status} but body contains valid embeddings — using them`,
          );
        }
      }
    } catch {
      // body is not valid JSON
    }

    if (!parsed) {
      if (!response.ok) {
        throw new Error(`Embedding request failed with status ${response.status}: ${body}`);
      }
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
