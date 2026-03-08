export interface SearchablePaperLike {
  title?: string | null;
  tagNames?: string[] | null;
  abstract?: string | null;
}

export function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function buildSearchHaystack(paper: SearchablePaperLike): string {
  return [paper.title ?? '', ...(paper.tagNames ?? []), paper.abstract ?? '']
    .join(' ')
    .toLowerCase();
}

export function matchesNormalSearchQuery(paper: SearchablePaperLike, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return false;

  const haystack = buildSearchHaystack(paper);
  if (!haystack) return false;

  if (haystack.includes(normalizedQuery)) {
    return true;
  }

  const tokens = tokenizeSearchQuery(query);
  if (tokens.length === 0) return false;

  return tokens.every((token) => haystack.includes(token));
}

export function filterNormalSearchResults<T extends SearchablePaperLike>(
  items: T[],
  query: string,
): T[] {
  return items.filter((item) => matchesNormalSearchQuery(item, query));
}
