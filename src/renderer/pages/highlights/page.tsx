import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ipc } from '../../hooks/use-ipc';
import { Search, Highlighter } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const COLORS = ['yellow', 'green', 'blue', 'pink', 'purple'] as const;

const COLOR_STYLES: Record<string, { dot: string; bg: string }> = {
  yellow: { dot: 'bg-yellow-400', bg: 'bg-yellow-50' },
  green: { dot: 'bg-green-400', bg: 'bg-green-50' },
  blue: { dot: 'bg-blue-400', bg: 'bg-blue-50' },
  pink: { dot: 'bg-pink-400', bg: 'bg-pink-50' },
  purple: { dot: 'bg-purple-400', bg: 'bg-purple-50' },
};

type HighlightResult = {
  id: string;
  paperId: string;
  pageNumber: number;
  rectsJson?: string;
  text: string;
  note: string | null;
  color: string;
  createdAt: string;
  paper: { id: string; shortId: string; title: string };
};

export function HighlightsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<HighlightResult[]>([]);
  const [loading, setLoading] = useState(true);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchHighlights = useCallback(async () => {
    setLoading(true);
    try {
      const results = await ipc.searchHighlights({
        query: debouncedQuery || undefined,
        color: colorFilter ?? undefined,
        limit: 200,
      });
      setHighlights(results);
    } catch (e) {
      console.error('[Highlights] search failed:', e);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, colorFilter]);

  useEffect(() => {
    fetchHighlights();
  }, [fetchHighlights]);

  // Group by paper
  const grouped = useMemo(() => {
    const map = new Map<string, { paper: HighlightResult['paper']; items: HighlightResult[] }>();
    for (const h of highlights) {
      const existing = map.get(h.paperId);
      if (existing) {
        existing.items.push(h);
      } else {
        map.set(h.paperId, { paper: h.paper, items: [h] });
      }
    }
    return Array.from(map.values());
  }, [highlights]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-notion-text">
          {t('highlights.title')}
        </h1>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('highlights.search')}
          className="w-full rounded-lg border border-notion-border bg-white py-2.5 pl-9 pr-3 text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
          }}
        />
      </div>

      {/* Color filter */}
      <div className="mb-5 flex items-center gap-1.5">
        <button
          onClick={() => setColorFilter(null)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            colorFilter === null
              ? 'bg-notion-text text-white'
              : 'text-notion-text-secondary hover:bg-notion-sidebar'
          }`}
        >
          {t('highlights.allColors')}
        </button>
        {COLORS.map((color) => {
          const style = COLOR_STYLES[color];
          return (
            <button
              key={color}
              onClick={() => setColorFilter(colorFilter === color ? null : color)}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                colorFilter === color
                  ? `${style.bg} text-notion-text`
                  : 'text-notion-text-secondary hover:bg-notion-sidebar'
              }`}
            >
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot}`} />
              {color}
            </button>
          );
        })}
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
        </div>
      ) : highlights.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Highlighter size={40} className="mb-3 text-notion-text-tertiary opacity-40" />
          <p className="text-sm text-notion-text-tertiary">{t('highlights.noResults')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(({ paper, items }) => (
            <div
              key={paper.id}
              className="rounded-xl border border-notion-border bg-white overflow-hidden"
            >
              {/* Paper header */}
              <button
                onClick={() =>
                  navigate(`/papers/${paper.shortId}`, { state: { from: '/highlights' } })
                }
                className="flex w-full items-center gap-2 border-b border-notion-border px-4 py-3 text-left transition-colors hover:bg-blue-50"
              >
                <span className="truncate text-sm font-semibold text-notion-text">
                  {paper.title}
                </span>
                <span className="flex-shrink-0 rounded-full bg-notion-sidebar px-2 py-0.5 text-xs text-notion-text-tertiary">
                  {items.length}
                </span>
              </button>

              {/* Highlights */}
              <div className="divide-y divide-notion-border">
                {items.map((h) => {
                  const style = COLOR_STYLES[h.color] ?? COLOR_STYLES.yellow;
                  return (
                    <button
                      key={h.id}
                      onClick={() => {
                        // Extract y-offset from the first rect for precise scroll positioning
                        let pageYOffset: number | undefined;
                        try {
                          const rects = JSON.parse(h.rectsJson!) as Array<{ y: number }>;
                          if (rects.length > 0) pageYOffset = rects[0].y;
                        } catch {
                          // ignore
                        }
                        navigate(`/papers/${paper.shortId}`, {
                          state: {
                            from: '/highlights',
                            openReader: true,
                            initialPage: h.pageNumber,
                            initialPageYOffset: pageYOffset,
                          },
                        });
                      }}
                      className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50/60"
                    >
                      <span
                        className={`mt-1.5 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full ${style.dot}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-2 text-sm text-notion-text">{h.text}</p>
                        {h.note && (
                          <p className="mt-1 line-clamp-1 text-xs text-notion-text-tertiary italic">
                            {h.note}
                          </p>
                        )}
                      </div>
                      <span className="flex-shrink-0 text-xs text-notion-text-tertiary">
                        {t('highlights.page', { page: h.pageNumber })}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
