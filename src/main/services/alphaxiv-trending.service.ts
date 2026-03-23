/**
 * AlphaXiv Trending Papers Service
 * Scrapes the AlphaXiv explore page (sorted by "Hot") to get trending papers.
 * Data is extracted from the SSR-embedded TanStack Router dehydrated state.
 *
 * The page uses React's streaming serialization format where:
 * - Field names are unquoted: `title:"some text"`
 * - Arrays/objects use inline references: `authors:$R[123]=["a","b"]`
 * - Paper objects are separated by `},$R[nnn]={id:"...`
 */

import { proxyFetch } from './proxy-fetch';
import type { Agent } from 'node:http';
import { getProxy, getProxyScope } from '../store/app-settings-store';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { DiscoveredPaper } from './arxiv-discovery.service';

// Use www. prefix — alphaxiv.org 301-redirects to www.alphaxiv.org
// and the redirect drops query parameters
const ALPHAXIV_SORT_URLS = [
  'https://www.alphaxiv.org/?sort=Hot',
  'https://www.alphaxiv.org/?sort=Likes',
  'https://www.alphaxiv.org/?sort=Recent',
];

/** AlphaXiv-specific metrics embedded in trending papers */
export interface AlphaXivTrendingMetrics {
  visits: number;
  votes: number;
  githubStars?: number;
  githubUrl?: string;
  topics: string[];
}

function getProxyAgent(): Agent | undefined {
  const proxy = getProxy();
  const scope = getProxyScope();
  if (!proxy || !scope.pdfDownload) return undefined;
  return new HttpsProxyAgent(proxy);
}

// ── Field extraction helpers ──
// React's serialization uses unquoted keys: `title:"value"` not `"title":"value"`

