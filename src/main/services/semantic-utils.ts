export interface TextChunk {
  chunkIndex: number;
  content: string;
  contentPreview: string;
}

export function sanitizeSemanticText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/\p{Co}|\p{Cs}/gu, '')
    .replace(/\uFEFF/g, '')
    .normalize('NFC');
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function splitTextIntoChunks(
  text: string,
  options: { chunkSize?: number; overlap?: number } = {},
): TextChunk[] {
  const normalized = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

  const chunkSize = Math.max(400, options.chunkSize ?? 1600);
  const overlap = Math.max(0, Math.min(chunkSize / 2, options.overlap ?? 220));
  const chunks: TextChunk[] = [];

  let buffer = '';
  const flush = () => {
    const content = buffer.trim();
    if (!content) return;
    chunks.push({
      chunkIndex: chunks.length,
      content,
      contentPreview: normalizeWhitespace(content).slice(0, 240),
    });
  };

  for (const section of normalized) {
    const candidate = buffer ? `${buffer}\n\n${section}` : section;
    if (candidate.length <= chunkSize) {
      buffer = candidate;
      continue;
    }

    if (buffer) {
      flush();
      const tail = buffer.slice(Math.max(0, buffer.length - overlap)).trim();
      buffer = tail ? `${tail}\n\n${section}` : section;
      if (buffer.length <= chunkSize) {
        continue;
      }
    }

    let start = 0;
    while (start < section.length) {
      const end = Math.min(section.length, start + chunkSize);
      const slice = section.slice(start, end).trim();
      if (slice) {
        chunks.push({
          chunkIndex: chunks.length,
          content: slice,
          contentPreview: normalizeWhitespace(slice).slice(0, 240),
        });
      }
      if (end >= section.length) {
        buffer = '';
        break;
      }
      start = Math.max(end - overlap, start + 1);
    }
  }

  if (buffer) {
    flush();
  }

  return chunks;
}

export const MIN_SEMANTIC_CHUNK_SIMILARITY = 0.35;

export function isSemanticScoreMatch(score: number): boolean {
  return Number.isFinite(score) && score >= MIN_SEMANTIC_CHUNK_SIMILARITY;
}

export function semanticLexicalBoost(
  query: string,
  fields: Array<string | null | undefined>,
): number {
  const normalizedQuery = normalizeWhitespace(query).toLowerCase();
  if (!normalizedQuery) return 0;

  const haystack = normalizeWhitespace(fields.filter(Boolean).join(' ')).toLowerCase();
  if (!haystack) return 0;

  if (haystack.includes(normalizedQuery)) {
    return 0.08;
  }

  const tokens = normalizedQuery.split(/\s+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) return 0;

  const matchedTokens = tokens.filter((token) => haystack.includes(token)).length;
  if (matchedTokens === 0) return 0;

  return Math.min(0.06, matchedTokens * 0.02);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return -1;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i++) {
    dot += left[i] * right[i];
    leftNorm += left[i] * left[i];
    rightNorm += right[i] * right[i];
  }

  if (leftNorm === 0 || rightNorm === 0) return -1;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
