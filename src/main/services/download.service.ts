import path from 'path';
import fs from 'fs/promises';
import { PapersRepository } from '@db';
import { extractArxivId } from '@shared';
import { getPapersDir, getProxy, getProxyScope } from '../store/app-settings-store';
import { isDoi, resolveByDoi, resolveByUrl, extractDoiFromUrl } from './doi-resolver.service';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';
import { proxyFetch } from './proxy-fetch';
import { schedulePaperProcessing } from './paper-processing.service';
import { scheduleAutoPaperEnrichment } from './auto-paper-enrichment.service';
import { scheduleCitationExtraction } from './citation-processing.service';
import { getPaperOverview, getBestSummary } from './alphaxiv.service';

/** Minimum size for a valid PDF (arXiv PDFs are typically > 50KB) */
const MIN_PDF_SIZE = 1024; // 1KB

/** Check if buffer is a valid PDF by checking magic bytes */
function isValidPdf(buffer: Buffer): boolean {
  // PDF files start with %PDF-
  return buffer.length >= 5 && buffer.toString('ascii', 0, 5) === '%PDF-';
}

function getProxyAgent(): Agent | undefined {
  const proxy = getProxy();
  const scope = getProxyScope();
  if (!proxy || !scope.pdfDownload) return undefined;
  return new HttpsProxyAgent(proxy);
}

async function fetchArxivMetadata(arxivId: string): Promise<{
  title: string;
  authors: string[];
  abstract: string;
  submittedAt: Date;
} | null> {
  try {
    const agent = getProxyAgent();
    const response = await proxyFetch(`https://arxiv.org/abs/${arxivId}`, {
      agent,
      timeoutMs: 15000,
    });

    if (!response.ok) return null;
    const html = response.text();

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim() : '';
    title = title.replace(/^\[[\w./-]+\]\s*/, '').trim();

    const authors: string[] = [];
    const authorMatches = html.matchAll(/<meta name="citation_author" content="([^"]+)"/g);
    for (const match of authorMatches) authors.push(match[1]);

    const abstractMatch = html.match(/<meta name="citation_abstract" content="([^"]+)"/i);
    const abstract = abstractMatch ? abstractMatch[1].replace(/\n/g, ' ').trim() : '';

    const dateMatch = html.match(/\[Submitted on (\d{1,2}) (\w+\.?) (\d{4})/i);
    let submittedAt: Date = new Date();
    if (dateMatch) {
      const parsed = new Date(`${dateMatch[1]} ${dateMatch[2]} ${dateMatch[3]} UTC`);
      if (!isNaN(parsed.getTime())) submittedAt = parsed;
    }

    return { title, authors, abstract, submittedAt };
  } catch {
    return null;
  }
}

function parseInput(input: string): {
  type: 'arxiv_id' | 'arxiv_url' | 'pdf_url' | 'doi' | 'url';
  arxivId: string | null;
  pdfUrl: string | null;
  doi: string | null;
} {
  const trimmed = input.trim();
  // arXiv ID: 2301.12345 or 2301.12345v2
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed)) {
    return { type: 'arxiv_id', arxivId: trimmed, pdfUrl: null, doi: null };
  }
  // DOI: 10.xxxx/yyyy
  if (isDoi(trimmed)) {
    return { type: 'doi', arxivId: null, pdfUrl: null, doi: trimmed };
  }
  // URL handling
  if (trimmed.includes('arxiv.org')) {
    const arxivId = extractArxivId(trimmed);
    if (arxivId) return { type: 'arxiv_url', arxivId, pdfUrl: null, doi: null };
  }
  if (trimmed.startsWith('http')) {
    const arxivId = extractArxivId(trimmed);
    if (arxivId) return { type: 'arxiv_url', arxivId, pdfUrl: null, doi: null };
    // Check if URL contains a DOI
    const doiFromUrl = extractDoiFromUrl(trimmed);
    if (doiFromUrl) return { type: 'doi', arxivId: null, pdfUrl: null, doi: doiFromUrl };
    // Check if it's a direct PDF URL or a general academic URL
    if (trimmed.match(/\.pdf(\?|$)/i)) {
      return { type: 'pdf_url', arxivId: null, pdfUrl: trimmed, doi: null };
    }
    return { type: 'url', arxivId: null, pdfUrl: null, doi: null };
  }
  return { type: 'arxiv_id', arxivId: trimmed, pdfUrl: null, doi: null };
}

