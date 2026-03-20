import { describe, it, expect } from 'vitest';
import { isDoi, extractDoiFromUrl } from '../../src/main/services/doi-resolver.service';

describe('DOI utilities', () => {
  describe('isDoi', () => {
    it('recognizes valid DOIs', () => {
      expect(isDoi('10.1038/s41586-021-03819-2')).toBe(true);
      expect(isDoi('10.1145/3292500.3330919')).toBe(true);
      expect(isDoi('10.48550/arXiv.2301.00001')).toBe(true);
    });

    it('rejects non-DOI strings', () => {
      expect(isDoi('2301.12345')).toBe(false);
      expect(isDoi('https://arxiv.org/abs/2301.12345')).toBe(false);
      expect(isDoi('not a doi')).toBe(false);
      expect(isDoi('')).toBe(false);
      expect(isDoi('10.abc')).toBe(false); // too few digits after 10.
    });

    it('handles whitespace', () => {
      expect(isDoi('  10.1038/s41586-021-03819-2  ')).toBe(true);
    });
  });

  describe('extractDoiFromUrl', () => {
    it('extracts DOI from doi.org URLs', () => {
      expect(extractDoiFromUrl('https://doi.org/10.1038/s41586-021-03819-2')).toBe(
        '10.1038/s41586-021-03819-2',
      );
    });

    it('extracts DOI from dx.doi.org URLs', () => {
      expect(extractDoiFromUrl('https://dx.doi.org/10.1145/3292500.3330919')).toBe(
        '10.1145/3292500.3330919',
      );
    });

    it('strips query params from DOI URLs', () => {
      const doi = extractDoiFromUrl('https://doi.org/10.1038/test?ref=pdf');
      expect(doi).toBe('10.1038/test');
    });

    it('returns null for non-DOI URLs', () => {
      expect(extractDoiFromUrl('https://arxiv.org/abs/2301.12345')).toBeNull();
      expect(extractDoiFromUrl('https://google.com')).toBeNull();
    });

    it('returns null for invalid URLs', () => {
      expect(extractDoiFromUrl('not a url')).toBeNull();
    });

    it('handles encoded DOI URLs', () => {
      const doi = extractDoiFromUrl('https://doi.org/10.1038%2Fs41586-021-03819-2');
      expect(doi).toBe('10.1038/s41586-021-03819-2');
    });
  });
});