function getString(region: string, key: string): string | undefined {
  // Match: key:"value" with optional preceding comma/brace/equals, or at start of chunk
  const re = new RegExp(`(?:^|[,{=])\\s*${key}\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 's');
  const m = region.match(re);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : undefined;
}

function getNumber(region: string, key: string): number | undefined {
  // Match: key:123 — preceded by comma, brace, or equals (from $R[n]={key:val})
  const re = new RegExp(`[,{=]\\s*${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`);
  const m = region.match(re);
  return m ? Number(m[1]) : undefined;
}

function getStringArray(region: string, key: string): string[] | undefined {
  // Handles: `key:$R[n]=["a","b"]` and `key:["a","b"]`
  const re = new RegExp(`[,{=]\\s*${key}\\s*:(?:\\$R\\[\\d+\\]=)?\\[([^\\]]*?)\\]`);
  const m = region.match(re);
  if (!m) return undefined;
  const items: string[] = [];
  const itemRe = /"((?:[^"\\]|\\.)*)"/g;
  let im;
  while ((im = itemRe.exec(m[1])) !== null) {
    items.push(im[1].replace(/\\"/g, '"'));
  }
  return items.length > 0 ? items : undefined;
}

/**
 * Split the serialized data stream into per-paper chunks.
 *
 * Each paper object starts with `{id:"uuid",paper_group_id:"uuid",title:"...`
 * and contains a `universal_paper_id:"NNNN.NNNNN"` field somewhere inside.
 *
 * Strategy:
 * 1. Find all `universal_paper_id:"XXXX.XXXXX"` positions
 * 2. For each, scan backwards to the nearest `title:"` to find the paper start
 * 3. Extract the chunk between consecutive paper starts
 */
function extractPapersFromHtml(html: string): DiscoveredPaper[] {
  const papers: DiscoveredPaper[] = [];
  const seen = new Set<string>();

  // Find all paper ID positions
  const paperIdRegex = /universal_paper_id:"(\d{4}\.\d{4,5})"/g;
  const paperIds: { arxivId: string; pos: number }[] = [];
  let match;
  while ((match = paperIdRegex.exec(html)) !== null) {
    if (!seen.has(match[1])) {
      seen.add(match[1]);
      paperIds.push({ arxivId: match[1], pos: match.index });
    }
  }

  if (paperIds.length === 0) return [];

  // For each paper ID, find the start of its containing object
  // by searching backward for `title:"` which appears near the start of each paper
  const paperChunks: { arxivId: string; chunk: string }[] = [];

  for (let i = 0; i < paperIds.length; i++) {
    const { arxivId, pos } = paperIds[i];

    // Search backwards up to 8KB for `title:"` to find the paper start
    const searchStart = Math.max(0, pos - 8000);
    const beforeRegion = html.slice(searchStart, pos);

    // Find the last `title:"` before universal_paper_id
    const titlePositions: number[] = [];
    const titleRe = /title:"/g;
    let tm;
    while ((tm = titleRe.exec(beforeRegion)) !== null) {
      titlePositions.push(tm.index);
    }

    // Use the last title position (closest to universal_paper_id)
    const titleOffset = titlePositions.length > 0 ? titlePositions[titlePositions.length - 1] : 0;
    const chunkStart = searchStart + titleOffset;

    // Chunk ends where the next paper starts (or 2KB after the ID for the last paper)
    const chunkEnd =
      i < paperIds.length - 1
        ? Math.max(
            pos + 2000,
            paperIds[i + 1].pos -
              8000 +
              (titlePositions.length > 0 ? titlePositions[titlePositions.length - 1] : 0),
          )
        : pos + 3000;

    const chunk = html.slice(chunkStart, Math.min(html.length, chunkEnd));
    paperChunks.push({ arxivId, chunk });
  }

  // Extract fields from each chunk
  for (const { arxivId, chunk } of paperChunks) {
    const title = getString(chunk, 'title');
    if (!title) continue;

    const abstract = getString(chunk, 'abstract');
    const authors = getStringArray(chunk, 'authors');
    const publishedAt =
      getString(chunk, 'first_publication_date') ?? getString(chunk, 'publication_date');
    const topics = getStringArray(chunk, 'topics');
    const visits = getNumber(chunk, 'all') ?? 0;
    const votes = getNumber(chunk, 'public_total_votes') ?? getNumber(chunk, 'total_votes') ?? 0;
    const githubStars = getNumber(chunk, 'github_stars');
    const githubUrl = getString(chunk, 'github_url');

    papers.push({
      arxivId,
      title: title.replace(/\s+/g, ' ').trim(),
      authors: authors ?? [],
      abstract: (abstract ?? '').replace(/\s+/g, ' ').trim(),
      categories: topics ?? [],
      publishedAt: publishedAt ? new Date(publishedAt) : new Date(),
      updatedAt: publishedAt ? new Date(publishedAt) : new Date(),
      pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
      absUrl: `https://arxiv.org/abs/${arxivId}`,
      qualityScore: null,
      qualityReason: null,
      alphaxivMetrics: {
        visits,
        votes,
        githubStars: githubStars ?? undefined,
        githubUrl: githubUrl ?? undefined,
        topics: topics ?? [],
      },
    });
  }

  return papers;
}

/**
 * Fetch trending papers from AlphaXiv across multiple sort views (Hot, Likes, Recent)
 * to maximize the number of unique papers returned.
 */
export async function fetchTrendingPapers(): Promise<DiscoveredPaper[]> {
  const agent = getProxyAgent();
  const seen = new Set<string>();
  const allPapers: DiscoveredPaper[] = [];

  for (const url of ALPHAXIV_SORT_URLS) {
    try {
      const response = await proxyFetch(url, {
        agent,
        timeoutMs: 30000,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!response.ok) {
        console.warn(`[alphaxiv-trending] ${url} returned status ${response.status}, skipping`);
        continue;
      }

      const html = response.text();
      const papers = extractPapersFromHtml(html);
      let added = 0;
      for (const paper of papers) {
        if (!seen.has(paper.arxivId)) {
          seen.add(paper.arxivId);
          allPapers.push(paper);
          added++;
        }
      }
      console.log(
        `[alphaxiv-trending] ${url.split('sort=')[1]}: ${papers.length} papers, ${added} new`,
      );
    } catch (e) {
      console.warn(`[alphaxiv-trending] Failed to fetch ${url}:`, e);
    }
  }

  if (allPapers.length === 0) {
    console.warn('[alphaxiv-trending] No papers extracted from any sort view');
    throw new Error('Failed to parse AlphaXiv trending page. The site structure may have changed.');
  }

  console.log(`[alphaxiv-trending] Total: ${allPapers.length} unique trending papers`);

  return allPapers;
}
