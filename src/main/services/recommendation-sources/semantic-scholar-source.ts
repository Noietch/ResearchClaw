import { proxyFetch } from '../proxy-fetch';
import { type ExternalRecommendationCandidate, getRecommendationProxyAgent } from './shared';

const API_BASE = 'https://api.semanticscholar.org/graph/v1';
const SEARCH_FIELDS = [
  'title',
  'abstract',
  'authors',
  'year',
  'externalIds',
  'url',
  'venue',
  'citationCount',
  'openAccessPdf',
].join(',');

function toCandidate(item: any): ExternalRecommendationCandidate | null {
  if (!item?.title) return null;
  const arxivId = item?.externalIds?.ArXiv ?? null;
  const doi = item?.externalIds?.DOI ?? null;
  return {
    source: 'semantic_scholar',
    externalId: String(item.paperId ?? item.url ?? item.title),
    arxivId,
    doi,
    title: String(item.title),
    authors: Array.isArray(item.authors)
      ? item.authors.map((author: any) => String(author?.name ?? '')).filter(Boolean)
      : [],
    abstract: item.abstract ? String(item.abstract) : null,
    sourceUrl: item.url ? String(item.url) : arxivId ? `https://arxiv.org/abs/${arxivId}` : null,
    pdfUrl: item?.openAccessPdf?.url
      ? String(item.openAccessPdf.url)
      : arxivId
        ? `https://arxiv.org/pdf/${arxivId}.pdf`
        : null,
    publishedAt: item.year ? new Date(`${item.year}-01-01T00:00:00Z`) : null,
    venue: item.venue ? String(item.venue) : null,
    citationCount: typeof item.citationCount === 'number' ? item.citationCount : null,
    metadata: { paperId: item.paperId ?? null, externalIds: item.externalIds ?? {} },
  };
}

async function fetchSearch(
  query: string,
  limit: number,
): Promise<ExternalRecommendationCandidate[]> {
  const agent = getRecommendationProxyAgent();
  const res = await proxyFetch(
    `${API_BASE}/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${encodeURIComponent(SEARCH_FIELDS)}`,
    { agent, timeoutMs: 15_000 },
  );
  if (!res.ok) return [];
  const json = JSON.parse(res.text());
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows.map(toCandidate).filter(Boolean) as ExternalRecommendationCandidate[];
}

export class SemanticScholarRecommendationSource {
  async searchByKeywords(
    queries: string[],
    limitPerQuery = 8,
  ): Promise<ExternalRecommendationCandidate[]> {
    const results = await Promise.all(
      queries
        .filter(Boolean)
        .slice(0, 4)
        .map((query) => fetchSearch(query, limitPerQuery)),
    );
    return results.flat();
  }

  async searchBySeedTitles(
    seedTitles: string[],
    limitPerTitle = 4,
  ): Promise<ExternalRecommendationCandidate[]> {
    const results = await Promise.all(
      seedTitles
        .filter(Boolean)
        .slice(0, 5)
        .map((title) => fetchSearch(title, limitPerTitle)),
    );
    return results.flat();
  }
}
