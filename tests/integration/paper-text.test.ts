import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  beforeAll,
  afterAll as afterAllFn,
} from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { PapersService } from '../../src/main/services/papers.service';
import { PapersRepository } from '../../src/db/repositories/papers.repository';

// Note: paper-text.service.ts depends on electron-specific modules (getPapersDir)
// We test the repository-level text path functionality here instead

describe('paper text service integration', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  describe('text path management', () => {
    it('updates text path for a paper', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.create({
        title: 'Paper with Text',
        source: 'manual',
        tags: [],
      });

      expect(paper.textPath).toBeNull();

      // Update text path
      const textPath = '/path/to/papers/text.txt';
      await repo.updateTextPath(paper.id, textPath);

      const updated = await repo.findById(paper.id);
      expect(updated!.textPath).toBe(textPath);
    });

    it('can update text path multiple times', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.create({
        title: 'Paper with Updated Text',
        source: 'manual',
        tags: [],
      });

      // First update
      await repo.updateTextPath(paper.id, '/path/v1/text.txt');
      let updated = await repo.findById(paper.id);
      expect(updated!.textPath).toBe('/path/v1/text.txt');

      // Second update
      await repo.updateTextPath(paper.id, '/path/v2/text.txt');
      updated = await repo.findById(paper.id);
      expect(updated!.textPath).toBe('/path/v2/text.txt');
    });
  });

  describe('paper with PDF metadata', () => {
    it('stores PDF URL correctly', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.create({
        title: 'Paper with PDF',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        pdfUrl: 'https://arxiv.org/pdf/1706.03762.pdf',
        tags: [],
      });

      expect(paper.pdfUrl).toBe('https://arxiv.org/pdf/1706.03762.pdf');
      // Note: pdfPath is not set on creation, only after download
      expect(paper.pdfPath).toBeNull();

      // Verify persistence
      const found = await repo.findById(paper.id);
      expect(found!.pdfUrl).toBe('https://arxiv.org/pdf/1706.03762.pdf');
    });

    it('updates PDF path after download', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.create({
        title: 'Paper to Download',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        pdfUrl: 'https://arxiv.org/pdf/1706.03762.pdf',
        tags: [],
      });

      expect(paper.pdfPath).toBeNull();

      // Simulate download completion
      await repo.updatePdfPath(paper.id, '/local/papers/1706.03762/paper.pdf');

      const updated = await repo.findById(paper.id);
      expect(updated!.pdfPath).toBe('/local/papers/1706.03762/paper.pdf');
    });
  });

  describe('paper metadata for text extraction', () => {
    it('stores abstract for text-based analysis', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const longAbstract =
        'This is a long abstract that would be used for text-based analysis and tagging. '.repeat(
          10,
        );

      const paper = await papersService.create({
        title: 'Paper with Long Abstract',
        source: 'arxiv',
        abstract: longAbstract,
        tags: [],
      });

      const found = await repo.findById(paper.id);
      expect(found!.abstract).toBe(longAbstract);
    });

    it('stores authors metadata', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const authors = ['Alice Smith', 'Bob Johnson', 'Carol Williams'];

      const paper = await papersService.create({
        title: 'Multi-Author Paper',
        source: 'arxiv',
        authors,
        tags: [],
      });

      const found = await repo.findById(paper.id);
      expect(found!.authors).toEqual(authors);
    });

    it('stores submission date', async () => {
      const papersService = new PapersService();
      const repo = new PapersRepository();

      const paper = await papersService.create({
        title: 'Dated Paper',
        source: 'arxiv',
        submittedAt: new Date('2023-05-20T00:00:00Z'),
        tags: [],
      });

      const found = await repo.findById(paper.id);
      expect(found!.submittedAt).toEqual(new Date('2023-05-20T00:00:00Z'));
    });
  });
});

// Integration with file system (requires storage directory)
describe('paper text file operations', () => {
  const testStorageDir = path.join(os.tmpdir(), 'vibe-research-text-test-' + Date.now());

  beforeAll(() => {
    fs.mkdirSync(path.join(testStorageDir, 'papers'), { recursive: true });
    process.env.VIBE_RESEARCH_STORAGE_DIR = testStorageDir;
  });

  afterAllFn(() => {
    fs.rmSync(testStorageDir, { recursive: true, force: true });
    delete process.env.VIBE_RESEARCH_STORAGE_DIR;
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('can create and read text files in papers directory', async () => {
    const papersService = new PapersService();
    const repo = new PapersRepository();

    const paper = await papersService.create({
      title: 'Paper with Cached Text',
      source: 'arxiv',
      sourceUrl: 'https://arxiv.org/abs/1706.03762',
      tags: [],
    });

    // Create a text file for this paper
    const paperDir = path.join(testStorageDir, 'papers', paper.shortId);
    fs.mkdirSync(paperDir, { recursive: true });

    const textContent = 'This is the extracted text content from the PDF.';
    const textFilePath = path.join(paperDir, 'text.txt');
    fs.writeFileSync(textFilePath, textContent, 'utf-8');

    // Update the paper's text path
    await repo.updateTextPath(paper.id, textFilePath);

    // Verify the file exists and content matches
    expect(fs.existsSync(textFilePath)).toBe(true);
    const readContent = fs.readFileSync(textFilePath, 'utf-8');
    expect(readContent).toBe(textContent);

    // Verify database has correct path
    const found = await repo.findById(paper.id);
    expect(found!.textPath).toBe(textFilePath);
  });

  it('handles multiple papers with separate text files', async () => {
    const papersService = new PapersService();
    const repo = new PapersRepository();

    // Create multiple papers
    const papers = await Promise.all([
      papersService.create({
        title: 'Paper One',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2401.00001',
        tags: [],
      }),
      papersService.create({
        title: 'Paper Two',
        source: 'arxiv',
        sourceUrl: 'https://arxiv.org/abs/2401.00002',
        tags: [],
      }),
    ]);

    // Create text files for each
    for (const paper of papers) {
      const paperDir = path.join(testStorageDir, 'papers', paper.shortId);
      fs.mkdirSync(paperDir, { recursive: true });

      const textContent = `Text content for ${paper.title}`;
      const textFilePath = path.join(paperDir, 'text.txt');
      fs.writeFileSync(textFilePath, textContent, 'utf-8');
      await repo.updateTextPath(paper.id, textFilePath);
    }

    // Verify each paper has its own text file
    for (const paper of papers) {
      const found = await repo.findById(paper.id);
      expect(found!.textPath).toBeDefined();

      const content = fs.readFileSync(found!.textPath!, 'utf-8');
      expect(content).toContain(paper.title);
    }
  });

  it('handles papers without local text files', async () => {
    const papersService = new PapersService();
    const repo = new PapersRepository();

    const paper = await papersService.create({
      title: 'Paper Without Local Text',
      source: 'arxiv',
      pdfUrl: 'https://arxiv.org/pdf/1706.03762.pdf',
      tags: [],
    });

    // Paper should exist but have no text path
    const found = await repo.findById(paper.id);
    expect(found!.textPath).toBeNull();
  });
});
