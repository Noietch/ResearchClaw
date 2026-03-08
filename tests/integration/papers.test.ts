import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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
