import path from 'path';
import fs from 'fs/promises';
import { PapersRepository } from '@db';
import { extractArxivId } from '@shared';
import { getPapersDir, getProxy } from '../store/app-settings-store';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';

function getProxyAgent(): Agent | undefined {
  const proxy = getProxy();
  if (!proxy) return undefined;
  return new HttpsProxyAgent(proxy) as unknown as Agent;
}

async function fetchArxivMetadata(arxivId: string): Promise<{
  title: string;
  authors: string[];
  abstract: string;
  year: number;
} | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    const agent = getProxyAgent();
    const response = await fetch(`https://arxiv.org/abs/${arxivId}`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeResearch/1.0)' },
      ...(agent ? { agent } : {}),
    });
    clearTimeout(timeoutId);

    if (!response.ok) return null;
    const html = await response.text();

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let title = titleMatch ? titleMatch[1].trim() : '';
    title = title.replace(/^\[[\w./-]+\]\s*/, '').trim();

    const authors: string[] = [];
    const authorMatches = html.matchAll(/<meta name="citation_author" content="([^"]+)"/g);
    for (const match of authorMatches) authors.push(match[1]);

    const abstractMatch = html.match(/<meta name="citation_abstract" content="([^"]+)"/i);
    const abstract = abstractMatch ? abstractMatch[1].replace(/\n/g, ' ').trim() : '';

    const yearMatch = html.match(/\[Submitted on (\d{1,2}) \w+\.? (\d{4})/i);
    const year = yearMatch ? parseInt(yearMatch[2], 10) : new Date().getFullYear();

    return { title, authors, abstract, year };
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
    let year: number | undefined;
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
      year = metadata.year;
      pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
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
    const paper = await this.papersRepository.create({
      shortId,
      title,
      authors,
      source: 'arxiv',
      sourceUrl: arxivId ? `https://arxiv.org/abs/${arxivId}` : undefined,
      year,
      abstract,
      pdfUrl,
      tags,
    });

    const downloadResult = await this.downloadPdf(paper.id, shortId, pdfUrl);
    return { paper, download: downloadResult, existed: false };
  }

  async downloadPdfById(paperId: string, pdfUrl: string) {
    const paper = await this.papersRepository.findById(paperId);
    if (!paper) throw new Error('Paper not found');
    return this.downloadPdf(paperId, paper.shortId, pdfUrl);
  }

  private async downloadPdf(paperId: string, shortId: string, pdfUrl: string) {
    const folder = this.getPaperFolder(shortId);
    const filePath = path.join(folder, 'paper.pdf');

    try {
      const stats = await fs.stat(filePath);
      if (stats.size > 0) {
        await this.papersRepository.updatePdfPath(paperId, filePath);
        return { success: true, size: stats.size, skipped: true };
      }
    } catch {
      // proceed
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      const agent = getProxyAgent();
      const response = await fetch(pdfUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeResearch/1.0)' },
        ...(agent ? { agent } : {}),
      });
      clearTimeout(timeoutId);

      if (!response.ok || !response.body) throw new Error(`Failed: ${response.status}`);

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const buffer = Buffer.concat(chunks);
      await fs.writeFile(filePath, buffer);
      await this.papersRepository.updatePdfPath(paperId, filePath);

      return { success: true, size: buffer.length, skipped: false };
    } catch (error) {
      return { success: false, size: 0, skipped: false, error: String(error) };
    }
  }
}
