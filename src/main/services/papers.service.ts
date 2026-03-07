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
  year?: number;
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
      year: input.year,
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
    year?: number;
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
      year: input.year,
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

  async downloadPdf(paperId: string, pdfUrl: string) {
    const paper = await this.papersRepository.findById(paperId);
    if (!paper) throw new Error('Paper not found');

    await this.ensurePaperFolder(paper.shortId);
    const folder = this.getPaperFolder(paper.shortId);
    const filePath = path.join(folder, 'paper.pdf');

    try {
      const stats = await fs.stat(filePath);
      if (stats.size > 0) {
        if (!paper.pdfPath) await this.papersRepository.updatePdfPath(paperId, filePath);
        return { pdfPath: filePath, size: stats.size, skipped: true };
      }
    } catch {
      // file doesn't exist, proceed
    }

    const response = await fetch(pdfUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibResearch/1.0)' },
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
    await fs.writeFile(filePath, buffer);
    await this.papersRepository.updatePdfPath(paperId, filePath);

    return { pdfPath: filePath, size: buffer.length, skipped: false };
  }

  async touchLastRead(id: string) {
    return this.papersRepository.touchLastRead(id);
  }

  /**
   * Find papers whose title looks like a URL or raw arXiv ID,
   * fetch the real title from arxiv.org, and update it.
   * Also ensures titles are prefixed with [arxivId] for easy identification.
   */
  async fixUrlTitles(
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ fixed: number; failed: number }> {
    const all = await this.papersRepository.listAll();

    const needsFix = all.filter((p) => {
      const t = p.title;
      return t.startsWith('http') || t.includes('arxiv.org') || /^\d{4}\.\d{4,5}(v\d+)?$/.test(t);
    });

    let fixed = 0;
    let failed = 0;

    for (let i = 0; i < needsFix.length; i++) {
      const paper = needsFix[i];
      onProgress?.(i, needsFix.length);

      const arxivId = paper.shortId.match(/^\d{4}\.\d{4,5}(v\d+)?$/) ? paper.shortId : null;
      if (!arxivId) {
        failed++;
        continue;
      }

      try {
        const response = await fetch(`https://arxiv.org/abs/${arxivId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeResearch/1.0)' },
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

        // Strip the [2401.12345] prefix arxiv adds
        const rawTitle = titleMatch[1].replace(/^\[[\w./-]+\]\s*/, '').trim();
        await this.papersRepository.updateTitle(paper.id, rawTitle);
        fixed++;
      } catch {
        failed++;
      }
    }

    onProgress?.(needsFix.length, needsFix.length);
    return { fixed, failed };
  }

  /**
   * Strip [arxivId] prefix from all paper titles.
   */
  async stripArxivIdPrefix(): Promise<{ updated: number }> {
    const all = await this.papersRepository.listAll();
    let updated = 0;

    for (const paper of all) {
      // Strip any [xxxx.xxxxx] prefix
      const bare = paper.title.replace(/^\[\d{4}\.\d{4,5}(v\d+)?\]\s*/, '');
      if (bare !== paper.title) {
        await this.papersRepository.updateTitle(paper.id, bare);
        updated++;
      }
    }

    return { updated };
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
