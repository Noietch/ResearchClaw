import path from 'path';
import fs from 'fs/promises';
import { BrowserWindow } from 'electron';
import { PapersRepository, SourceEventsRepository } from '@db';
import { extractArxivId, type CategorizedTag } from '@shared';
import { getPapersDir } from '../store/app-settings-store';
import { schedulePaperProcessing } from './paper-processing.service';
import { scheduleCitationExtraction } from './citation-processing.service';
import { scheduleAutoPaperEnrichment } from './auto-paper-enrichment.service';
import * as paperEmbeddingService from './paper-embedding.service';
import { getPaperText } from './paper-text.service';
import { extractPaperMetadata } from './paper-metadata.service';

export interface CreatePaperInput {
  title: string;
  source: 'chrome' | 'manual' | 'arxiv' | 'zotero' | 'doi' | 'bibtex';
  sourceUrl?: string;
  tags?: string[];
  authors?: string[];
  submittedAt?: Date;
  year?: number;
  abstract?: string;
  pdfUrl?: string;
  pdfPath?: string;
  doi?: string;
}

export class PapersService {
  private papersRepository = new PapersRepository();
  private eventsRepository = new SourceEventsRepository();

  private async generateShortId(sourceUrl?: string, doi?: string): Promise<string> {
    if (sourceUrl) {
      const arxivId = extractArxivId(sourceUrl);
      if (arxivId) return arxivId;
    }
    if (doi) {
      // Sanitize DOI for use as shortId: replace slashes and special chars
      const sanitized = doi.replace(/[^a-zA-Z0-9.-]/g, '_').substring(0, 80);
      return `doi-${sanitized}`;
    }
    const count = await this.papersRepository.countByShortIdPrefix('local-');
    return `local-${(count + 1).toString().padStart(3, '0')}`;
  }

  private getPaperFolder(shortId: string): string {
    return path.join(getPapersDir(), shortId);
  }

  private async ensurePaperFolder(shortId: string): Promise<string> {
    const folder = this.getPaperFolder(shortId);
    await fs.mkdir(folder, { recursive: true });
    await fs.mkdir(path.join(folder, 'notes'), { recursive: true });
    return folder;
  }

  async create(input: CreatePaperInput) {
    const shortId = await this.generateShortId(input.sourceUrl, input.doi);
    await this.ensurePaperFolder(shortId);

    const submittedAt =
      input.submittedAt ?? (input.year ? new Date(`${input.year}-01-01T00:00:00Z`) : undefined);

    const created = await this.papersRepository.create({
      shortId,
      title: input.title,
      authors: input.authors ?? [],
      source: input.source,
      sourceUrl: input.sourceUrl,
      submittedAt,
      abstract: input.abstract,
      pdfUrl: input.pdfUrl,
      doi: input.doi,
      tags: input.tags ?? [],
    });

    if (input.pdfPath) {
      await this.papersRepository.updatePdfPath(created.id, input.pdfPath);
    }

    await this.eventsRepository.create({
      paperId: created.id,
      source: input.source,
      rawTitle: input.title,
      rawUrl: input.sourceUrl,
    });

    if (input.pdfPath || input.pdfUrl || input.source === 'arxiv') {
      schedulePaperProcessing(created.id);
    }
    scheduleCitationExtraction(created.id);
    scheduleAutoPaperEnrichment(created.id);

    return created;
  }

