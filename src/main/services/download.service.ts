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
}
