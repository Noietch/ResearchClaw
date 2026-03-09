import { normalizeWhitespace, sanitizeSemanticText } from './semantic-utils';

export interface SearchUnitDraft {
  unitType: 'title' | 'abstract' | 'sentence';
  sourceChunkIndex: number | null;
  unitIndex: number;
  content: string;
  contentPreview: string;
  normalizedText: string;
}

function buildPreview(content: string): string {
  return normalizeWhitespace(content).slice(0, 240);
}

function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?。！？])\s+/)
    .map((part) => normalizeWhitespace(part))
    .filter(Boolean);
}

function mergeShortSentences(sentences: string[]): string[] {
  const merged: string[] = [];
  let buffer = '';

  const flush = () => {
    const normalized = normalizeWhitespace(buffer);
    if (normalized) merged.push(normalized);
    buffer = '';
  };

  for (const sentence of sentences) {
    if (!buffer) {
      buffer = sentence;
      if (buffer.length >= 40) flush();
      continue;
    }

    if (buffer.length < 40) {
      buffer = `${buffer} ${sentence}`;
      if (buffer.length >= 40) flush();
      continue;
    }

    flush();
    buffer = sentence;
    if (buffer.length >= 40) flush();
  }

  if (buffer) flush();
  return merged;
}

export function buildSearchUnits(input: {
  title: string;
  abstract?: string | null;
  chunks: Array<{ chunkIndex: number; content: string }>;
}): SearchUnitDraft[] {
  const units: SearchUnitDraft[] = [];
  const seenNormalized = new Set<string>();

  const pushUnit = (
    unitType: SearchUnitDraft['unitType'],
    content: string,
    options: { sourceChunkIndex: number | null; unitIndex: number; dedupe?: boolean },
  ) => {
    const sanitized = sanitizeSemanticText(content);
    const normalized = normalizeWhitespace(sanitized);
    if (!normalized) return;
    if (options.dedupe && seenNormalized.has(normalized)) return;
    if (options.dedupe) seenNormalized.add(normalized);

    units.push({
      unitType,
      sourceChunkIndex: options.sourceChunkIndex,
      unitIndex: options.unitIndex,
      content: sanitized,
      contentPreview: buildPreview(sanitized),
      normalizedText: normalized.toLowerCase(),
    });
  };

  pushUnit('title', input.title, { sourceChunkIndex: null, unitIndex: 0 });

  const abstractText = normalizeWhitespace(sanitizeSemanticText(input.abstract ?? ''));
  if (abstractText.length >= 80 && abstractText.length <= 1200) {
    pushUnit('abstract', abstractText, { sourceChunkIndex: null, unitIndex: 0 });
  }

  for (const chunk of input.chunks) {
    const sentences = mergeShortSentences(splitIntoSentences(chunk.content)).filter(
      (sentence) => sentence.length >= 40 && sentence.length <= 320,
    );

    sentences.forEach((sentence, index) => {
      pushUnit('sentence', sentence, {
        sourceChunkIndex: chunk.chunkIndex,
        unitIndex: index,
        dedupe: true,
      });
    });
  }

  return units;
}
