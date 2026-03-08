import { getSemanticSearchSettings } from '../store/app-settings-store';
import { proxyFetch } from './proxy-fetch';

export interface ExtractedMetadata {
  title?: string;
  authors?: string[];
  abstract?: string;
  submittedAt?: Date | null;
}

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
  private getSettings() {
    return getSemanticSearchSettings();
  }

  isEnabled(): boolean {
    return this.getSettings().enabled;
  }

  async embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const settings = this.getSettings();
    const baseUrl = trimTrailingSlash(settings.baseUrl);
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

  async extractMetadata(text: string): Promise<ExtractedMetadata> {
    const settings = this.getSettings();
    const baseUrl = trimTrailingSlash(settings.baseUrl);
    const prompt = [
      'Extract metadata from the following academic paper text.',
      'Return strict JSON with keys: title, authors, abstract, submittedAt.',
      'Use an ISO date string or null for submittedAt.',
      'If a field cannot be determined, return null or an empty array.',
      '',
      text.slice(0, 18000),
    ].join('\n');

    const response = await proxyFetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.metadataModel,
        prompt,
        stream: false,
        format: 'json',
      }),
      timeoutMs: 120_000,
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {};
      }
      throw new Error(`Metadata extraction failed with status ${response.status}`);
    }

    const parsed = safeJsonParse<{ response?: string }>(response.text());
    const payload = safeJsonParse<{
      title?: string | null;
      authors?: string[] | null;
      abstract?: string | null;
      submittedAt?: string | null;
    }>(parsed?.response ?? '');

    return {
      title: payload?.title?.trim() || undefined,
      authors: Array.isArray(payload?.authors)
        ? payload!.authors.map((author) => author.trim()).filter(Boolean)
        : undefined,
      abstract: payload?.abstract?.trim() || undefined,
      submittedAt: payload?.submittedAt ? new Date(payload.submittedAt) : undefined,
    };
  }
}

export const localSemanticService = new LocalSemanticService();
