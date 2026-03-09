import type { Agent } from 'node:http';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxy, getProxyScope } from '../../store/app-settings-store';

export interface ExternalRecommendationCandidate {
  source: 'semantic_scholar' | 'arxiv';
  externalId: string;
  arxivId?: string | null;
  doi?: string | null;
  title: string;
  authors: string[];
  abstract?: string | null;
  sourceUrl?: string | null;
  pdfUrl?: string | null;
  publishedAt?: Date | null;
  venue?: string | null;
  citationCount?: number | null;
  metadata?: Record<string, unknown>;
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getRecommendationProxyAgent(): Agent | undefined {
  const proxy = getProxy();
  const scope = getProxyScope();
  if (!proxy || (!scope.aiApi && !scope.pdfDownload)) return undefined;
  return new HttpsProxyAgent(proxy);
}