export class DownloadService {
  private papersRepository = new PapersRepository();

  private getPaperFolder(shortId: string): string {
    return path.join(getPapersDir(), shortId);
  }

  private async ensurePaperFolder(shortId: string): Promise<string> {
    const folder = this.getPaperFolder(shortId);
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(path.join(folder, 'notes'), { recursive: true });
    return folder;
  }

  async downloadFromInput(input: string, tags: string[] = [], isTemporary: boolean = false) {
    const parsed = parseInput(input);

    // Handle DOI or general URL via doi-resolver
    if (parsed.type === 'doi' && parsed.doi) {
      return this.importByDoi(parsed.doi, input, tags, isTemporary);
    }
    if (parsed.type === 'url') {
      return this.importByUrl(input.trim(), tags, isTemporary);
    }

    let arxivId: string | null = null;
    let title: string;
    let authors: string[] = [];
    let abstract = '';
    let submittedAt: Date | undefined;
    let pdfUrl: string;

    if (parsed.type === 'pdf_url' && parsed.pdfUrl) {
      const urlPath = new URL(parsed.pdfUrl).pathname;
      const filename = path.basename(urlPath, '.pdf');
      title = filename.replace(/[-_]/g, ' ');
      pdfUrl = parsed.pdfUrl;
    } else if (parsed.arxivId) {
      arxivId = parsed.arxivId;
      const metadata = await fetchArxivMetadata(arxivId);
      if (!metadata) throw new Error(`Failed to fetch metadata for arXiv ID: ${arxivId}`);
      title = metadata.title;
      authors = metadata.authors;
      abstract = metadata.abstract;
      submittedAt = metadata.submittedAt;
      pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;

      // Try to enhance with AlphaXiv AI-generated overview
      try {
        const alphaxivData = await getPaperOverview(arxivId);
        if (alphaxivData?.overview) {
          const aiSummary = getBestSummary(alphaxivData.overview);
          if (aiSummary) {
            // Prepend AI summary to the abstract
            abstract = `**AI-Generated Summary (AlphaXiv):**\n\n${aiSummary}\n\n---\n\n**Original Abstract:**\n${abstract}`;
          }
        }
      } catch {
        // AlphaXiv lookup failed, continue with original abstract
      }
    } else {
      throw new Error('Invalid input: must be an arXiv ID, arXiv URL, DOI, or PDF URL');
    }

    const shortId = arxivId || `local-${Date.now().toString(36)}`;
    const existing = await this.papersRepository.findByShortId(shortId);

    if (existing) {
      // If importing permanently but paper is currently temporary, update it
      if (!isTemporary && existing.isTemporary) {
        await this.papersRepository.updateTemporaryStatus(existing.id, false, null);
        existing.isTemporary = false;
      }
      const downloadResult = await this.downloadPdf(existing.id, shortId, pdfUrl);
      return { paper: existing, download: downloadResult, existed: true };
    }

    await this.ensurePaperFolder(shortId);
    const paper = await this.papersRepository.create({
      shortId,
      title,
      authors,
      source: 'arxiv',
      sourceUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined,
      submittedAt,
      abstract,
      pdfUrl,
      tags,
      isTemporary,
    });

    // Mark as temporary if requested (won't show in library)
    if (isTemporary) {
      await this.papersRepository.updateTemporaryStatus(paper.id, true);
    }

    const downloadResult = await this.downloadPdf(paper.id, shortId, pdfUrl);
    scheduleCitationExtraction(paper.id);
    scheduleAutoPaperEnrichment(paper.id);
    return { paper, download: downloadResult, existed: false };
  }

