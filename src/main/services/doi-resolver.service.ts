import { proxyFetch } from './proxy-fetch';
import { getProxy, getProxyScope } from '../store/app-settings-store';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';

export interface ResolvedPaperMetadata {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  url?: string;
  abstract?: string;
  journal?: string;
  pdfUrl?: string;
}

function getProxyAgent(): Agent | undefined {
  const proxy = getProxy();
  const scope = getProxyScope();
  if (!proxy || !scope.pdfDownload) return undefined;
  return new HttpsProxyAgent(proxy);
}

/**
 * Extract DOI from various URL formats.
 * Handles dx.doi.org, doi.org, and embedded DOIs in publisher URLs.
 */
export function extractDoiFromUrl(url: string): string | null {
  // Direct DOI URLs: https://doi.org/10.xxxx/yyyy or https://dx.doi.org/10.xxxx/yyyy
  const doiUrlMatch = url.match(/(?:dx\.)?doi\.org\/(10\.[^?\s]+)/i);
  if (doiUrlMatch) return decodeURIComponent(doiUrlMatch[1]);

  // DOI embedded in query params
  const urlObj = tryParseUrl(url);
  if (urlObj) {
    const doiParam = urlObj.searchParams.get('doi');
    if (doiParam && doiParam.startsWith('10.')) return doiParam;
  }

  return null;
}

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/**
 * Check if a string looks like a DOI (10.xxxx/yyyy format).
 */
export function isDoi(input: string): boolean {
  return /^10\.\d{4,}\/\S+$/.test(input.trim());
}

/**
 * Resolve paper metadata by DOI using the Crossref API.
 */
export async function resolveByDoi(doi: string): Promise<ResolvedPaperMetadata | null> {
  try {
    const agent = getProxyAgent();
    const response = await proxyFetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      agent,
      timeoutMs: 15000,
      headers: {
        'User-Agent': 'ResearchClaw/1.0 (https://github.com/researchclaw)',
      },
    });

    if (!response.ok) return null;
    const data = JSON.parse(response.text());
    const message = data?.message;
    if (!message) return null;

    const title = Array.isArray(message.title) ? message.title[0] : message.title;
    if (!title) return null;

    const authors: string[] = (message.author ?? []).map(
      (a: { given?: string; family?: string }) => {
        if (a.given && a.family) return `${a.given} ${a.family}`;
        return a.family ?? a.given ?? 'Unknown';
      },
    );

    const dateParts =
      message.published?.['date-parts']?.[0] ?? message.created?.['date-parts']?.[0];
    const year = dateParts?.[0];

    // Strip HTML tags from abstract
    let abstract = message.abstract;
    if (abstract && typeof abstract === 'string') {
      abstract = abstract.replace(/<[^>]+>/g, '').trim();
    }

    return {
      title: typeof title === 'string' ? title : String(title),
      authors,
      year: typeof year === 'number' ? year : undefined,
      doi: message.DOI ?? doi,
      url: message.URL,
      abstract,
      journal: Array.isArray(message['container-title'])
        ? message['container-title'][0]
        : message['container-title'],
    };
  } catch (e) {
    console.error('[doi-resolver] Crossref API error:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Resolve paper metadata by URL using the Semantic Scholar API.
 */
export async function resolveByUrl(url: string): Promise<ResolvedPaperMetadata | null> {
  // First try to extract DOI from URL and use Crossref (more reliable)
  const doi = extractDoiFromUrl(url);
  if (doi) {
    const result = await resolveByDoi(doi);
    if (result) return result;
  }

  // Fallback to Semantic Scholar
  try {
    const agent = getProxyAgent();
    const encodedUrl = encodeURIComponent(url);
    const response = await proxyFetch(
      `https://api.semanticscholar.org/graph/v1/paper/URL:${encodedUrl}?fields=title,authors,year,abstract,externalIds,url`,
      {
        agent,
        timeoutMs: 15000,
      },
    );

    if (!response.ok) return null;
    const data = JSON.parse(response.text());
    if (!data?.title) return null;

    return {
      title: data.title,
      authors: (data.authors ?? []).map((a: { name: string }) => a.name),
      year: data.year,
      doi: data.externalIds?.DOI,
      url: data.url ?? url,
      abstract: data.abstract,
    };
  } catch (e) {
    console.error(
      '[doi-resolver] Semantic Scholar API error:',
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}
