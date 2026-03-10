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
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { ipc, type PaperItem } from '../hooks/use-ipc';
import { useToast } from './toast';
import type { RecommendationItem } from '@shared';

type RecommendationFeedbackState = {
  moreLikeThis?: boolean;
  fewerLikeThis?: boolean;
};

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.getFullYear();
}

export function DashboardRecommendations() {
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<RecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [feedbackStateByCandidateId, setFeedbackStateByCandidateId] = useState<
    Record<string, RecommendationFeedbackState>
  >({});

  const loadRecommendations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await ipc.listRecommendations({ status: 'new' });
      setItems(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to load recommendations: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await ipc.refreshRecommendations(20);
      toast.success(`Generated ${result.count} recommendations`);
      setFeedbackStateByCandidateId({});
      await loadRecommendations();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`Failed to refresh recommendations: ${message}`);
    } finally {
      setRefreshing(false);
    }
  }, [loadRecommendations, toast]);

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

  const handleMoreLikeThis = useCallback(
    async (candidateId: string) => {
      setBusyCandidateId(candidateId);
      try {
        await ipc.moreLikeRecommendation(candidateId);
        setFeedbackStateByCandidateId((prev) => ({
          ...prev,
          [candidateId]: { ...prev[candidateId], moreLikeThis: true },
        }));
        toast.success('We will surface more papers like this');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to record recommendation preference: ${message}`);
      } finally {
        setBusyCandidateId(null);
      }
    },
    [toast],
  );

  const handleLessLikeThis = useCallback(
    async (candidateId: string) => {
      setBusyCandidateId(candidateId);
      try {
        await ipc.lessLikeRecommendation(candidateId);
        setFeedbackStateByCandidateId((prev) => ({
          ...prev,
          [candidateId]: { ...prev[candidateId], fewerLikeThis: true },
        }));
        setItems((prev) => prev.filter((item) => item.candidateId !== candidateId));
        toast.success('We will show fewer papers like this');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to record recommendation preference: ${message}`);
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

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={20} className="text-notion-accent" />
          <h2 className="text-xl font-semibold text-notion-text">Recommendations</h2>
          {!loading && items.length > 0 && (
            <span className="rounded-full bg-notion-accent-light px-2 py-0.5 text-xs font-medium text-notion-accent">
              {items.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {latestGeneratedAt && (
            <span className="text-xs text-notion-text-tertiary">
              {new Date(latestGeneratedAt).toLocaleString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border bg-white px-3 py-1.5 text-sm font-medium text-notion-text transition-colors hover:bg-notion-accent-light hover:border-notion-accent/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-[120px] items-center justify-center text-notion-text-secondary">
          <Loader2 size={18} className="mr-2 animate-spin" /> Loading recommendations...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-notion-border bg-white px-6 py-10 text-center shadow-notion">
          <Sparkles size={28} className="mx-auto mb-3 text-notion-accent opacity-70" />
          <p className="text-sm font-medium text-notion-text">No fresh recommendations yet.</p>
          <p className="mt-1 text-sm text-notion-text-secondary">
            Use refresh to pull papers from Semantic Scholar and arXiv.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const year = formatDate(item.publishedAt);
            const isBusy = busyCandidateId === item.candidateId;
            const feedbackState = feedbackStateByCandidateId[item.candidateId];
            const hasMoreLikeThis = !!feedbackState?.moreLikeThis;
            const hasFewerLikeThis = !!feedbackState?.fewerLikeThis || item.status === 'ignored';

            return (
              <div
                key={item.candidateId}
                className="group rounded-lg border border-notion-border bg-white p-4 shadow-notion transition-colors duration-150 hover:border-notion-accent/30 hover:bg-notion-accent-light"
              >
                <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-notion-accent-light px-2 py-0.5 text-xs font-medium text-notion-accent">
                        {item.source === 'semantic_scholar' ? 'Semantic Scholar' : 'arXiv'}
                      </span>
                      {year && (
                        <span className="rounded-full bg-notion-sidebar px-2 py-0.5 text-xs text-notion-text-secondary">
                          {year}
                        </span>
                      )}
                      {item.venue && (
                        <span className="rounded-full bg-notion-sidebar px-2 py-0.5 text-xs text-notion-text-secondary">
                          {item.venue}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-notion-text">{item.title}</h3>
                    <p className="mt-0.5 text-xs text-notion-text-secondary">
                      {item.authors.length > 0 ? item.authors.join(', ') : 'Unknown authors'}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-notion-text-tertiary">
                    Score {Math.round(item.score * 100)}
                  </span>
                </div>

                {item.abstract && (
                  <p className="mb-2 line-clamp-2 text-xs leading-5 text-notion-text-secondary">
                    {item.abstract}
                  </p>
                )}

                <div className="mb-3 rounded border border-notion-accent/20 bg-notion-accent-light/70 px-2.5 py-1.5 text-xs text-notion-text">
                  <span className="font-medium text-notion-accent">Why: </span>
                  {item.reason}
                  {item.triggerPaperTitle && (
                    <span className="ml-1 text-notion-text-tertiary">
                      · Triggered by{' '}
                      {item.triggerPaperId ? (
                        <button
                          onClick={() => navigate(`/papers/${item.triggerPaperId}`)}
                          className="text-notion-accent hover:underline"
                        >
                          {item.triggerPaperTitle}
                        </button>
                      ) : (
                        item.triggerPaperTitle
                      )}
                    </span>
                  )}
                </div>

                {(hasMoreLikeThis || hasFewerLikeThis) && (
                  <div className="mb-2 flex flex-wrap gap-1.5 text-xs">
                    {hasMoreLikeThis && (
                      <span className="rounded-full border border-notion-accent/30 bg-notion-accent-light px-2 py-0.5 font-medium text-notion-accent">
                        Preference saved: more like this
                      </span>
                    )}
                    {hasFewerLikeThis && (
                      <span className="rounded-full border border-notion-border bg-notion-sidebar px-2 py-0.5 font-medium text-notion-text-secondary">
                        Preference saved: fewer like this
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => handleMoreLikeThis(item.candidateId)}
                    disabled={isBusy || hasMoreLikeThis}
                    className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      hasMoreLikeThis
                        ? 'border-notion-accent/30 bg-notion-accent-light font-medium text-notion-accent'
                        : 'border-notion-border bg-white text-notion-text-secondary hover:text-notion-text'
                    }`}
                  >
                    {isBusy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <ThumbsUp size={12} />
                    )}
                    {hasMoreLikeThis ? 'Recorded' : 'More like this'}
                  </button>
                  <button
                    onClick={() => handleLessLikeThis(item.candidateId)}
                    disabled={isBusy || hasFewerLikeThis}
                    className="inline-flex items-center gap-1 rounded-lg border border-notion-border bg-white px-2.5 py-1 text-xs text-notion-text-secondary transition-colors hover:text-notion-text disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <ThumbsDown size={12} />
                    )}
                    Fewer like this
                  </button>
                  <button
                    onClick={() => handleOpen(item)}
                    disabled={!item.sourceUrl && !item.pdfUrl}
                    className="inline-flex items-center gap-1 rounded-lg border border-notion-border bg-white px-2.5 py-1 text-xs text-notion-text transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ExternalLink size={12} /> Open
                  </button>
                  <button
                    onClick={() => handleIgnore(item.candidateId)}
                    disabled={isBusy}
                    className="inline-flex items-center gap-1 rounded-lg border border-notion-border bg-white px-2.5 py-1 text-xs text-notion-text-secondary transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />}
                    Ignore
                  </button>
                  <button
                    onClick={() => handleSave(item.candidateId)}
                    disabled={isBusy || item.status === 'saved'}
                    className="inline-flex items-center gap-1 rounded-lg border border-notion-accent/30 bg-white px-2.5 py-1 text-xs font-medium text-notion-accent transition-colors hover:bg-notion-accent-light disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isBusy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <LibraryBig size={12} />
                    )}
                    Save to Library
                  </button>
                  {item.pdfUrl && (
                    <button
                      onClick={() => handleOpen({ ...item, sourceUrl: item.pdfUrl })}
                      className="inline-flex items-center gap-1 rounded-lg border border-notion-border bg-white px-2.5 py-1 text-xs text-notion-text-secondary transition-colors hover:bg-white"
                    >
                      <FileText size={12} /> PDF
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
