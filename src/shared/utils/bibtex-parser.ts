import { parse as parseBibtex } from '@retorquere/bibtex-parser';

export interface ParsedPaperEntry {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  url?: string;
  abstract?: string;
  journal?: string;
}

/**
 * Parse a BibTeX string into structured paper entries.
 */
export function parseBibtexString(content: string): ParsedPaperEntry[] {
  const bib = parseBibtex(content, { sentenceCase: false });
  const results: ParsedPaperEntry[] = [];

  for (const entry of bib.entries) {
    const title = getField(entry.fields, 'title');
    if (!title) continue;

    const authors: string[] = [];
    if (entry.fields.author) {
      for (const creator of entry.fields.author) {
        if (creator.firstName && creator.lastName) {
          authors.push(`${creator.firstName} ${creator.lastName}`);
        } else if (creator.lastName) {
          authors.push(creator.lastName);
        } else if (creator.name) {
          authors.push(creator.name);
        }
      }
    }

    const yearStr = getField(entry.fields, 'year');
    const year = yearStr ? parseInt(yearStr, 10) : undefined;

    results.push({
      title,
      authors,
      year: year && !isNaN(year) ? year : undefined,
      doi: getField(entry.fields, 'doi'),
      url: getField(entry.fields, 'url'),
      abstract: getField(entry.fields, 'abstract'),
      journal: getField(entry.fields, 'journal') || getField(entry.fields, 'booktitle'),
    });
  }

  return results;
}

function getField(fields: Record<string, unknown>, name: string): string | undefined {
  const val = fields[name];
  if (!val) return undefined;
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) {
    // Some fields like title are arrays of text chunks
    const text = val
      .map((v) => {
        if (typeof v === 'string') return v;
        if (v && typeof v === 'object' && 'value' in v) return String(v.value);
        return String(v);
      })
      .join(' ')
      .trim();
    return text || undefined;
  }
  return String(val).trim();
}

/**
 * Parse an RIS format string into structured paper entries.
 * RIS format: each line starts with a two-letter tag, two spaces, dash, space, then value.
 * Records are separated by "ER  -" lines.
 */
export function parseRisString(content: string): ParsedPaperEntry[] {
  const results: ParsedPaperEntry[] = [];
  const lines = content.split(/\r?\n/);

  let current: Partial<ParsedPaperEntry & { authors: string[] }> | null = null;

  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)/);
    if (!match) continue;

    const [, tag, value] = match;
    const trimmed = value.trim();

    switch (tag) {
      case 'TY':
        current = { authors: [] };
        break;
      case 'TI':
      case 'T1':
        if (current) current.title = trimmed;
        break;
      case 'AU':
      case 'A1':
        if (current) current.authors!.push(trimmed);
        break;
      case 'PY':
      case 'Y1': {
        if (current) {
          const y = parseInt(trimmed.split('/')[0], 10);
          if (!isNaN(y)) current.year = y;
        }
        break;
      }
      case 'DO':
        if (current) current.doi = trimmed;
        break;
      case 'UR':
        if (current && !current.url) current.url = trimmed;
        break;
      case 'AB':
      case 'N2':
        if (current) current.abstract = trimmed;
        break;
      case 'JO':
      case 'JF':
      case 'T2':
        if (current && !current.journal) current.journal = trimmed;
        break;
      case 'ER':
        if (current?.title) {
          results.push({
            title: current.title,
            authors: current.authors ?? [],
            year: current.year,
            doi: current.doi,
            url: current.url,
            abstract: current.abstract,
            journal: current.journal,
          });
        }
        current = null;
        break;
    }
  }

  // Handle case where last entry has no ER tag
  if (current?.title) {
    results.push({
      title: current.title,
      authors: current.authors ?? [],
      year: current.year,
      doi: current.doi,
      url: current.url,
      abstract: current.abstract,
      journal: current.journal,
    });
  }

  return results;
}
