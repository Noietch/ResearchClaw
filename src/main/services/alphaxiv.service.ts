/**
 * AlphaXiv API integration service
 * Provides AI-generated paper overviews and summaries from alphaxiv.org
 *
 * API Documentation: https://www.alphaxiv.org/skills/alphaxiv-paper-lookup/SKILL.md
 */

import { proxyFetch } from './proxy-fetch';
import type { Agent } from 'node:http';
import { getProxy, getProxyScope } from '../store/app-settings-store';
import { HttpsProxyAgent } from 'https-proxy-agent';

const ALPHAXIV_API_BASE = 'https://api.alphaxiv.org/papers/v3';
const ALPHAXIV_WEB_BASE = 'https://alphaxiv.org';

export interface AlphaXivResolvedPaper {
  versionId: string;
  paperId: string;
  title?: string;
}

export interface AlphaXivSummary {
  summary: string;
  originalProblem: string;
  solution: string;
  keyInsights: string;
  results: string;
}

export interface AlphaXivCitation {
  title: string;
  justification: string;
}

export interface AlphaXivOverview {
  intermediateReport: string | null; // Machine-readable structured text (best for LLM)
  overview: string | null; // Full markdown blog post (human-readable)
  summary: AlphaXivSummary | null; // Structured summary
  citations: AlphaXivCitation[]; // List of cited papers
}

export interface AlphaXivPaperData {
  resolved: AlphaXivResolvedPaper;
  overview: AlphaXivOverview | null;
  fullText: string | null;
}

function getProxyAgent(): Agent | undefined {
  const proxy = getProxy();
  const scope = getProxyScope();
  if (!proxy || !scope.pdfDownload) return undefined;
  return new HttpsProxyAgent(proxy);
}

/**
 * Extract arXiv paper ID from various input formats
 */
export function extractPaperId(input: string): string | null {
  const trimmed = input.trim();

  // Direct arXiv ID: 2301.12345 or 2301.12345v2
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  // arXiv URL patterns
  const arxivPatterns = [
    /arxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
    /arxiv\.org\/pdf\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
    /alphaxiv\.org\/overview\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
    /alphaxiv\.org\/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/i,
  ];

  for (const pattern of arxivPatterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Step 1: Resolve paper ID to get versionId
 * GET https://api.alphaxiv.org/papers/v3/{PAPER_ID}
 */
export async function resolvePaper(paperId: string): Promise<AlphaXivResolvedPaper | null> {
  try {
    const agent = getProxyAgent();
    const response = await proxyFetch(`${ALPHAXIV_API_BASE}/${paperId}`, {
      agent,
      timeoutMs: 15000,
    });

    if (!response.ok) {
      if (response.status === 404) return null; // Paper not indexed
      throw new Error(`AlphaXiv API error: ${response.status}`);
    }

    const data = JSON.parse(response.text());
    return {
      versionId: data.versionId,
      paperId: data.paperId || paperId,
      title: data.title,
    };
  } catch (error) {
    console.error('[alphaxiv] Failed to resolve paper:', paperId, error);
    return null;
  }
}

/**
 * Step 2: Fetch AI-generated overview for a paper version
 * GET https://api.alphaxiv.org/papers/v3/{VERSION_ID}/overview/{lang}
 */
export async function fetchOverview(
  versionId: string,
  lang: string = 'en',
): Promise<AlphaXivOverview | null> {
  try {
    const agent = getProxyAgent();
    const response = await proxyFetch(`${ALPHAXIV_API_BASE}/${versionId}/overview/${lang}`, {
      agent,
      timeoutMs: 15000,
    });

    if (!response.ok) {
      if (response.status === 404) return null; // Overview not generated
      throw new Error(`AlphaXiv API error: ${response.status}`);
    }

    const data = JSON.parse(response.text());
    return {
      intermediateReport: data.intermediateReport ?? null,
      overview: data.overview ?? null,
      summary: data.summary ?? null,
      citations: data.citations ?? [],
    };
  } catch (error) {
    console.error('[alphaxiv] Failed to fetch overview:', versionId, error);
    return null;
  }
}

/**
 * Step 3 (optional): Fetch full paper text as markdown
 * GET https://alphaxiv.org/abs/{PAPER_ID}.md
 */
export async function fetchFullText(paperId: string): Promise<string | null> {
  try {
    const agent = getProxyAgent();
    const response = await proxyFetch(`${ALPHAXIV_WEB_BASE}/abs/${paperId}.md`, {
      agent,
      timeoutMs: 30000,
    });

    if (!response.ok) {
      if (response.status === 404) return null; // Full text not processed
      throw new Error(`AlphaXiv API error: ${response.status}`);
    }

    return response.text();
  } catch (error) {
    console.error('[alphaxiv] Failed to fetch full text:', paperId, error);
    return null;
  }
}

/**
 * Combined helper: Get paper overview from arXiv ID
 * Returns the best available content (intermediateReport > summary > null)
 */
export async function getPaperOverview(
  arxivId: string,
  options: { lang?: string; includeFullText?: boolean } = {},
): Promise<AlphaXivPaperData | null> {
  const { lang = 'en', includeFullText = false } = options;

  // Step 1: Resolve paper
  const resolved = await resolvePaper(arxivId);
  if (!resolved) return null;

  // Step 2: Fetch overview
  const overview = await fetchOverview(resolved.versionId, lang);

  // Step 3: Optionally fetch full text
  let fullText: string | null = null;
  if (includeFullText) {
    fullText = await fetchFullText(arxivId);
  }

  return { resolved, overview, fullText };
}

/**
 * Get the best available summary text for display
 * Priority: overview (markdown) > summary fields > intermediateReport
 * Note: overview is a human-readable markdown blog post with proper formatting;
 *       intermediateReport is machine-readable plain text for LLM consumption.
 */
export function getBestSummary(data: AlphaXivOverview): string | null {
  if (data.overview) return data.overview;

  if (data.summary) {
    const parts: string[] = [];
    if (data.summary.summary) parts.push(`**Summary:** ${data.summary.summary}`);
    if (data.summary.originalProblem) parts.push(`**Problem:** ${data.summary.originalProblem}`);
    if (data.summary.solution) parts.push(`**Solution:** ${data.summary.solution}`);
    if (data.summary.keyInsights) parts.push(`**Key Insights:** ${data.summary.keyInsights}`);
    if (data.summary.results) parts.push(`**Results:** ${data.summary.results}`);
    if (parts.length > 0) return parts.join('\n\n');
  }

  if (data.intermediateReport) return data.intermediateReport;

  return null;
}
