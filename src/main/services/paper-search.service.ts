/**
 * Paper search service using Semantic Scholar API.
 */
import { proxyFetch } from './proxy-fetch';

const S2_API_BASE = 'https://api.semanticscholar.org/graph/v1';

export interface SearchResult {
  paperId: string;
  title: string;
  authors: Array<{ name: string }>;
  year: number | null;
  abstract: string | null;
  citationCount: number;
  externalIds: {
    ArXiv?: string;
    DOI?: string;
  };
  url: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

/**
 * Search papers by query string.
 */
export async function searchPapers(query: string, limit: number = 20): Promise<SearchResponse> {
  try {
    const encodedQuery = encodeURIComponent(query);
    const fields = [
      'paperId',
      'title',
      'authors',
      'year',
      'abstract',
      'citationCount',
      'externalIds',
      'url',
    ].join(',');

    const res = await proxyFetch(
      `${S2_API_BASE}/paper/search?query=${encodedQuery}&limit=${limit}&fields=${fields}`,
      { timeoutMs: 15_000 },
    );

    if (!res.ok) {
      throw new Error(`Search failed: ${res.status}`);
    }

    const json = JSON.parse(res.text());
    const results: SearchResult[] = (json?.data ?? []).map((item: any) => ({
      paperId: item.paperId,
      title: item.title ?? 'Untitled',
      authors: item.authors ?? [],
      year: item.year ?? null,
      abstract: item.abstract ?? null,
      citationCount: item.citationCount ?? 0,
      externalIds: item.externalIds ?? {},
      url: item.url ?? null,
    }));

    return {
      results,
      total: json?.total ?? results.length,
    };
  } catch (error) {
    console.error('[paper-search] Search failed:', error);
    throw error;
  }
}
