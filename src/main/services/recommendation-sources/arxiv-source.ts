import { proxyFetch } from '../proxy-fetch';
import { type ExternalRecommendationCandidate, getRecommendationProxyAgent } from './shared';

function extractEntries(feed: string): string[] {
  return feed.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function matchValue(block: string, pattern: RegExp): string | null {
  const match = block.match(pattern);
  return match?.[1] ? decodeXml(match[1].replace(/\s+/g, ' ').trim()) : null;
}

function toCandidate(entry: string): ExternalRecommendationCandidate | null {
  const id = matchValue(entry, /<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/i);
  const title = matchValue(entry, /<title>([\s\S]*?)<\/title>/i);
  if (!id || !title) return null;
  const abstract = matchValue(entry, /<summary>([\s\S]*?)<\/summary>/i);
  const published = matchValue(entry, /<published>([^<]+)<\/published>/i);
  const authors = [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map((m) => decodeXml(m[1].trim()));
  return {
    source: 'arxiv',
    externalId: id.replace(/v\d+$/, ''),
    arxivId: id.replace(/v\d+$/, ''),
    title,
    authors,
    abstract,
    sourceUrl: `https://arxiv.org/abs/${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}.pdf`,
    publishedAt: published ? new Date(published) : null,
    venue: 'arXiv',
    citationCount: null,
    metadata: { rawId: id },
  };
}

async function fetchFeed(query: string, start: number, maxResults: number) {
  const agent = getRecommendationProxyAgent();
  const encoded = encodeURIComponent(query);
  const res = await proxyFetch(
    `https://export.arxiv.org/api/query?search_query=all:${encoded}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${maxResults}`,
    { agent, timeoutMs: 15_000 },
  );
  if (!res.ok) return [];
  return extractEntries(res.text())
    .map(toCandidate)
    .filter(Boolean) as ExternalRecommendationCandidate[];
}

export class ArxivRecommendationSource {
  async searchByKeywords(
    queries: string[],
    limitPerQuery = 6,
  ): Promise<ExternalRecommendationCandidate[]> {
    const results = await Promise.all(
      queries
        .filter(Boolean)
        .slice(0, 3)
        .map((query) => fetchFeed(query, 0, limitPerQuery)),
    );
    return results.flat();
  }
}
