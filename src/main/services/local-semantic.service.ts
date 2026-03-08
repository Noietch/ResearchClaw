import {
  getSemanticSearchSettings,
  type SemanticSearchSettings,
} from '../store/app-settings-store';
import { proxyFetch } from './proxy-fetch';
import { ensureOllamaRunning } from './ollama.service';

// TODO: Add a built-in embedding provider so semantic indexing/search can run without requiring Ollama.
// Keep Ollama as an optional advanced provider once the provider abstraction is in place.

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
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

export class LocalSemanticService {
  private getSettings(overrides: Partial<SemanticSearchSettings> = {}): SemanticSearchSettings {
    return {
      ...getSemanticSearchSettings(),
      ...overrides,
    };
  }

  isEnabled(): boolean {
    return this.getSettings().enabled;
  }

  async embedTexts(
    texts: string[],
    overrides: Partial<SemanticSearchSettings> = {},
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const settings = this.getSettings(overrides);
    const baseUrl = trimTrailingSlash(settings.baseUrl);
    await ensureOllamaRunning({ trigger: 'semantic:embed', settings });
    const body = JSON.stringify({
      model: settings.embeddingModel,
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

    const fallbackVectors: number[][] = [];
    for (const text of texts) {
      const response = await proxyFetch(`${baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: settings.embeddingModel, prompt: text }),
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
}

export const localSemanticService = new LocalSemanticService();
