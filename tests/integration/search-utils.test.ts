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
      tagNames: ['nlp', 'retrieval'],
      abstract: 'We improve semantic retrieval over paper collections.',
    },
    {
      id: '2',
      title: 'Vision Benchmarks for Image Understanding',
      tagNames: ['cv'],
      abstract: 'Benchmarks for image classification and detection.',
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
});
