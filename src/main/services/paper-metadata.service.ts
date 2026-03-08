import { generateWithModelKind, getSelectedModelInfo } from './ai-provider.service';

export interface ExtractedMetadata {
  title?: string;
  authors?: string[];
  abstract?: string;
  submittedAt?: Date | null;
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

export async function extractPaperMetadata(text: string): Promise<ExtractedMetadata> {
  const lightweight = getSelectedModelInfo('lightweight');
  if (!lightweight) {
    throw new Error('No lightweight model configured.');
  }

  const systemPrompt = [
    'Extract metadata from academic paper text.',
    'Return strict JSON only.',
    'Use exactly these keys: title, authors, abstract, submittedAt.',
    'authors must be an array of strings.',
    'submittedAt must be an ISO date string or null.',
    'If a field cannot be determined, use null or an empty array.',
  ].join(' ');

  const userPrompt = ['Paper text:', text.slice(0, 18000)].join('\n\n');

  const response = await generateWithModelKind('lightweight', systemPrompt, userPrompt, {
    strictSelection: true,
  });

  const payload = safeJsonParse<{
    title?: string | null;
    authors?: string[] | null;
    abstract?: string | null;
    submittedAt?: string | null;
  }>(response);

  return {
    title: payload?.title?.trim() || undefined,
    authors: Array.isArray(payload?.authors)
      ? payload.authors.map((author) => author.trim()).filter(Boolean)
      : undefined,
    abstract: payload?.abstract?.trim() || undefined,
    submittedAt: payload?.submittedAt ? new Date(payload.submittedAt) : undefined,
  };
}