  private async importByDoi(
    doi: string,
    originalInput: string,
    tags: string[] = [],
    isTemporary: boolean = false,
  ) {
    const metadata = await resolveByDoi(doi);
    if (!metadata) {
      throw new Error(`Could not resolve metadata for DOI: ${doi}`);
    }
    return this.createFromMetadata(metadata, doi, tags, isTemporary);
  }

  private async importByUrl(url: string, tags: string[] = [], isTemporary: boolean = false) {
    const metadata = await resolveByUrl(url);
    if (!metadata) {
      throw new Error('Could not resolve paper metadata from URL. Try using a DOI instead.');
    }
    return this.createFromMetadata(metadata, metadata.doi ?? null, tags, isTemporary);
  }

  private async createFromMetadata(
    metadata: {
      title: string;
      authors: string[];
      year?: number;
      doi?: string;
      url?: string;
      abstract?: string;
    },
    doi: string | null,
    tags: string[],
    isTemporary: boolean = false,
  ) {
    // Generate shortId
    let shortId: string;
    if (doi) {
      const sanitized = doi.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 80);
      shortId = `doi-${sanitized}`;
    } else {
      shortId = `local-${Date.now().toString(36)}`;
    }

    // Check existing
    const existing = await this.papersRepository.findByShortId(shortId);
    if (existing) {
      return {
        paper: existing,
        download: { success: true, size: 0, skipped: true },
        existed: true,
      };
    }

    // Also check by DOI in DB
    if (doi) {
      const byDoi = await this.papersRepository.findByDoi(doi);
      if (byDoi) {
        return { paper: byDoi, download: { success: true, size: 0, skipped: true }, existed: true };
      }
    }

    await this.ensurePaperFolder(shortId);
    const submittedAt = metadata.year ? new Date(`${metadata.year}-01-01T00:00:00Z`) : undefined;

    const paper = await this.papersRepository.create({
      shortId,
      title: metadata.title,
      authors: metadata.authors,
      source: 'doi',
      sourceUrl: metadata.url,
      submittedAt,
      abstract: metadata.abstract,
      doi: doi ?? undefined,
      tags,
      isTemporary,
    });

