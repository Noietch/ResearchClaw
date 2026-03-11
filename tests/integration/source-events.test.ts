/**
 * Integration tests for SourceEventsRepository
 *
 * Tests cover:
 *  - Creating source events for papers
 *  - Finding events by paper ID
 *  - Multiple events per paper (ordered by importedAt desc)
 *  - Different source types (chrome, manual, arxiv)
 *  - Events with and without rawTitle/rawUrl
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { SourceEventsRepository } from '../../src/db/repositories/source-events.repository';
import { PapersRepository } from '../../src/db/repositories/papers.repository';

// Mock vec-client to avoid sqlite-vec dependency in tests
vi.mock('../../src/db/vec-client', () => ({
  getVecDb: vi.fn(() => ({
    prepare: vi.fn(() => ({ run: vi.fn(), all: vi.fn(() => []), get: vi.fn() })),
    transaction: vi.fn((fn: Function) => fn),
  })),
  closeVecDb: vi.fn(),
}));

describe('SourceEventsRepository', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  async function createPaper(shortId: string, title: string) {
    const repo = new PapersRepository();
    return repo.create({
      shortId,
      title,
      authors: [],
      source: 'manual',
      tags: [],
    });
  }

  describe('create', () => {
    it('creates a manual source event', async () => {
      const paper = await createPaper('local-001', 'Manual Paper');
      const eventsRepo = new SourceEventsRepository();

      const event = await eventsRepo.create({
        paperId: paper.id,
        source: 'manual',
        rawTitle: 'Manual Paper',
        rawUrl: undefined,
      });

      expect(event.id).toBeDefined();
      expect(event.paperId).toBe(paper.id);
      expect(event.source).toBe('manual');
      expect(event.rawTitle).toBe('Manual Paper');
    });

    it('creates a chrome source event with URL', async () => {
      const paper = await createPaper('1706.03762', 'Attention Is All You Need');
      const eventsRepo = new SourceEventsRepository();

      const event = await eventsRepo.create({
        paperId: paper.id,
        source: 'chrome',
        rawTitle: 'arxiv.org/abs/1706.03762',
        rawUrl: 'https://arxiv.org/abs/1706.03762',
      });

      expect(event.source).toBe('chrome');
      expect(event.rawUrl).toBe('https://arxiv.org/abs/1706.03762');
    });

    it('creates an arxiv source event', async () => {
      const paper = await createPaper('2504.16054', 'GPT-4 Technical Report');
      const eventsRepo = new SourceEventsRepository();

      const event = await eventsRepo.create({
        paperId: paper.id,
        source: 'arxiv',
        rawTitle: 'GPT-4 Technical Report',
        rawUrl: 'https://arxiv.org/abs/2504.16054',
      });

      expect(event.source).toBe('arxiv');
    });

    it('creates event without rawTitle or rawUrl', async () => {
      const paper = await createPaper('local-002', 'Minimal Paper');
      const eventsRepo = new SourceEventsRepository();

      const event = await eventsRepo.create({
        paperId: paper.id,
        source: 'manual',
      });

      expect(event.id).toBeDefined();
      expect(event.rawTitle).toBeNull();
      expect(event.rawUrl).toBeNull();
    });

    it('stores importedAt timestamp', async () => {
      const paper = await createPaper('local-003', 'Timestamped Paper');
      const eventsRepo = new SourceEventsRepository();

      const before = Date.now();
      const event = await eventsRepo.create({
        paperId: paper.id,
        source: 'manual',
      });
      const after = Date.now();

      const importedAt = new Date(event.importedAt).getTime();
      expect(importedAt).toBeGreaterThanOrEqual(before);
      // Allow small buffer for timestamp precision differences
      expect(importedAt).toBeLessThanOrEqual(after + 1000);
    });
  });

  describe('findByPaperId', () => {
    it('returns all events for a paper', async () => {
      const paper = await createPaper('local-004', 'Multi-Event Paper');
      const eventsRepo = new SourceEventsRepository();

      await eventsRepo.create({ paperId: paper.id, source: 'chrome', rawTitle: 'Event 1' });
      await eventsRepo.create({ paperId: paper.id, source: 'manual', rawTitle: 'Event 2' });

      const events = await eventsRepo.findByPaperId(paper.id);
      expect(events.length).toBe(2);
    });

    it('returns empty array for paper with no events', async () => {
      const paper = await createPaper('local-005', 'No Events Paper');
      const eventsRepo = new SourceEventsRepository();

      const events = await eventsRepo.findByPaperId(paper.id);
      expect(events).toHaveLength(0);
    });

    it('does not return events from other papers', async () => {
      const paper1 = await createPaper('local-006', 'Paper 1');
      const paper2 = await createPaper('local-007', 'Paper 2');
      const eventsRepo = new SourceEventsRepository();

      await eventsRepo.create({ paperId: paper1.id, source: 'manual' });
      await eventsRepo.create({ paperId: paper2.id, source: 'chrome' });

      const paper1Events = await eventsRepo.findByPaperId(paper1.id);
      expect(paper1Events.length).toBe(1);
      expect(paper1Events[0].paperId).toBe(paper1.id);
    });

    it('returns events ordered by importedAt descending (newest first)', async () => {
      const paper = await createPaper('local-008', 'Ordered Events Paper');
      const eventsRepo = new SourceEventsRepository();

      // Create events with slight delay to ensure ordering
      await eventsRepo.create({ paperId: paper.id, source: 'chrome', rawTitle: 'First' });
      // Small artificial delay via a tight loop to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));
      await eventsRepo.create({ paperId: paper.id, source: 'manual', rawTitle: 'Second' });

      const events = await eventsRepo.findByPaperId(paper.id);
      expect(events.length).toBe(2);
      // Newest first
      expect(events[0].rawTitle).toBe('Second');
      expect(events[1].rawTitle).toBe('First');
    });
  });

  describe('integration with paper workflow', () => {
    it('tracks multiple import events for the same paper (re-import scenario)', async () => {
      const paper = await createPaper('1810.04805', 'BERT');
      const eventsRepo = new SourceEventsRepository();

      // Simulate first import from Chrome history
      await eventsRepo.create({
        paperId: paper.id,
        source: 'chrome',
        rawTitle: 'arxiv.org/abs/1810.04805',
        rawUrl: 'https://arxiv.org/abs/1810.04805',
      });

      // Simulate second import via manual add
      await eventsRepo.create({
        paperId: paper.id,
        source: 'manual',
        rawTitle: 'BERT: Pre-training of Deep Bidirectional Transformers',
      });

      const events = await eventsRepo.findByPaperId(paper.id);
      expect(events.length).toBe(2);

      const sources = events.map((e) => e.source);
      expect(sources).toContain('chrome');
      expect(sources).toContain('manual');
    });

    it('simulates realistic Chrome history import', async () => {
      const papersRepo = new PapersRepository();
      const eventsRepo = new SourceEventsRepository();

      // Simulate importing multiple papers from Chrome history
      const historyEntries = [
        { url: 'https://arxiv.org/abs/1706.03762', title: 'arxiv.org/abs/1706.03762' },
        { url: 'https://arxiv.org/abs/1810.04805', title: 'arxiv.org/abs/1810.04805' },
        { url: 'https://arxiv.org/abs/2005.14165', title: 'arxiv.org/abs/2005.14165' },
      ];

      const papers = [];
      for (let i = 0; i < historyEntries.length; i++) {
        const entry = historyEntries[i];
        const paper = await papersRepo.create({
          shortId: `arxiv-${i}`,
          title: `Paper ${i}`,
          authors: [],
          source: 'chrome',
          sourceUrl: entry.url,
          tags: [],
        });

        await eventsRepo.create({
          paperId: paper.id,
          source: 'chrome',
          rawTitle: entry.title,
          rawUrl: entry.url,
        });

        papers.push(paper);
      }

      // Verify each paper has exactly one event
      for (const paper of papers) {
        const events = await eventsRepo.findByPaperId(paper.id);
        expect(events.length).toBe(1);
        expect(events[0].source).toBe('chrome');
      }

      // Verify total papers created
      const allPapers = await papersRepo.list({});
      expect(allPapers.length).toBe(3);
    });
  });
});
