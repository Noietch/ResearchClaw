/**
 * arXiv Daily Discovery Service
 * Fetches new papers from arXiv API for user-configured categories
 *
 * API Documentation: https://info.arxiv.org/help/api/user-manual.html
 */

import { proxyFetch } from './proxy-fetch';
import type { Agent } from 'node:http';
import { getProxy, getProxyScope } from '../store/app-settings-store';
import { HttpsProxyAgent } from 'https-proxy-agent';

const ARXIV_API_BASE = 'http://export.arxiv.org/api/query';

/** Common arXiv categories */
export const ARXIV_CATEGORIES = [
  // Computer Science
  'cs.AI', // Artificial Intelligence
  'cs.LG', // Machine Learning
  'cs.CL', // Computation and Language
  'cs.CV', // Computer Vision
  'cs.NE', // Neural and Evolutionary Computing
  'cs.RO', // Robotics
  'cs.SE', // Software Engineering
  'cs.DS', // Data Structures and Algorithms
  'cs.IR', // Information Retrieval
  'cs.CR', // Cryptography and Security
  // Physics
  'physics.comp-ph', // Computational Physics
  'stat.ML', // Machine Learning (Statistics)
  'math.OC', // Optimization and Control
  'q-bio.QM', // Quantitative Methods
  'q-fin.CP', // Computational Finance
  'eess.AS', // Audio and Speech Processing
  'eess.IV', // Image and Video Processing
] as const;

export type ArxivCategory = (typeof ARXIV_CATEGORIES)[number];

export interface DiscoveredPaper {
  arxivId: string;
  title: string;
  authors: string[];
  abstract: string;
  categories: string[];
  publishedAt: Date;
  updatedAt: Date;
  pdfUrl: string;
  absUrl: string;
  /** AI-generated quality score (1-10), null if not yet evaluated */
  qualityScore?: number | null;
  /** AI-generated recommendation reason */
  qualityReason?: string | null;
  /** Quality dimensions if evaluated */
  qualityDimensions?: {
    novelty: number;
    methodology: number;
    significance: number;
    clarity: number;
  } | null;
  /** Recommendation level */
  qualityRecommendation?: 'must-read' | 'worth-reading' | 'skimmable' | 'skip' | null;
  /** Relevance score to user's library (0-100), null if not yet calculated */
  relevanceScore?: number | null;
  /** AlphaXiv trending metrics (only present for AlphaXiv-sourced papers) */
  alphaxivMetrics?: {
    visits: number;
    votes: number;
    githubStars?: number;
    githubUrl?: string;
    topics: string[];
  } | null;
  /** Data source identifier */
  source?: 'arxiv' | 'alphaxiv-trending';
}

export interface DiscoveryResult {
  papers: DiscoveredPaper[];
  total: number;
  fetchedAt: Date;
  categories: string[];
}

function getProxyAgent(): Agent | undefined {
  const proxy = getProxy();
  const scope = getProxyScope();
  if (!proxy || !scope.pdfDownload) return undefined;
  return new HttpsProxyAgent(proxy);
}

/**
 * Parse arXiv API XML response
 */
function parseArxivXml(xml: string): DiscoveredPaper[] {
  const papers: DiscoveredPaper[] = [];

  // Split by entry
  const entries = xml.split('<entry>').slice(1);

  for (const entry of entries) {
    try {
      // Extract arXiv ID from id field
      const idMatch = entry.match(/<id>([^<]+)<\/id>/);
      if (!idMatch) continue;
      const idUrl = idMatch[1];
      const arxivId = idUrl.split('/abs/')[1]?.split('v')[0] || idUrl.split('/').pop() || '';

      // Extract title
      const titleMatch = entry.match(/<title>([^<]+)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

      // Extract authors
      const authors: string[] = [];
      const authorMatches = entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g);
      for (const match of authorMatches) {
        authors.push(match[1].trim());
      }

      // Extract abstract
      const abstractMatch = entry.match(/<summary>([^]*?)<\/summary>/);
      const abstract = abstractMatch ? abstractMatch[1].replace(/\s+/g, ' ').trim() : '';

      // Extract categories
      const categories: string[] = [];
      const catMatches = entry.matchAll(/category term="([^"]+)"/g);
      for (const match of catMatches) {
        categories.push(match[1]);
      }

      // Extract dates
      const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
      const updatedMatch = entry.match(/<updated>([^<]+)<\/updated>/);
      const publishedAt = publishedMatch ? new Date(publishedMatch[1]) : new Date();
      const updatedAt = updatedMatch ? new Date(updatedMatch[1]) : new Date();

      papers.push({
        arxivId,
        title,
        authors,
        abstract,
        categories,
        publishedAt,
        updatedAt,
        pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
        absUrl: `https://arxiv.org/abs/${arxivId}`,
        qualityScore: null,
        qualityReason: null,
      });
    } catch (e) {
      console.warn('[arxiv-discovery] Failed to parse entry:', e);
    }
  }

  return papers;
}

/**
 * Fetch new papers from arXiv
 * @param categories List of arXiv categories (e.g., ['cs.AI', 'cs.LG'])
 * @param maxResults Maximum number of papers to fetch per category
 * @param daysBack Only fetch papers from the last N days (default: 7)
 */
export async function fetchNewPapers(
  categories: string[],
  maxResults: number = 50,
  daysBack: number = 7,
): Promise<DiscoveryResult> {
  if (categories.length === 0) {
    return { papers: [], total: 0, fetchedAt: new Date(), categories: [] };
  }

  // Build search query
  const categoryQuery = categories.map((cat) => `cat:${cat}`).join(' OR ');

  // Build date filter (arXiv API doesn't support date filtering, we filter client-side)
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const params = new URLSearchParams({
    search_query: `(${categoryQuery})`,
    sortBy: 'submittedDate',
    sortOrder: 'descending',
    max_results: String(Math.min(maxResults * categories.length, 500)), // API limit
  });

  try {
    const agent = getProxyAgent();
    const response = await proxyFetch(`${ARXIV_API_BASE}?${params.toString()}`, {
      agent,
      timeoutMs: 30000,
    });

    if (!response.ok) {
      throw new Error(`arXiv API error: ${response.status}`);
    }

    const xml = response.text();
    let papers = parseArxivXml(xml);

    // Filter by date (client-side)
    papers = papers.filter((p) => p.publishedAt >= cutoffDate);

    // Sort by date descending
    papers.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    return {
      papers,
      total: papers.length,
      fetchedAt: new Date(),
      categories,
    };
  } catch (error) {
    console.error('[arxiv-discovery] Failed to fetch papers:', error);
    throw error;
  }
}

/**
 * Fetch papers from a single category
 */
export async function fetchPapersByCategory(
  category: string,
  maxResults: number = 25,
): Promise<DiscoveredPaper[]> {
  const result = await fetchNewPapers([category], maxResults);
  return result.papers;
}

/**
 * Get default categories for new users
 */
export function getDefaultCategories(): string[] {
  return ['cs.AI', 'cs.LG', 'cs.CL'];
}
