import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { PapersService } from '../../src/main/services/papers.service';

describe('papers service integration', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it('creates, lists, filters and fetches paper detail', async () => {
    const service = new PapersService();

    const paper = await service.create({
      title: 'Retrieval-Augmented Planning for Robotics',
      authors: ['Ada Lovelace'],
      source: 'manual',
      sourceUrl: 'https://example.org/papers/rapr',
      submittedAt: new Date('2025-01-01T00:00:00Z'),
      tags: ['robotics', 'agent'],
    });

    expect(paper.title).toBe('Retrieval-Augmented Planning for Robotics');
    expect(paper.shortId).toBeDefined();

    const all = await service.list({});
    expect(all.length).toBe(1);

    const filtered = await service.list({ q: 'Retrieval' });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered[0].id).toBe(paper.id);

    const byId = await service.getById(paper.id);
    expect(byId?.title).toBe(paper.title);

    const byShortId = await service.getByShortId(paper.shortId);
    expect(byShortId?.id).toBe(paper.id);
  });

  it('searches papers by tag name via q parameter', async () => {
    const service = new PapersService();

    await service.create({
      title: 'Paper About Vision',
      authors: ['Alice'],
      source: 'manual',
      tags: ['computer-vision', 'deep-learning'],
    });

    await service.create({
      title: 'Paper About NLP',
      authors: ['Bob'],
      source: 'manual',
      tags: ['nlp', 'transformers'],
    });

    const visionResults = await service.list({ q: 'computer-vision' });
    expect(visionResults.length).toBe(1);
    expect(visionResults[0].title).toBe('Paper About Vision');

    const nlpResults = await service.list({ q: 'transformers' });
    expect(nlpResults.length).toBe(1);
    expect(nlpResults[0].title).toBe('Paper About NLP');
  });

  it('returns null when paper does not exist', async () => {
    const service = new PapersService();
    const result = await service.getById('non-existing-id');
    expect(result).toBeNull();
  });

  it('deletes paper successfully', async () => {
    const service = new PapersService();

    const paper = await service.create({
      title: 'Paper to Delete',
      source: 'manual',
      tags: [],
    });

    const deleted = await service.deleteById(paper.id);
    expect(deleted?.id).toBe(paper.id);

    const all = await service.list({});
    expect(all.length).toBe(0);
  });

  it('returns null when deleting non-existent paper', async () => {
    const service = new PapersService();
    const result = await service.deleteById('non-existing-id');
    expect(result).toBeNull();
  });

  it('upserts paper without duplicating', async () => {
    const service = new PapersService();

    const first = await service.upsertFromIngest({
      title: 'Attention Is All You Need',
      source: 'arxiv',
      sourceUrl: 'https://arxiv.org/abs/1706.03762',
      tags: ['llm', 'transformer'],
    });

    const second = await service.upsertFromIngest({
      title: 'Attention Is All You Need',
      source: 'arxiv',
      sourceUrl: 'https://arxiv.org/abs/1706.03762',
      tags: ['llm'],
    });

    expect(first.id).toBe(second.id);
    const all = await service.list({});
    expect(all.length).toBe(1);
  });
});

describe('batch PDF import', () => {
  const testStorageDir = path.join(os.tmpdir(), 'researchclaw-batch-pdf-test-' + Date.now());
  const tmpPdfDir = path.join(os.tmpdir(), 'researchclaw-pdf-src-' + Date.now());

  ensureTestDatabaseSchema();

  beforeAll(() => {
    fs.mkdirSync(path.join(testStorageDir, 'papers'), { recursive: true });
    fs.mkdirSync(tmpPdfDir, { recursive: true });
    process.env.RESEARCH_CLAW_STORAGE_DIR = testStorageDir;
  });

  afterAll(async () => {
    await closeTestDatabase();
    fs.rmSync(testStorageDir, { recursive: true, force: true });
    fs.rmSync(tmpPdfDir, { recursive: true, force: true });
    delete process.env.RESEARCH_CLAW_STORAGE_DIR;
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  function createFakePdf(name: string): string {
    const filePath = path.join(tmpPdfDir, name);
    // Minimal PDF header so the file passes basic validation
    fs.writeFileSync(filePath, '%PDF-1.4 fake content');
    return filePath;
  }

  it('imports multiple local PDFs sequentially', async () => {
    const service = new PapersService();

    const pdf1 = createFakePdf('attention-is-all-you-need.pdf');
    const pdf2 = createFakePdf('bert-pretraining.pdf');
    const pdf3 = createFakePdf('gpt-4-technical-report.pdf');

    const results = [];
    for (const pdfPath of [pdf1, pdf2, pdf3]) {
      const paper = await service.importLocalPdf(pdfPath);
      results.push(paper);
    }

    expect(results).toHaveLength(3);
    expect(results[0].title).toBe('attention is all you need');
    expect(results[1].title).toBe('bert pretraining');
    expect(results[2].title).toBe('gpt 4 technical report');

    const all = await service.list({});
    expect(all).toHaveLength(3);

    // Each paper should have 'pdf' tag
    for (const paper of all) {
      expect(paper.tagNames).toContain('pdf');
    }
  });

  it('rejects non-PDF files', async () => {
    const service = new PapersService();
    const txtFile = path.join(tmpPdfDir, 'notes.txt');
    fs.writeFileSync(txtFile, 'just text');

    await expect(service.importLocalPdf(txtFile)).rejects.toThrow('Only PDF files are supported');
  });

  it('rejects non-existent files', async () => {
    const service = new PapersService();
    const fakePath = path.join(tmpPdfDir, 'does-not-exist.pdf');

    await expect(service.importLocalPdf(fakePath)).rejects.toThrow(
      'Selected PDF file was not found',
    );
  });
});
