import path from 'path';
import fs from 'fs/promises';
import { PapersRepository } from '@db';
import { extractArxivId, arxivPdfUrl } from '@shared';
import { getPapersDir, getProxy, getProxyScope } from '../store/app-settings-store';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';
import { proxyFetch } from './proxy-fetch';
import { schedulePaperProcessing } from './paper-processing.service';
import { scheduleAutoPaperEnrichment } from './auto-paper-enrichment.service';
import { PapersService } from './papers.service';

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
  type: 'arxiv_id' | 'arxiv_url' | 'pdf_url';
  arxivId: string | null;
  pdfUrl: string | null;
} {
  const trimmed = input.trim();
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(trimmed)) {
    return { type: 'arxiv_id', arxivId: trimmed, pdfUrl: null };
  }
  if (trimmed.includes('arxiv.org')) {
    const arxivId = extractArxivId(trimmed);
    if (arxivId) return { type: 'arxiv_url', arxivId, pdfUrl: null };
  }
  if (trimmed.startsWith('http')) {
    const arxivId = extractArxivId(trimmed);
    if (arxivId) return { type: 'arxiv_url', arxivId, pdfUrl: null };
    return { type: 'pdf_url', arxivId: null, pdfUrl: trimmed };
  }
  return { type: 'arxiv_id', arxivId: trimmed, pdfUrl: null };
}

export class DownloadService {
  private papersRepository = new PapersRepository();
  private papersService = new PapersService();

  private getPaperFolder(shortId: string): string {
    return path.join(getPapersDir(), shortId);
  }

  private async ensurePaperFolder(shortId: string): Promise<string> {
    const folder = this.getPaperFolder(shortId);
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(path.join(folder, 'notes'), { recursive: true });
    return folder;
  }

  async downloadFromInput(input: string, tags: string[] = []) {
    const parsed = parseInput(input);

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
      pdfUrl = arxivPdfUrl(arxivId);
    } else {
      throw new Error('Invalid input: must be an arXiv ID, arXiv URL, or PDF URL');
    }

    const shortId = arxivId || `local-${Date.now().toString(36)}`;
    const existing = await this.papersRepository.findByShortId(shortId);

    if (existing) {
      const downloadResult = await this.downloadPdf(existing.id, shortId, pdfUrl);
      return { paper: existing, download: downloadResult, existed: true };
    }

    await this.ensurePaperFolder(shortId);
    const paper = await this.papersService.create({
      title,
      authors,
      source: 'arxiv',
      sourceUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined,
      submittedAt,
      abstract,
      pdfUrl,
      tags,
    });

    const downloadResult = await this.downloadPdf(paper.id, shortId, pdfUrl);
    return { paper, download: downloadResult, existed: false };
  }

  async downloadPdfById(
    paperId: string,
    pdfUrl: string,
    onProgress?: (downloaded: number, total: number) => void,
  ) {
    const paper = await this.papersRepository.findById(paperId);
    if (!paper) throw new Error('Paper not found');
    return this.downloadPdf(paperId, paper.shortId, pdfUrl, onProgress);
  }

  private async downloadPdf(
    paperId: string,
    shortId: string,
    pdfUrl: string,
    onProgress?: (downloaded: number, total: number) => void,
  ) {
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
          scheduleAutoPaperEnrichment(paperId);
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
        onProgress,
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
      scheduleAutoPaperEnrichment(paperId);

      return { success: true, size: buffer.length, skipped: false };
    } catch (error) {
      // Clean up failed download — also clear DB path so UI shows download button
      await this.papersRepository.updatePdfPath(paperId, null);
      await fs.unlink(filePath).catch(() => {});
      return { success: false, size: 0, skipped: false, error: String(error) };
    }
  }
}
