import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';
import { CollectionsRepository } from '../../src/db/repositories/collections.repository';
import { PapersService } from '../../src/main/services/papers.service';
import type { TagCategory } from '@shared';

describe('collections integration', () => {
  ensureTestDatabaseSchema();

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  describe('CRUD', () => {
    it('creates a collection and lists it', async () => {
      const repo = new CollectionsRepository();
      const created = await repo.create({ name: 'Test Collection', icon: '🧪', color: 'blue' });
      expect(created.name).toBe('Test Collection');
      expect(created.icon).toBe('🧪');
      expect(created.color).toBe('blue');

      const all = await repo.list();
      expect(all.length).toBe(1);
      expect(all[0].name).toBe('Test Collection');
      expect(all[0].paperCount).toBe(0);
    });

    it('updates a collection', async () => {
      const repo = new CollectionsRepository();
      const created = await repo.create({ name: 'Old Name' });
      await repo.update(created.id, { name: 'New Name', icon: '✨' });

      const updated = await repo.findById(created.id);
      expect(updated!.name).toBe('New Name');
      expect(updated!.icon).toBe('✨');
    });

    it('deletes a non-default collection', async () => {
      const repo = new CollectionsRepository();
      const created = await repo.create({ name: 'Temp' });
      await repo.delete(created.id);

      const all = await repo.list();
      expect(all.length).toBe(0);
    });

    it('auto-increments sortOrder', async () => {
      const repo = new CollectionsRepository();
      const c1 = await repo.create({ name: 'First' });
      const c2 = await repo.create({ name: 'Second' });
      expect(c2.sortOrder).toBeGreaterThan(c1.sortOrder);
    });
  });

  describe('default collections', () => {
    it('creates default collections idempotently', async () => {
      const repo = new CollectionsRepository();
      await repo.ensureDefaults();
      await repo.ensureDefaults(); // Second call should be idempotent

      const all = await repo.list();
      expect(all.length).toBe(3);
      expect(all.map((c) => c.name).sort()).toEqual(['Interesting', 'My Papers', 'To Read'].sort());
      expect(all.every((c) => c.isDefault)).toBe(true);
    });

    it('prevents deletion of default collections', async () => {
      const repo = new CollectionsRepository();
      await repo.ensureDefaults();

      const defaults = await repo.list();
      const myPapers = defaults.find((c) => c.name === 'My Papers')!;

      await expect(repo.delete(myPapers.id)).rejects.toThrow('Cannot delete default collection');
    });
  });

  describe('paper associations', () => {
    it('adds and removes papers from collections', async () => {
      const repo = new CollectionsRepository();
      const papersService = new PapersService();

      const collection = await repo.create({ name: 'Test' });
      const paper = await papersService.create({
        title: 'Test Paper',
        source: 'manual',
        tags: [],
      });

      await repo.addPaper(collection.id, paper.id);

      let papers = await repo.listPapers(collection.id);
      expect(papers.length).toBe(1);
      expect(papers[0].title).toBe('Test Paper');

      // Verify getCollectionsForPaper
      const paperCollections = await repo.getCollectionsForPaper(paper.id);
      expect(paperCollections.length).toBe(1);
      expect(paperCollections[0].name).toBe('Test');

      // Remove
      await repo.removePaper(collection.id, paper.id);
      papers = await repo.listPapers(collection.id);
      expect(papers.length).toBe(0);
    });

    it('addPaper is idempotent', async () => {
      const repo = new CollectionsRepository();
      const papersService = new PapersService();

      const collection = await repo.create({ name: 'Test' });
      const paper = await papersService.create({
        title: 'Duplication Test',
        source: 'manual',
        tags: [],
      });

      await repo.addPaper(collection.id, paper.id);
      await repo.addPaper(collection.id, paper.id); // Should not throw

      const papers = await repo.listPapers(collection.id);
      expect(papers.length).toBe(1);
    });

    it('batch adds papers to a collection', async () => {
      const repo = new CollectionsRepository();
      const papersService = new PapersService();

      const collection = await repo.create({ name: 'Batch Test' });
      const p1 = await papersService.create({ title: 'P1', source: 'manual', tags: [] });
      const p2 = await papersService.create({ title: 'P2', source: 'manual', tags: [] });
      const p3 = await papersService.create({ title: 'P3', source: 'manual', tags: [] });

      await repo.addPapers(collection.id, [p1.id, p2.id, p3.id]);

      const papers = await repo.listPapers(collection.id);
      expect(papers.length).toBe(3);
    });

    it('lists papers with their tags', async () => {
      const repo = new CollectionsRepository();
      const papersService = new PapersService();

      const collection = await repo.create({ name: 'Tagged' });
      const paper = await papersService.create({
        title: 'Tagged Paper',
        source: 'manual',
        tags: ['ml', 'transformer'],
      });

      await repo.addPaper(collection.id, paper.id);
      const papers = await repo.listPapers(collection.id);
      expect(papers[0].tagNames).toContain('ml');
      expect(papers[0].tagNames).toContain('transformer');
    });

    it('collection paperCount reflects additions', async () => {
      const repo = new CollectionsRepository();
      const papersService = new PapersService();

      const collection = await repo.create({ name: 'Count Test' });
      const p1 = await papersService.create({ title: 'P1', source: 'manual', tags: [] });
      const p2 = await papersService.create({ title: 'P2', source: 'manual', tags: [] });

      await repo.addPaper(collection.id, p1.id);
      await repo.addPaper(collection.id, p2.id);

      const all = await repo.list();
      const col = all.find((c) => c.id === collection.id)!;
      expect(col.paperCount).toBe(2);
    });
  });

  describe('research profile', () => {
    it('generates accurate tag, year, and author distributions', async () => {
      const repo = new CollectionsRepository();
      const papersService = new PapersService();

      const collection = await repo.create({ name: 'Profile Test' });

      // Create papers with diverse tags, years, authors
      const p1 = await papersService.create({
        title: 'Transformer Attention Mechanisms',
        source: 'manual',
        tags: ['transformer', 'attention'],
        authors: ['Alice', 'Bob'],
        year: 2023,
      });
      const p2 = await papersService.create({
        title: 'RL for Robotics',
        source: 'manual',
        tags: ['reinforcement-learning', 'robotics'],
        authors: ['Alice', 'Charlie'],
        year: 2024,
      });
      const p3 = await papersService.create({
        title: 'Vision Transformers',
        source: 'manual',
        tags: ['transformer', 'cv'],
        authors: ['Bob', 'Diana'],
        year: 2023,
      });

      await repo.addPapers(collection.id, [p1.id, p2.id, p3.id]);

      const profile = await repo.getResearchProfile(collection.id);

      // Total papers
      expect(profile.totalPapers).toBe(3);

      // Tag distribution
      const transformerTag = profile.tagDistribution.find((t) => t.name === 'transformer');
      expect(transformerTag).toBeDefined();
      expect(transformerTag!.count).toBe(2);

      // Year distribution
      expect(profile.yearDistribution).toContainEqual({ year: 2023, count: 2 });
      expect(profile.yearDistribution).toContainEqual({ year: 2024, count: 1 });

      // Top authors
      const alice = profile.topAuthors.find((a) => a.name === 'Alice');
      const bob = profile.topAuthors.find((a) => a.name === 'Bob');
      expect(alice!.count).toBe(2);
      expect(bob!.count).toBe(2);
    });

    it('returns empty profile for empty collection', async () => {
      const repo = new CollectionsRepository();
      const collection = await repo.create({ name: 'Empty' });

      const profile = await repo.getResearchProfile(collection.id);
      expect(profile.totalPapers).toBe(0);
      expect(profile.tagDistribution).toEqual([]);
      expect(profile.yearDistribution).toEqual([]);
      expect(profile.topAuthors).toEqual([]);
    });
  });

  describe('full chain: papers + tags → collection → profile', () => {
    it('creates papers with categorized tags, adds to collection, verifies profile', async () => {
      const repo = new CollectionsRepository();
      const papersService = new PapersService();

      // Create collection
      await repo.ensureDefaults();
      const collections = await repo.list();
      const myPapers = collections.find((c) => c.name === 'My Papers')!;

      // Create papers simulating Chrome history import flow
      const paper1 = await papersService.create({
        title: 'Attention Is All You Need',
        source: 'chrome',
        sourceUrl: 'https://arxiv.org/abs/1706.03762',
        tags: ['transformer', 'attention', 'nlp'],
        authors: ['Vaswani', 'Shazeer', 'Parmar'],
        year: 2017,
        abstract: 'We propose the Transformer, based solely on attention mechanisms.',
      });

      const paper2 = await papersService.create({
        title: 'BERT: Pre-training of Deep Bidirectional Transformers',
        source: 'chrome',
        sourceUrl: 'https://arxiv.org/abs/1810.04805',
        tags: ['transformer', 'nlp', 'pre-training'],
        authors: ['Devlin', 'Chang'],
        year: 2019,
        abstract: 'We introduce BERT, a language representation model.',
      });

      // Add to collection
      await repo.addPapers(myPapers.id, [paper1.id, paper2.id]);

      // Verify collection has papers
      const papers = await repo.listPapers(myPapers.id);
      expect(papers.length).toBe(2);

      // Verify research profile
      const profile = await repo.getResearchProfile(myPapers.id);
      expect(profile.totalPapers).toBe(2);

      // transformer appears in both papers
      const transformerTag = profile.tagDistribution.find((t) => t.name === 'transformer');
      expect(transformerTag!.count).toBe(2);

      // nlp appears in both papers
      const nlpTag = profile.tagDistribution.find((t) => t.name === 'nlp');
      expect(nlpTag!.count).toBe(2);

      // Year distribution
      expect(profile.yearDistribution.length).toBe(2);

      // Verify paperCount in list
      const updatedCollections = await repo.list();
      const updatedMyPapers = updatedCollections.find((c) => c.name === 'My Papers')!;
      expect(updatedMyPapers.paperCount).toBe(2);
    });
  });
});
