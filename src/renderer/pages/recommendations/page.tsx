import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  RefreshCcw,
  Sparkles,
  ExternalLink,
  Ban,
  LibraryBig,
  FileText,
} from 'lucide-react';
import { ipc, type PaperItem } from '../../hooks/use-ipc';
import { useToast } from '../../components/toast';
import type { RecommendationItem } from '@shared';

type RecommendationFilter = 'new' | 'ignored' | 'saved';

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear();
}

export function RecommendationsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<RecommendationItem[]>([]);
  const [filter, setFilter] = useState<RecommendationFilter>('new');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);

  const loadRecommendations = useCallback(
    async (status: RecommendationFilter) => {
      setLoading(true);
      try {
        const data = await ipc.listRecommendations({ status });
        setItems(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to load recommendations: ${message}`);
      } finally {
        setLoading(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    loadRecommendations(filter);
  }, [filter, loadRecommendations]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await ipc.refreshRecommendations(20);
      toast.success(`Generated ${result.count} recommendations`);
      await loadRecommendations(filter);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to refresh recommendations: ${message}`);
    } finally {
      setRefreshing(false);
    }
  }, [filter, loadRecommendations, toast]);

  const handleIgnore = useCallback(
    async (candidateId: string) => {
      setBusyCandidateId(candidateId);
      try {
        await ipc.ignoreRecommendation(candidateId);
        setItems((prev) => prev.filter((item) => item.candidateId !== candidateId));
        toast.success('Recommendation ignored');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to ignore recommendation: ${message}`);
      } finally {
        setBusyCandidateId(null);
      }
    },
    [toast],
  );

  const handleSave = useCallback(
    async (candidateId: string) => {
      setBusyCandidateId(candidateId);
      try {
        const paper: PaperItem = await ipc.saveRecommendation(candidateId);
        setItems((prev) => prev.filter((item) => item.candidateId !== candidateId));
        toast.success(`Saved to library: ${paper.title}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to save recommendation: ${message}`);
      } finally {
        setBusyCandidateId(null);
      }
    },
    [toast],
  );

  const handleOpen = useCallback(async (item: RecommendationItem) => {
    try {
      await ipc.trackRecommendationOpened(item.candidateId);
    } catch {
      // ignore analytics failure
    }
    const target = item.sourceUrl ?? item.pdfUrl;
    if (target) {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }, []);

  const latestGeneratedAt = useMemo(() => items[0]?.generatedAt ?? null, [items]);

  const filters: Array<{ id: RecommendationFilter; label: string }> = [
    { id: 'new', label: 'New' },
    { id: 'ignored', label: 'Ignored' },
    { id: 'saved', label: 'Saved' },
  ];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <Sparkles size={22} className="text-notion-accent" />
            <h1 className="text-2xl font-bold tracking-tight text-notion-text">Recommendations</h1>
          </div>
          <p className="text-sm text-notion-text-secondary">
            Discover papers outside your library, ranked from your reading history and tags.
          </p>
          <p className="mt-2 text-xs text-notion-text-tertiary">
            {latestGeneratedAt
              ? `Last refreshed: ${new Date(latestGeneratedAt).toLocaleString()}`
              : 'No recommendations generated yet.'}
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2 text-sm font-medium text-notion-text transition-colors hover:bg-notion-accent-light hover:border-notion-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
          Refresh recommendations
        </button>
      </div>

      <div className="flex gap-1">
        {filters.map((item) => (
          <button
            key={item.id}
            onClick={() => setFilter(item.id)}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              filter === item.id
                ? 'bg-notion-accent-light text-notion-accent font-medium border border-notion-accent/30'
                : 'text-notion-text-secondary hover:bg-notion-sidebar hover:text-notion-text border border-transparent'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex min-h-[280px] items-center justify-center text-notion-text-secondary">
          <Loader2 size={20} className="mr-2 animate-spin" /> Loading recommendations...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-notion-border bg-white px-6 py-12 text-center shadow-notion">
          <Sparkles size={32} className="mx-auto mb-3 text-notion-accent opacity-70" />
          <p className="text-sm font-medium text-notion-text">
            {filter === 'new' ? 'No fresh recommendations yet.' : `No ${filter} recommendations.`}
          </p>
          <p className="mt-2 text-sm text-notion-text-secondary">
            Use refresh to pull papers from Semantic Scholar and arXiv.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => {
            const year = formatDate(item.publishedAt);
            const isBusy = busyCandidateId === item.candidateId;
            return (
              <div
                key={item.candidateId}
                className="group rounded-lg border border-notion-border bg-white p-5 shadow-notion transition-colors duration-150 hover:border-notion-accent/30 hover:bg-notion-accent-light"
              >
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-notion-accent-light px-2.5 py-1 text-xs font-medium text-notion-accent">
                        {item.source === 'semantic_scholar' ? 'Semantic Scholar' : 'arXiv'}
                      </span>
                      <span className="rounded-full bg-notion-sidebar px-2.5 py-1 text-xs text-notion-text-secondary">
                        Outside your library
                      </span>
                      {year && (
                        <span className="rounded-full bg-notion-sidebar px-2.5 py-1 text-xs text-notion-text-secondary">
                          {year}
                        </span>
                      )}
                      {item.venue && (
                        <span className="rounded-full bg-notion-sidebar px-2.5 py-1 text-xs text-notion-text-secondary">
                          {item.venue}
                        </span>
                      )}
                    </div>
                    <h2 className="text-lg font-semibold text-notion-text">{item.title}</h2>
                    <p className="mt-1 text-sm text-notion-text-secondary">
                      {item.authors.length > 0 ? item.authors.join(', ') : 'Unknown authors'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-notion-text-tertiary">
                    <span>Score {Math.round(item.score * 100)}</span>
                    {typeof item.semanticScore === 'number' && (
                      <span>• Semantic {Math.round(item.semanticScore * 100)}</span>
                    )}
                    {typeof item.citationCount === 'number' && item.citationCount > 0 && (
                      <span>• {item.citationCount} citations</span>
                    )}
                  </div>
                </div>

                {item.abstract && (
                  <p className="mb-3 line-clamp-4 text-sm leading-6 text-notion-text-secondary">
                    {item.abstract}
                  </p>
                )}

                <div className="mb-4 rounded-lg border border-notion-accent/20 bg-notion-accent-light/70 px-3 py-2 text-sm text-notion-text">
                  <span className="font-medium text-notion-accent">Why this paper:</span>{' '}
                  {item.reason}
                  {item.triggerPaperTitle && (
                    <div className="mt-2 flex items-center gap-1.5 text-xs text-notion-text-secondary">
                      <span className="font-medium text-notion-text">Triggered by:</span>
                      {item.triggerPaperId ? (
                        <button
                          onClick={() => navigate(`/papers/${item.triggerPaperId}`)}
                          className="truncate text-left text-notion-accent hover:underline"
                        >
                          {item.triggerPaperTitle}
                        </button>
                      ) : (
                        <span className="truncate">{item.triggerPaperTitle}</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleOpen(item)}
                    disabled={!item.sourceUrl && !item.pdfUrl}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-sm text-notion-text transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ExternalLink size={14} /> Open
                  </button>
                  <button
                    onClick={() => handleIgnore(item.candidateId)}
                    disabled={isBusy || filter === 'saved'}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-sm text-notion-text-secondary transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}{' '}
                    Ignore
                  </button>
                  <button
                    onClick={() => handleSave(item.candidateId)}
                    disabled={isBusy || item.status === 'saved'}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-notion-accent/30 bg-white px-3 py-1.5 text-sm font-medium text-notion-accent transition-colors hover:bg-notion-accent-light disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <LibraryBig size={14} />
                    )}{' '}
                    Save to Library
                  </button>
                  {item.pdfUrl && (
                    <button
                      onClick={() => handleOpen({ ...item, sourceUrl: item.pdfUrl })}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-sm text-notion-text-secondary transition-colors hover:bg-white"
                    >
                      <FileText size={14} /> Open PDF
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
