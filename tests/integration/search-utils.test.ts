import { describe, expect, it } from 'vitest';
import {
  filterNormalSearchResults,
  matchesNormalSearchQuery,
  tokenizeSearchQuery,
} from '../../src/shared/utils/search-match';

describe('search match utils', () => {
  const papers = [
    {
      id: '1',
      title: 'Transformers for Scientific Document Search',
      authors: ['John Smith', 'Alice Johnson'],
      tagNames: ['nlp', 'retrieval'],
      abstract: 'We improve semantic retrieval over paper collections.',
      venue: 'NeurIPS',
    },
    {
      id: '2',
      title: 'Vision Benchmarks for Image Understanding',
      authors: ['Bob Chen', 'Carol Williams'],
      tagNames: ['cv'],
      abstract: 'Benchmarks for image classification and detection.',
      venue: 'CVPR',
    },
  ];

  it('tokenizes search text by whitespace', () => {
    expect(tokenizeSearchQuery('  semantic   search ')).toEqual(['semantic', 'search']);
  });

  it('matches exact phrases and all-token queries', () => {
    expect(matchesNormalSearchQuery(papers[0], 'scientific document')).toBe(true);
    expect(matchesNormalSearchQuery(papers[0], 'semantic retrieval')).toBe(true);
    expect(matchesNormalSearchQuery(papers[0], 'semantic hello')).toBe(false);
  });

  it('filters out unrelated queries instead of returning fuzzy false positives', () => {
    expect(filterNormalSearchResults(papers, 'hello')).toEqual([]);
    expect(filterNormalSearchResults(papers, 'vision')).toEqual([papers[1]]);
  });

  it('matches by author name', () => {
    expect(matchesNormalSearchQuery(papers[0], 'John Smith')).toBe(true);
    expect(matchesNormalSearchQuery(papers[0], 'alice')).toBe(true);
    expect(matchesNormalSearchQuery(papers[1], 'Bob Chen')).toBe(true);
    expect(matchesNormalSearchQuery(papers[0], 'Bob')).toBe(false);
  });

  it('matches by venue/journal name', () => {
    expect(matchesNormalSearchQuery(papers[0], 'NeurIPS')).toBe(true);
    expect(matchesNormalSearchQuery(papers[1], 'CVPR')).toBe(true);
    expect(matchesNormalSearchQuery(papers[0], 'CVPR')).toBe(false);
  });

  it('matches by authorsJson fallback when authors array is not provided', () => {
    const paperWithJsonOnly = {
      title: 'Some Paper',
      authorsJson: '["Jane Doe","Mark Lee"]',
      tagNames: ['ml'],
      abstract: 'A paper about ML.',
    };
    expect(matchesNormalSearchQuery(paperWithJsonOnly, 'Jane Doe')).toBe(true);
    expect(matchesNormalSearchQuery(paperWithJsonOnly, 'mark')).toBe(true);
  });

  it('filters papers by author and venue', () => {
    expect(filterNormalSearchResults(papers, 'Johnson')).toEqual([papers[0]]);
    expect(filterNormalSearchResults(papers, 'CVPR')).toEqual([papers[1]]);
  });
});