  async upsertFromIngest(input: {
    title: string;
    source: 'chrome' | 'manual' | 'arxiv' | 'zotero' | 'doi' | 'bibtex';
    sourceUrl?: string;
    tags: string[];
    authors?: string[];
    abstract?: string;
    submittedAt?: Date;
    doi?: string;
    pdfPath?: string;
  }) {
    // Deduplicate by shortId (arxiv ID extracted from sourceUrl)
    if (input.sourceUrl) {
      const arxivMatch = input.sourceUrl.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]+\.[0-9v]+)/i);
      if (arxivMatch) {
        const shortId = arxivMatch[1].replace(/v\d+$/, '');
        const existing = await this.papersRepository.findByShortId(shortId);
        if (existing) return existing;
      }
    }

    // Deduplicate by DOI
    if (input.doi) {
      const existing = await this.papersRepository.findByDoi(input.doi);
      if (existing) return existing;
    }

    return this.create({
      title: input.title,
      source: input.source,
      sourceUrl: input.sourceUrl,
      tags: input.tags,
      authors: input.authors ?? [],
      abstract: input.abstract,
      submittedAt: input.submittedAt,
      doi: input.doi,
      pdfPath: input.pdfPath,
    });
  }

  async list(query: {
    q?: string;
    year?: number;
    tag?: string;
    importedWithin?: 'today' | 'week' | 'month' | 'all';
  }) {
    return this.papersRepository.list(query);
  }

  async listToday() {
    return this.papersRepository.listToday();
  }

  async getById(id: string) {
    return this.papersRepository.findById(id);
  }

  async getByShortId(shortId: string) {
    return this.papersRepository.findByShortId(shortId);
  }

  async importLocalPdf(filePath: string) {
    const resolvedPath = path.resolve(filePath);
    const extension = path.extname(resolvedPath).toLowerCase();
    if (extension !== '.pdf') {
      throw new Error('Only PDF files are supported');
    }

    const sourceStats = await fs.stat(resolvedPath).catch(() => null);
    if (!sourceStats?.isFile()) {
      throw new Error('Selected PDF file was not found');
    }

    const title =
      path
        .basename(resolvedPath, extension)
        .replace(/[._-]+/g, ' ')
        .trim() || 'Untitled PDF';
    const shortId = await this.generateShortId();
    const folder = await this.ensurePaperFolder(shortId);
    const importedPdfPath = path.join(folder, 'paper.pdf');

    await fs.copyFile(resolvedPath, importedPdfPath);

    const created = await this.papersRepository.create({
      shortId,
      title,
      authors: [],
      source: 'manual',
      pdfPath: importedPdfPath,
      tags: ['pdf'],
    });

    await this.eventsRepository.create({
      paperId: created.id,
      source: 'manual',
      rawTitle: title,
      rawUrl: resolvedPath,
    });

    // Extract metadata from PDF using LLM (async, non-blocking)
    void this.extractAndUpdateMetadata(created.id, created.shortId, importedPdfPath);

    scheduleCitationExtraction(created.id);

    return created;
  }

  private async extractAndUpdateMetadata(
    paperId: string,
    shortId: string,
    pdfPath: string,
  ): Promise<void> {
    try {
      const text = await getPaperText(paperId, shortId, undefined, pdfPath, { maxChars: 18000 });
      if (!text.trim()) {
        console.warn(`[papers] No text extracted from PDF for ${shortId}`);
        return;
      }

      const metadata = await extractPaperMetadata(text);
      console.log(
        `[papers] Extracted metadata for ${shortId}: title="${metadata.title?.slice(0, 60) ?? '<none>'}"`,
      );

      await this.papersRepository.updateMetadata(paperId, {
        ...(metadata.title && { title: metadata.title }),
        ...(metadata.authors?.length && { authors: metadata.authors }),
        ...(metadata.abstract && { abstract: metadata.abstract }),
        ...(metadata.submittedAt && { submittedAt: metadata.submittedAt }),
        metadataSource: 'llm',
      });

      // Notify renderer to refresh paper list
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('papers:metadataUpdated', { paperId });
      }

      // Now that we have an abstract, trigger processing and enrichment
      schedulePaperProcessing(paperId);
      scheduleAutoPaperEnrichment(paperId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[papers] Metadata extraction failed for ${shortId}: ${msg}`);
      // Non-fatal: paper still exists with filename as title
    }
  }

  async downloadPdf(paperId: string, pdfUrl: string) {
    const paper = await this.papersRepository.findById(paperId);
    if (!paper) throw new Error('Paper not found');

    await this.ensurePaperFolder(paper.shortId);
    const folder = this.getPaperFolder(paper.shortId);
    const filePath = path.join(folder, 'paper.pdf');

    const MIN_PDF_SIZE = 1024;
    const isValidPdf = (buf: Buffer) => buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-';

    // Check if valid PDF already exists
    try {
      const stats = await fs.stat(filePath);
      if (stats.size >= MIN_PDF_SIZE) {
        const fileBuffer = await fs.readFile(filePath);
        if (isValidPdf(fileBuffer)) {
          if (!paper.pdfPath) await this.papersRepository.updatePdfPath(paperId, filePath);
          scheduleAutoPaperEnrichment(paperId);
          return { pdfPath: filePath, size: stats.size, skipped: true };
        }
        // Invalid file — clear DB path, delete file, then re-download
        console.warn(`[papers] Invalid PDF file detected, re-downloading: ${filePath}`);
        await this.papersRepository.updatePdfPath(paperId, null);
        await fs.unlink(filePath).catch(() => {});
      }
    } catch {
      // file doesn't exist, proceed
    }

    const response = await fetch(pdfUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible: ResearchClaw/1.0)' },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Failed to download PDF: ${response.status}`);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const buffer = Buffer.concat(chunks);

    // Validate PDF content
    if (!isValidPdf(buffer)) {
      await fs.unlink(filePath).catch(() => {});
      throw new Error(
        `Invalid PDF content (got ${buffer.length} bytes, starts with: ${buffer.toString('ascii', 0, Math.min(50, buffer.length))}...)`,
      );
    }

    await fs.writeFile(filePath, buffer);
    await this.papersRepository.updatePdfPath(paperId, filePath);
    schedulePaperProcessing(paperId);
    scheduleAutoPaperEnrichment(paperId);

    return { pdfPath: filePath, size: buffer.length, skipped: false };
  }

  async touchLastRead(id: string) {
    return this.papersRepository.touchLastRead(id);
  }

  async fixUrlTitles(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ fixed: number; failed: number }> {
    const all = await this.papersRepository.listAll();

    const needsFix = all.filter((paper) => {
      const title = paper.title;
      return (
        title.startsWith('http') ||
        title.includes('arxiv.org') ||
        /^\d{4}\.\d{4,5}(v\d+)?$/.test(title)
      );
    });

    let fixed = 0;
    let failed = 0;

    for (let index = 0; index < needsFix.length; index++) {
      const paper = needsFix[index];
      onProgress?.(index, needsFix.length);

      const arxivId = /^\d{4}\.\d{4,5}(v\d+)?$/.test(paper.shortId) ? paper.shortId : null;
      if (!arxivId) {
        failed++;
        continue;
      }

      try {
        const response = await fetch(`https://arxiv.org/abs/${arxivId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchClaw/1.0)' },
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) {
          failed++;
          continue;
        }

        const html = await response.text();
        const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
        if (!titleMatch) {
          failed++;
          continue;
        }

        const rawTitle = titleMatch[1].replace(/^\[[\w./-]+\]\s*/, '').trim();
        await this.papersRepository.updateTitle(paper.id, rawTitle);
        await paperEmbeddingService.generateEmbeddings(paper.id).catch(() => undefined);
        fixed++;
      } catch {
        failed++;
      }
    }

    onProgress?.(needsFix.length, needsFix.length);
    return { fixed, failed };
  }

  async stripArxivIdPrefix(): Promise<{ updated: number }> {
    const all = await this.papersRepository.listAll();
    let updated = 0;

    for (const paper of all) {
      const bareTitle = paper.title.replace(/^\[\d{4}\.\d{4,5}(v\d+)?\]\s*/, '');
      if (bareTitle !== paper.title) {
        await this.papersRepository.updateTitle(paper.id, bareTitle);
        await paperEmbeddingService.generateEmbeddings(paper.id).catch(() => undefined);
        updated++;
      }
    }

    return { updated };
  }

  async deleteById(id: string) {
    const existing = await this.papersRepository.findById(id);
    if (!existing) return null;
    try {
      await paperEmbeddingService.deleteEmbeddings(id);
    } catch {
      // vec cleanup failure should not block deletion
    }
    await this.papersRepository.delete(id);
    return existing;
  }

  async deleteMany(ids: string[]): Promise<number> {
    try {
      // Clean up embeddings before Prisma deletes the papers
      try {
        for (const id of ids) {
          await paperEmbeddingService.deleteEmbeddings(id).catch(() => undefined);
        }
      } catch {
        // vec cleanup failure should not block deletion
      }
      return await this.papersRepository.deleteMany(ids);
    } catch (err) {
      console.error('[PapersService] deleteMany error:', err);
      throw err;
    }
  }

  async listAllShortIds(): Promise<Set<string>> {
    return this.papersRepository.listAllShortIds();
  }

  async updateTags(id: string, tags: string[]) {
    return this.papersRepository.updateTags(id, tags);
  }

  async updateRating(id: string, rating: number | null) {
    return this.papersRepository.updateRating(id, rating);
  }

  async updateAbstract(id: string, abstract: string) {
    return this.papersRepository.updateAbstract(id, abstract);
  }

  async listAllTags(): Promise<Array<{ name: string; category: string; count: number }>> {
    return this.papersRepository.listAllTagsWithCategory();
  }

  async listTagVocabulary() {
    return this.papersRepository.listTagVocabulary();
  }

  async updateTagsWithCategories(id: string, tags: CategorizedTag[]) {
    return this.papersRepository.updateTagsWithCategories(id, tags);
  }

  async getSourceEvents(paperId: string) {
    return this.eventsRepository.findByPaperId(paperId);
  }
}
