import { describe, expect, it } from 'vitest';
import {
  extractArxivId,
  getArxivPdfUrl,
  extractTextFromPdfUrl,
  extractFromArxiv,
  getPaperExcerpt,
} from '../../src/main/services/pdf-extractor.service';

describe('pdf-extractor service', () => {
  describe('extractArxivId', () => {
    it('extracts arxiv ID from abs URL', () => {
      const result = extractArxivId('https://arxiv.org/abs/2301.07041');
      expect(result).toBe('2301.07041');
    });

    it('extracts arxiv ID from pdf URL', () => {
      const result = extractArxivId('https://arxiv.org/pdf/2301.07041.pdf');
      expect(result).toBe('2301.07041');
    });

    it('extracts arxiv ID with version suffix', () => {
      const result = extractArxivId('https://arxiv.org/abs/2301.07041v2');
      expect(result).toBe('2301.07041');
    });

    it('extracts bare arxiv ID', () => {
      const result = extractArxivId('2301.07041');
      expect(result).toBe('2301.07041');
    });

    it('returns null for invalid input', () => {
      expect(extractArxivId('https://example.com/paper')).toBeNull();
      expect(extractArxivId('not-an-arxiv-id')).toBeNull();
    });
  });

  describe('getArxivPdfUrl', () => {
    it('generates correct PDF URL', () => {
      const result = getArxivPdfUrl('2301.07041');
      expect(result).toBe('https://arxiv.org/pdf/2301.07041');
    });
  });

  // Live tests - these require network access and may be slow/flaky
  // Run with: RUN_LIVE_TESTS=1 npm test
  describe('live PDF extraction', () => {
    // Use a well-known paper for testing
    const testArxivId = '1706.03762'; // Attention Is All You Need

    // Skip live tests if RUN_LIVE_TESTS is not set (network-dependent)
    const maybeIt = process.env.RUN_LIVE_TESTS ? it : it.skip;

    maybeIt('extracts text from arXiv PDF URL', { timeout: 120000 }, async () => {
      const result = await extractTextFromPdfUrl(getArxivPdfUrl(testArxivId), {
        maxPages: 2,
        maxChars: 2000,
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(100);
      expect(result.pageCount).toBeGreaterThan(0);
      // Should contain "attention" or similar key terms
      expect(result.text.toLowerCase()).toMatch(/attention|transformer/);
    });

    maybeIt('extracts from arXiv ID', { timeout: 120000 }, async () => {
      const result = await extractFromArxiv(testArxivId, {
        maxChars: 3000,
      });

      expect(result.text).toBeDefined();
      expect(result.text.length).toBeGreaterThan(100);
    });

    maybeIt('extracts from arXiv abs URL', { timeout: 120000 }, async () => {
      const result = await extractFromArxiv(`https://arxiv.org/abs/${testArxivId}`, {
        maxChars: 2000,
      });

      expect(result.text).toBeDefined();
    });

    maybeIt('getPaperExcerpt returns truncated text', { timeout: 120000 }, async () => {
      const excerpt = await getPaperExcerpt(testArxivId, 500);

      expect(excerpt.length).toBeLessThanOrEqual(520); // Allow for truncation marker
      expect(excerpt).toBeDefined();
    });
  });
});
