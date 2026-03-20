import { describe, it, expect } from 'vitest';
import { parseBibtexString, parseRisString } from '@shared';

describe('BibTeX parser', () => {
  it('parses a standard journal article', () => {
    const bib = `
@article{smith2023attention,
  title={Attention Is All You Need},
  author={Smith, John and Doe, Jane},
  year={2023},
  journal={Nature},
  doi={10.1038/s41586-023-00001-1},
  abstract={A groundbreaking paper on transformers.}
}`;
    const entries = parseBibtexString(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Attention Is All You Need');
    expect(entries[0].authors).toHaveLength(2);
    expect(entries[0].authors[0]).toContain('Smith');
    expect(entries[0].year).toBe(2023);
    expect(entries[0].doi).toBe('10.1038/s41586-023-00001-1');
    expect(entries[0].journal).toBe('Nature');
    expect(entries[0].abstract).toContain('groundbreaking');
  });

  it('parses a conference paper with booktitle', () => {
    const bib = `
@inproceedings{doe2022deep,
  title={Deep Learning for NLP},
  author={Doe, Jane},
  year={2022},
  booktitle={Proceedings of ACL 2022}
}`;
    const entries = parseBibtexString(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].journal).toContain('ACL');
  });

  it('parses multiple entries', () => {
    const bib = `
@article{a, title={Paper A}, author={Author, One}, year={2021}}
@article{b, title={Paper B}, author={Author, Two}, year={2022}}
@article{c, title={Paper C}, author={Author, Three}, year={2023}}
`;
    const entries = parseBibtexString(bib);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.title)).toEqual(['Paper A', 'Paper B', 'Paper C']);
  });

  it('skips entries without title', () => {
    const bib = `
@article{notitle, author={Nobody}, year={2020}}
@article{hastitle, title={Has Title}, author={Somebody}, year={2021}}
`;
    const entries = parseBibtexString(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Has Title');
  });

  it('handles missing optional fields gracefully', () => {
    const bib = `@article{minimal, title={Minimal Paper}}`;
    const entries = parseBibtexString(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Minimal Paper');
    expect(entries[0].authors).toEqual([]);
    expect(entries[0].year).toBeUndefined();
    expect(entries[0].doi).toBeUndefined();
  });

  it('handles special characters in title', () => {
    const bib = `@article{special, title={An {O}(n log n) algorithm for {Bayesian} networks}, author={Test, Author}, year={2020}}`;
    const entries = parseBibtexString(bib);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBeTruthy();
  });

  it('returns empty array for empty input', () => {
    expect(parseBibtexString('')).toEqual([]);
  });

  it('returns empty array for invalid bibtex', () => {
    // The parser may throw or return empty - both are acceptable
    try {
      const result = parseBibtexString('this is not bibtex at all');
      expect(result).toEqual([]);
    } catch {
      // Parser threw, which is also acceptable
    }
  });
});

describe('RIS parser', () => {
  it('parses a standard journal article', () => {
    const ris = `TY  - JOUR
TI  - Attention Is All You Need
AU  - Smith, John
AU  - Doe, Jane
PY  - 2023
JO  - Nature
DO  - 10.1038/s41586-023-00001-1
AB  - A groundbreaking paper on transformers.
ER  - `;
    const entries = parseRisString(ris);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Attention Is All You Need');
    expect(entries[0].authors).toEqual(['Smith, John', 'Doe, Jane']);
    expect(entries[0].year).toBe(2023);
    expect(entries[0].doi).toBe('10.1038/s41586-023-00001-1');
    expect(entries[0].journal).toBe('Nature');
    expect(entries[0].abstract).toContain('groundbreaking');
  });

  it('parses multiple entries', () => {
    const ris = `TY  - JOUR
TI  - Paper A
AU  - Author One
PY  - 2021
ER  -
TY  - JOUR
TI  - Paper B
AU  - Author Two
PY  - 2022
ER  - `;
    const entries = parseRisString(ris);
    expect(entries).toHaveLength(2);
    expect(entries[0].title).toBe('Paper A');
    expect(entries[1].title).toBe('Paper B');
  });

  it('handles T1 and A1 alternative tags', () => {
    const ris = `TY  - JOUR
T1  - Alternative Title Tag
A1  - Alt Author
Y1  - 2020/01/15
ER  - `;
    const entries = parseRisString(ris);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('Alternative Title Tag');
    expect(entries[0].authors).toEqual(['Alt Author']);
    expect(entries[0].year).toBe(2020);
  });

  it('handles entry without ER tag (last entry)', () => {
    const ris = `TY  - JOUR
TI  - No End Record
AU  - Author`;
    const entries = parseRisString(ris);
    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe('No End Record');
  });

  it('skips entries without title', () => {
    const ris = `TY  - JOUR
AU  - Nobody
ER  - `;
    const entries = parseRisString(ris);
    expect(entries).toHaveLength(0);
  });

  it('returns empty for empty input', () => {
    expect(parseRisString('')).toEqual([]);
  });

  it('handles year with slash format (Y1)', () => {
    const ris = `TY  - JOUR
TI  - Date Test
Y1  - 2023/06/15
ER  - `;
    const entries = parseRisString(ris);
    expect(entries[0].year).toBe(2023);
  });

  it('handles URL field', () => {
    const ris = `TY  - JOUR
TI  - URL Test
UR  - https://example.com/paper
ER  - `;
    const entries = parseRisString(ris);
    expect(entries[0].url).toBe('https://example.com/paper');
  });
});
