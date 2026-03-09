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
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Search papers by query string with retry logic.
 */
export async function searchPapers(query: string, limit: number = 20): Promise<SearchResponse> {
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

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const url = `${S2_API_BASE}/paper/search?query=${encodedQuery}&limit=${limit}&fields=${fields}`;
      console.log(`[paper-search] Attempt ${attempt + 1}: ${url}`);

      const res = await proxyFetch(url, { timeoutMs: 15_000 });

      console.log(`[paper-search] Response status: ${res.status}`);
      console.log(`[paper-search] Response headers:`, res.headers);

      if (res.status === 429) {
        // Rate limited - log details and retry
        const waitTime = Math.min(1000 * Math.pow(2, attempt), 5000);
        console.warn(
          `[paper-search] Rate limited (429). Response body: ${res.text().substring(0, 200)}`,
        );
        console.warn(`[paper-search] Retrying in ${waitTime}ms...`);
        await sleep(waitTime);
        continue;
      }

      if (!res.ok) {
        const errorBody = res.text();
        console.error(`[paper-search] HTTP ${res.status} error. Body: ${errorBody}`);
        throw new Error(
          `Search failed with status ${res.status}. ${errorBody ? `Details: ${errorBody.substring(0, 200)}` : ''}`,
        );
      }

      const responseText = res.text();
      console.log(`[paper-search] Response body length: ${responseText.length} bytes`);

      const json = JSON.parse(responseText);
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

      console.log(`[paper-search] Successfully parsed ${results.length} results`);

      return {
        results,
        total: json?.total ?? results.length,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`[paper-search] Attempt ${attempt + 1} failed:`, lastError);
      console.error(`[paper-search] Error stack:`, lastError.stack);

      if (attempt < maxRetries - 1) {
        const waitTime = 1000 * Math.pow(2, attempt);
        console.log(`[paper-search] Waiting ${waitTime}ms before retry...`);
        await sleep(waitTime);
      }
    }
  }

  const finalError = lastError ?? new Error('Search failed after retries');
  console.error(`[paper-search] All ${maxRetries} attempts failed. Final error:`, finalError);
  throw finalError;
}
