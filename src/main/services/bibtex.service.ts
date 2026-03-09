/**
 * BibTeX export service.
 * Fetches citation data from Semantic Scholar API, with local generation as fallback.
 */
import { proxyFetch } from './proxy-fetch';
import { paperToBibtex, type BibtexPaperInput } from '@shared';

const S2_API_BASE = 'https://api.semanticscholar.org/graph/v1';

/**
 * Fetch BibTeX for a single paper from Semantic Scholar.
 * Tries arXiv ID first, then title search.
 */
async function fetchBibtexFromS2(paper: BibtexPaperInput): Promise<string | null> {
  // Try arXiv ID lookup first
  const arxivId = extractArxivId(paper);
  if (arxivId) {
    const bibtex = await fetchS2Paper(`ArXiv:${arxivId}`);
    if (bibtex) return bibtex;
  }

  // Fallback: search by title
  try {
    const query = encodeURIComponent(paper.title);
    const res = await proxyFetch(
      `${S2_API_BASE}/paper/search?query=${query}&limit=1&fields=citationStyles,externalIds,title`,
      { timeoutMs: 10_000 },
    );
    if (!res.ok) return null;

    const json = JSON.parse(res.text());
    const firstResult = json?.data?.[0];
    if (!firstResult?.citationStyles?.bibtex) return null;

    // Verify title similarity to avoid wrong paper
    if (!isTitleSimilar(paper.title, firstResult.title)) return null;

    return firstResult.citationStyles.bibtex;
  } catch {
    return null;
  }
}

async function fetchS2Paper(paperId: string): Promise<string | null> {
  try {
    const res = await proxyFetch(`${S2_API_BASE}/paper/${paperId}?fields=citationStyles`, {
      timeoutMs: 10_000,
    });
    if (!res.ok) return null;

    const json = JSON.parse(res.text());
    return json?.citationStyles?.bibtex ?? null;
  } catch {
    return null;
  }
}

function extractArxivId(paper: BibtexPaperInput): string | null {
  // From shortId (often the arXiv ID)
  if (paper.shortId && /^\d{4}\.\d{4,5}$/.test(paper.shortId)) {
    return paper.shortId;
  }
  // From sourceUrl
  if (paper.sourceUrl) {
    const match = paper.sourceUrl.match(/arxiv\.org\/(?:abs|pdf)\/([^/?]+?)(?:\.pdf)?$/);
    if (match) return match[1].replace(/v\d+$/, '');
  }
  return null;
}

/**
 * Simple title similarity check (case-insensitive, ignoring punctuation).
 */
function isTitleSimilar(a: string, b: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .trim();
  const na = normalize(a);
  const nb = normalize(b);
  // Check if one contains the other or they share significant overlap
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // Check word overlap
  const wordsA = new Set(na.split(/\s+/));
  const wordsB = new Set(nb.split(/\s+/));
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const unionSize = new Set([...wordsA, ...wordsB]).size;
  return unionSize > 0 && intersection.length / unionSize > 0.6;
}

/**
 * Get BibTeX for a single paper: try Semantic Scholar first, fallback to local generation.
 */
export async function getBibtex(paper: BibtexPaperInput): Promise<string> {
  const s2Bibtex = await fetchBibtexFromS2(paper);
  if (s2Bibtex) return s2Bibtex;
  return paperToBibtex(paper);
}

/**
 * Get BibTeX for multiple papers.
 */
export async function getBibtexBatch(papers: BibtexPaperInput[]): Promise<string> {
  const results = await Promise.all(papers.map(getBibtex));
  return results.join('\n\n');
}
