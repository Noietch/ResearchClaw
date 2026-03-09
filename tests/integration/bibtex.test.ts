import { describe, it, expect } from 'vitest';
import { generateBibtexKey, paperToBibtex, papersToBibtexFile } from '@shared';

describe('BibTeX generation', () => {
  const fullPaper = {
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    authors: ['Ada Lovelace', 'Charles Babbage'],
    submittedAt: '2025-01-15T00:00:00Z',
    sourceUrl: 'https://arxiv.org/abs/2501.12345',
    shortId: '2501.12345',
  };

  describe('generateBibtexKey', () => {
    it('generates key from first author last name, year, and first meaningful title word', () => {
      const key = generateBibtexKey(fullPaper);
      expect(key).toBe('lovelace2025retrievalaugmented');
    });

    it('uses "unknown" when no authors', () => {
      const key = generateBibtexKey({ title: 'Some Paper', authors: [] });
      expect(key).toBe('unknownndpaper');
    });

    it('uses "nd" when no submittedAt', () => {
      const key = generateBibtexKey({ title: 'Some Paper', authors: ['John Doe'] });
      expect(key).toBe('doendpaper');
    });

    it('skips stop words in title', () => {
      const key = generateBibtexKey({
        title: 'A Survey of Deep Learning',
        authors: ['Jane Smith'],
        submittedAt: '2024-06-01T00:00:00Z',
      });
      expect(key).toBe('smith2024survey');
    });

    it('handles single-word author names', () => {
      const key = generateBibtexKey({
        title: 'Test',
        authors: ['Madonna'],
        submittedAt: '2023-01-01T00:00:00Z',
      });
      expect(key).toBe('madonna2023test');
    });
  });

  describe('paperToBibtex', () => {
    it('generates complete BibTeX entry with all fields', () => {
      const bibtex = paperToBibtex(fullPaper);
      expect(bibtex).toContain('@article{lovelace2025retrievalaugmented,');
      expect(bibtex).toContain(
        '  title = {Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks}',
      );
      expect(bibtex).toContain('  author = {Ada Lovelace and Charles Babbage}');
      expect(bibtex).toContain('  year = {2025}');
      expect(bibtex).toContain('  url = {https://arxiv.org/abs/2501.12345}');
      expect(bibtex).toContain('  eprint = {2501.12345}');
      expect(bibtex).toContain('  archiveprefix = {arXiv}');
      expect(bibtex).toMatch(/\}$/);
    });

    it('omits author field when no authors', () => {
      const bibtex = paperToBibtex({ title: 'Lonely Paper' });
      expect(bibtex).not.toContain('author');
      expect(bibtex).toContain('  title = {Lonely Paper}');
    });

    it('omits year when no submittedAt', () => {
      const bibtex = paperToBibtex({ title: 'Timeless Paper', authors: ['Someone'] });
      expect(bibtex).not.toContain('year');
    });

    it('omits eprint/archiveprefix for non-arXiv URLs', () => {
      const bibtex = paperToBibtex({
        title: 'Web Paper',
        sourceUrl: 'https://example.com/paper.pdf',
      });
      expect(bibtex).toContain('  url = {https://example.com/paper.pdf}');
      expect(bibtex).not.toContain('eprint');
      expect(bibtex).not.toContain('archiveprefix');
    });

    it('escapes special LaTeX characters in title', () => {
      const bibtex = paperToBibtex({
        title: 'Costs & Benefits: 100% of #1 Items {with} Underscores_Here',
        authors: ['Test Author'],
      });
      expect(bibtex).toContain(
        '  title = {Costs \\& Benefits: 100\\% of \\#1 Items \\{with\\} Underscores\\_Here}',
      );
    });

    it('escapes special characters in author names', () => {
      const bibtex = paperToBibtex({
        title: 'Test',
        authors: ['José García'],
      });
      expect(bibtex).toContain('  author = {José García}');
    });

    it('handles arXiv PDF URL format', () => {
      const bibtex = paperToBibtex({
        title: 'Test',
        sourceUrl: 'https://arxiv.org/pdf/2504.16054',
      });
      expect(bibtex).toContain('  eprint = {2504.16054}');
      expect(bibtex).toContain('  archiveprefix = {arXiv}');
    });
  });

  describe('papersToBibtexFile', () => {
    it('concatenates multiple entries with double newlines', () => {
      const papers = [
        { title: 'Paper One', authors: ['Alice'] },
        { title: 'Paper Two', authors: ['Bob'] },
      ];
      const content = papersToBibtexFile(papers);
      const entries = content.split('\n\n');
      expect(entries).toHaveLength(2);
      expect(entries[0]).toContain('@article{');
      expect(entries[1]).toContain('@article{');
    });

    it('returns empty string for empty array', () => {
      expect(papersToBibtexFile([])).toBe('');
    });

    it('works with single paper', () => {
      const content = papersToBibtexFile([fullPaper]);
      expect(content).toBe(paperToBibtex(fullPaper));
    });
  });
});