    schedulePaperProcessing(paper.id);
    scheduleCitationExtraction(paper.id);
    scheduleAutoPaperEnrichment(paper.id);
    return { paper, download: { success: true, size: 0, skipped: false }, existed: false };
  }

  async downloadPdfById(paperId: string, pdfUrl: string) {
    const paper = await this.papersRepository.findById(paperId);
    if (!paper) throw new Error('Paper not found');
    return this.downloadPdf(paperId, paper.shortId, pdfUrl);
  }

  private async downloadPdf(paperId: string, shortId: string, pdfUrl: string) {
    const folder = this.getPaperFolder(shortId);
    const filePath = path.join(folder, 'paper.pdf');

    // Check if valid PDF already exists
    try {
      const stats = await fs.stat(filePath);
      if (stats.size >= MIN_PDF_SIZE) {
        // Verify it's actually a PDF by checking magic bytes
        const fileBuffer = await fs.readFile(filePath);
        if (isValidPdf(fileBuffer)) {
          await this.papersRepository.updatePdfPath(paperId, filePath);
          schedulePaperProcessing(paperId);
          return { success: true, size: stats.size, skipped: true };
        }
        // Invalid file — clear DB path, delete file, then re-download
        console.warn(`[download] Invalid PDF file detected, re-downloading: ${filePath}`);
        await this.papersRepository.updatePdfPath(paperId, null);
        await fs.unlink(filePath).catch(() => {});
      }
    } catch {
      // file doesn't exist, proceed
    }

    try {
      const agent = getProxyAgent();
      const response = await proxyFetch(pdfUrl, {
        agent,
        timeoutMs: 60000,
      });

      if (!response.ok) throw new Error(`Failed: ${response.status}`);

      const buffer = response.body;

      // Validate PDF content
      if (!isValidPdf(buffer)) {
        throw new Error(
          `Invalid PDF content (got ${buffer.length} bytes, starts with: ${buffer.toString('ascii', 0, Math.min(50, buffer.length))}...)`,
        );
      }

      await fs.writeFile(filePath, buffer);
      await this.papersRepository.updatePdfPath(paperId, filePath);
      schedulePaperProcessing(paperId);

      return { success: true, size: buffer.length, skipped: false };
    } catch (error) {
      // Clean up failed download — also clear DB path so UI shows download button
      await this.papersRepository.updatePdfPath(paperId, null);
      await fs.unlink(filePath).catch(() => {});
      return { success: false, size: 0, skipped: false, error: String(error) };
    }
  }

  private async importByTitle(title: string, tags: string[] = [], isTemporary?: boolean) {
    // Search OpenAlex by title
    const agent = getProxyAgent();
    const res = await proxyFetch(
      `https://api.openalex.org/works?search=${encodeURIComponent(title)}&per_page=10&select=id,title,authorships,publication_year,abstract_inverted_index,doi,ids,primary_location,open_access`,
      {
        agent,
        timeoutMs: 15_000,
        headers: { 'User-Agent': 'ResearchClaw/1.0 (mailto:researchclaw@example.com)' },
      },
    );

    if (!res.ok) {
      throw new Error(`OpenAlex search failed with status ${res.status}`);
    }

    const json = JSON.parse(res.text());
    const results = json?.results ?? [];

    // Find best match by title similarity, preferring open access versions
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim();
    const normalizedTitle = normalize(title);

    // Collect all title-matching candidates
    const candidates: any[] = [];
    for (const work of results) {
      if (!work?.title) continue;
      const normalizedWork = normalize(work.title);
      if (normalizedWork.includes(normalizedTitle) || normalizedTitle.includes(normalizedWork)) {
        candidates.push(work);
      }
    }

    if (candidates.length === 0 && results.length > 0) {
      candidates.push(results[0]);
    }

    if (candidates.length === 0) {
      throw new Error(`No paper found matching title: "${title}"`);
    }

    // Prefer: has arXiv source > has open access PDF > has DOI > first match
    let bestMatch = candidates[0];
    for (const c of candidates) {
      const isArxiv = c.primary_location?.landing_page_url?.includes('arxiv.org');
      const isOa = c.open_access?.is_oa === true;
      const bestIsArxiv = bestMatch.primary_location?.landing_page_url?.includes('arxiv.org');
      const bestIsOa = bestMatch.open_access?.is_oa === true;

      if (isArxiv && !bestIsArxiv) {
        bestMatch = c;
      } else if (isOa && !bestIsOa && !bestIsArxiv) {
        bestMatch = c;
      }
    }

    // Extract metadata from OpenAlex result
    const doi = bestMatch.doi?.replace('https://doi.org/', '') ?? null;
    const authors = (bestMatch.authorships ?? []).map(
      (a: any) => a.author?.display_name ?? 'Unknown',
    );

    // Reconstruct abstract from inverted index
    let abstract = '';
    if (bestMatch.abstract_inverted_index) {
      const words: [number, string][] = [];
      for (const [word, positions] of Object.entries(
        bestMatch.abstract_inverted_index as Record<string, number[]>,
      )) {
        if (!Array.isArray(positions)) continue;
        for (const pos of positions) words.push([pos, word]);
      }
      words.sort((a, b) => a[0] - b[0]);
      abstract = words.map(([, w]) => w).join(' ');
    }

    // Try to get arXiv ID from primary_location
    const landingUrl = bestMatch.primary_location?.landing_page_url ?? '';
    const arxivMatch = landingUrl.match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5})/);
    const arxivId = arxivMatch?.[1];

    // Determine PDF URL: open access > arXiv > none
    let pdfUrl: string | undefined;
    if (bestMatch.open_access?.oa_url) {
      pdfUrl = bestMatch.open_access.oa_url;
    } else if (arxivId) {
      pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
    }

    // Use arXiv ID as shortId if available, otherwise DOI
    const shortId =
      arxivId ??
      (doi
        ? `doi-${doi.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 80)}`
        : `local-${Date.now().toString(36)}`);

    // Check if already exists
    const existing = await this.papersRepository.findByShortId(shortId);
    if (existing) {
      return {
        paper: existing,
        download: { success: true, size: 0, skipped: true },
        existed: true,
      };
    }

    await this.ensurePaperFolder(shortId);
    const paper = await this.papersService.create({
      title: bestMatch.title,
      authors,
      source: arxivId ? 'arxiv' : 'manual',
      sourceUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : (bestMatch.doi ?? undefined),
      submittedAt: bestMatch.publication_year
        ? new Date(`${bestMatch.publication_year}-01-01T00:00:00Z`)
        : undefined,
      abstract,
      pdfUrl,
      tags,
    });

    if (isTemporary) {
      await this.papersRepository.updateTemporaryStatus(paper.id, true);
    }

    // Download PDF if available
    let downloadResult = { success: false, size: 0, skipped: true };
    if (pdfUrl) {
      downloadResult = await this.downloadPdf(paper.id, shortId, pdfUrl);
    }

    return {
      paper: { ...paper, isTemporary: !!isTemporary },
      download: downloadResult,
      existed: false,
    };
  }

  private async importByDoi(doi: string, tags: string[] = [], isTemporary?: boolean) {
    // Try Crossref first
    let metadata = await resolveByDoi(doi);
    if (metadata) {
      return this.createFromMetadata(metadata, doi, tags, isTemporary);
    }

    // Fallback: try OpenAlex DOI lookup
    try {
      const agent = getProxyAgent();
      const res = await proxyFetch(
        `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?select=id,title,authorships,publication_year,abstract_inverted_index,doi,primary_location,open_access`,
        {
          agent,
          timeoutMs: 10_000,
          headers: { 'User-Agent': 'ResearchClaw/1.0 (mailto:researchclaw@example.com)' },
        },
      );
      if (res.ok) {
        const work = JSON.parse(res.text());
        if (work?.title) {
          // Use OpenAlex data
          return this.importByTitle(work.title, tags, isTemporary);
        }
      }
    } catch {
      // Continue to error
    }

    throw new Error(`Could not resolve metadata for DOI: ${doi}`);
  }

  private async importByUrl(url: string, tags: string[] = [], isTemporary?: boolean) {
    const metadata = await resolveByUrl(url);
    if (!metadata) {
      throw new Error('Could not resolve paper metadata from URL. Try using a DOI instead.');
    }
    return this.createFromMetadata(metadata, metadata.doi ?? null, tags, isTemporary);
  }

  private async createFromMetadata(
    metadata: {
      title: string;
      authors: string[];
      year?: number;
      doi?: string;
      url?: string;
      abstract?: string;
      pdfUrl?: string;
    },
    doi: string | null,
    tags: string[],
    isTemporary?: boolean,
  ) {
    // Generate shortId from DOI or timestamp
    let shortId: string;
    if (doi) {
      const sanitized = doi.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 80);
      shortId = `doi-${sanitized}`;
    } else {
      shortId = `local-${Date.now().toString(36)}`;
    }

    // Check existing by shortId
    const existing = await this.papersRepository.findByShortId(shortId);
    if (existing) {
      return {
        paper: existing,
        download: { success: true, size: 0, skipped: true },
        existed: true,
      };
    }

    await this.ensurePaperFolder(shortId);
    const submittedAt = metadata.year ? new Date(`${metadata.year}-01-01T00:00:00Z`) : undefined;

    const paper = await this.papersService.create({
      title: metadata.title,
      authors: metadata.authors,
      source: 'manual',
      sourceUrl: metadata.url,
      submittedAt,
      abstract: metadata.abstract,
      pdfUrl: metadata.pdfUrl,
      tags,
    });

    // Mark as temporary if requested
    if (isTemporary) {
      await this.papersRepository.updateTemporaryStatus(paper.id, true);
    }

    // Try to download PDF if URL is available
    let downloadResult = { success: false, size: 0, skipped: true };
    if (metadata.pdfUrl) {
      downloadResult = await this.downloadPdf(paper.id, shortId, metadata.pdfUrl);
    }

    return {
      paper: { ...paper, isTemporary: !!isTemporary },
      download: downloadResult,
      existed: false,
    };
  }
}
