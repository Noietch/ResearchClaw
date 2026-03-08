import path from 'path';
import fs from 'fs/promises';
import { PapersRepository, SourceEventsRepository } from '@db';
import { extractArxivId, type CategorizedTag } from '@shared';
import { getPapersDir } from '../store/app-settings-store';

export interface CreatePaperInput {
  title: string;
  source: 'chrome' | 'manual' | 'arxiv';
  sourceUrl?: string;
  tags?: string[];
  authors?: string[];
  submittedAt?: Date;
  abstract?: string;
  pdfUrl?: string;
  pdfPath?: string;
}

export class PapersService {
  private papersRepository = new PapersRepository();
  private eventsRepository = new SourceEventsRepository();

  private async generateShortId(sourceUrl?: string): Promise<string> {
    if (sourceUrl) {
      const arxivId = extractArxivId(sourceUrl);
      if (arxivId) return arxivId;
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
    const shortId = await this.generateShortId(input.sourceUrl);
    await this.ensurePaperFolder(shortId);

    const created = await this.papersRepository.create({
      shortId,
      title: input.title,
      authors: input.authors ?? [],
      source: input.source,
      sourceUrl: input.sourceUrl,
      submittedAt: input.submittedAt,
      abstract: input.abstract,
      pdfUrl: input.pdfUrl,
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

    return created;
  }

  async upsertFromIngest(input: {
    title: string;
    source: 'chrome' | 'manual' | 'arxiv';
    sourceUrl?: string;
    tags: string[];
    authors?: string[];
    abstract?: string;
    submittedAt?: Date;
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

    return this.create({
      title: input.title,
      source: input.source,
      sourceUrl: input.sourceUrl,
      tags: input.tags,
      authors: input.authors ?? [],
      abstract: input.abstract,
      submittedAt: input.submittedAt,
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

    return created;
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
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible: VibeResearch/1.0)' },
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

    return { pdfPath: filePath, size: buffer.length, skipped: false };
  }

  async touchLastRead(id: string) {
    return this.papersRepository.touchLastRead(id);
  }

  async deleteById(id: string) {
    const existing = await this.papersRepository.findById(id);
    if (!existing) return null;
    await this.papersRepository.delete(id);
    return existing;
  }

  async deleteMany(ids: string[]): Promise<number> {
    try {
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
