/**
 * BibTeX generation utilities for exporting paper citations.
 */

export interface BibtexPaperInput {
  title: string;
  authors?: string[];
  submittedAt?: string | null;
  sourceUrl?: string | null;
  shortId?: string;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'not',
  'no',
  'nor',
  'so',
  'yet',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'than',
  'too',
  'very',
  'just',
  'about',
  'above',
  'after',
  'again',
  'all',
  'also',
  'any',
  'as',
  'how',
  'its',
  'into',
  'if',
  'it',
  'that',
  'then',
  'there',
  'these',
  'this',
  'through',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
]);

/**
 * Escape special LaTeX characters in a string.
 */
function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

/**
 * Extract last name from an author string.
 * Handles "First Last", "First Middle Last", etc.
 */
function extractLastName(author: string): string {
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1] ?? 'unknown';
}

/**
 * Extract arXiv ID from a URL.
 */
function extractArxivIdFromUrl(url: string): string | null {
  const match = url.match(/arxiv\.org\/(?:abs|pdf)\/([^/?]+?)(?:\.pdf)?$/);
  if (match) return match[1].replace(/v\d+$/, '');
  return null;
}

/**
 * Generate a BibTeX citation key: {firstAuthorLastName}{year}{firstMeaningfulTitleWord}
 */
export function generateBibtexKey(paper: BibtexPaperInput): string {
  // First author last name
  const lastName =
    paper.authors && paper.authors.length > 0
      ? extractLastName(paper.authors[0])
          .toLowerCase()
          .replace(/[^a-z]/g, '')
      : 'unknown';

  // Year
  const year = paper.submittedAt ? new Date(paper.submittedAt).getFullYear().toString() : 'nd';

  // First meaningful word from title
  const titleWords = paper.title
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  const firstWord = titleWords[0] ?? 'untitled';

  return `${lastName}${year}${firstWord}`;
}

/**
 * Generate a BibTeX entry for a single paper.
 */
export function paperToBibtex(paper: BibtexPaperInput): string {
  const key = generateBibtexKey(paper);
  const fields: string[] = [];

  fields.push(`  title = {${escapeLatex(paper.title)}}`);

  if (paper.authors && paper.authors.length > 0) {
    fields.push(`  author = {${paper.authors.map(escapeLatex).join(' and ')}}`);
  }

  const year = paper.submittedAt ? new Date(paper.submittedAt).getFullYear().toString() : undefined;
  if (year) {
    fields.push(`  year = {${year}}`);
  }

  if (paper.sourceUrl) {
    fields.push(`  url = {${paper.sourceUrl}}`);

    const arxivId = extractArxivIdFromUrl(paper.sourceUrl);
    if (arxivId) {
      fields.push(`  eprint = {${arxivId}}`);
      fields.push(`  archiveprefix = {arXiv}`);
    }
  }

  return `@article{${key},\n${fields.join(',\n')},\n}`;
}

/**
 * Generate a BibTeX file content from multiple papers.
 */
export function papersToBibtexFile(papers: BibtexPaperInput[]): string {
  return papers.map(paperToBibtex).join('\n\n');
}
