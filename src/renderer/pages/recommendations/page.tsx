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
import { ipc, type PaperItem, type SemanticSearchSettings } from '../../hooks/use-ipc';
import { useToast } from '../../components/toast';
import type { RecommendationItem } from '@shared';

type RecommendationFilter = 'new' | 'ignored' | 'saved';
type ExplorationPreset = 'focused' | 'balanced' | 'exploratory';
type RecommendationFeedbackState = {
  moreLikeThis?: boolean;
  fewerLikeThis?: boolean;
};

const EXPLORATION_PRESETS: Array<{
  id: ExplorationPreset;
  label: string;
  value: number;
  description: string;
}> = [
  { id: 'focused', label: 'Focused', value: 0.1, description: 'Prefer tighter semantic matches.' },
  {
    id: 'balanced',
    label: 'Balanced',
    value: 0.35,
    description: 'Mix relevance with some novelty.',
  },
  {
    id: 'exploratory',
    label: 'Exploratory',
    value: 0.8,
    description: 'Surface more surprising papers.',
  },
];

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
  const [semanticSettings, setSemanticSettings] = useState<SemanticSearchSettings | null>(null);
  const [savingExploration, setSavingExploration] = useState(false);
  const [feedbackStateByCandidateId, setFeedbackStateByCandidateId] = useState<
    Record<string, RecommendationFeedbackState>
  >({});

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

  useEffect(() => {
    let cancelled = false;
    void ipc
      .getSemanticSearchSettings()
      .then((settings) => {
        if (!cancelled) setSemanticSettings(settings);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await ipc.refreshRecommendations(20);
      toast.success(`Generated ${result.count} recommendations`);
      setFeedbackStateByCandidateId({});
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
        setFeedbackStateByCandidateId((prev) => ({
          ...prev,
          [candidateId]: { ...prev[candidateId], fewerLikeThis: true },
        }));
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
        setItems((prev) =>
          filter === 'ignored' ? prev : prev.filter((item) => item.candidateId !== candidateId),
        );
        toast.success('We will show fewer papers like this');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to record recommendation preference: ${message}`);
      } finally {
        setBusyCandidateId(null);
      }
    },
    [filter, toast],
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
  const activeExplorationPreset = useMemo<ExplorationPreset>(() => {
    const value = semanticSettings?.recommendationExploration ?? 0.35;
    if (value <= 0.2) return 'focused';
    if (value >= 0.65) return 'exploratory';
    return 'balanced';
  }, [semanticSettings]);

  const handleExplorationChange = useCallback(
    async (preset: ExplorationPreset) => {
      const nextValue = EXPLORATION_PRESETS.find((item) => item.id === preset)?.value;
      if (typeof nextValue !== 'number' || savingExploration || !semanticSettings) return;

      const nextSettings = { ...semanticSettings, recommendationExploration: nextValue };
      setSavingExploration(true);
      setSemanticSettings(nextSettings);
      try {
        await ipc.setSemanticSearchSettings({ recommendationExploration: nextValue });
        toast.success(`Recommendation mode set to ${preset}`);
      } catch (error) {
        setSemanticSettings(semanticSettings);
        const message = error instanceof Error ? error.message : String(error);
        toast.error(`Failed to update recommendation mode: ${message}`);
      } finally {
        setSavingExploration(false);
      }
    },
    [savingExploration, semanticSettings, toast],
  );

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

      <div className="flex flex-col gap-3 rounded-lg border border-notion-border bg-white p-4 shadow-notion sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1">
          {filters.map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                filter === item.id
                  ? 'border border-notion-accent/30 bg-notion-accent-light font-medium text-notion-accent'
                  : 'border border-transparent text-notion-text-secondary hover:bg-notion-sidebar hover:text-notion-text'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2 sm:items-end">
          <div className="flex items-center gap-2 text-xs text-notion-text-secondary">
            <span className="font-medium text-notion-text">Recommendation mode</span>
            {savingExploration && <Loader2 size={12} className="animate-spin" />}
          </div>
          <div className="flex gap-1">
            {EXPLORATION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleExplorationChange(preset.id)}
                disabled={savingExploration || !semanticSettings}
                className={`rounded-lg px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  activeExplorationPreset === preset.id
                    ? 'border border-notion-accent/30 bg-notion-accent-light font-medium text-notion-accent'
                    : 'border border-notion-border bg-white text-notion-text-secondary hover:bg-notion-sidebar hover:text-notion-text'
                }`}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-notion-text-tertiary">
            {
              EXPLORATION_PRESETS.find((preset) => preset.id === activeExplorationPreset)
                ?.description
            }
          </p>
        </div>
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
            const feedbackState = feedbackStateByCandidateId[item.candidateId];
            const hasMoreLikeThis = !!feedbackState?.moreLikeThis;
            const hasFewerLikeThis = !!feedbackState?.fewerLikeThis || item.status === 'ignored';
            const canIgnore = item.status !== 'saved' && item.status !== 'ignored';
            const canMarkLessLikeThis = item.status !== 'saved' && !hasFewerLikeThis;
            const recommendationSignals = [
              item.triggerPaperTitle ? 'Matched one of your seed papers' : null,
              item.semanticScore >= 0.7 ? 'Strong semantic match' : null,
              item.semanticScore >= 0.35 && item.semanticScore < 0.7
                ? 'Moderate semantic match'
                : null,
              item.explorationNote ? 'Boosted for exploration' : null,
            ].filter(Boolean) as string[];

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
                  {recommendationSignals.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {recommendationSignals.map((signal) => (
                        <span
                          key={`${item.candidateId}-${signal}`}
                          className="rounded-full border border-notion-accent/20 bg-white px-2.5 py-1 text-[11px] font-medium text-notion-text-secondary"
                        >
                          {signal}
                        </span>
                      ))}
                    </div>
                  )}
                  {item.explorationNote && (
                    <div className="mt-2 text-xs text-notion-text-secondary">
                      {item.explorationNote}
                    </div>
                  )}
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

                {(hasMoreLikeThis || hasFewerLikeThis) && (
                  <div className="mb-3 flex flex-wrap gap-2 text-xs">
                    {hasMoreLikeThis && (
                      <span className="rounded-full border border-notion-accent/30 bg-notion-accent-light px-2.5 py-1 font-medium text-notion-accent">
                        Preference saved: more like this
                      </span>
                    )}
                    {hasFewerLikeThis && (
                      <span className="rounded-full border border-notion-border bg-notion-sidebar px-2.5 py-1 font-medium text-notion-text-secondary">
                        Preference saved: fewer like this
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleMoreLikeThis(item.candidateId)}
                    disabled={isBusy || hasMoreLikeThis}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      hasMoreLikeThis
                        ? 'border-notion-accent/30 bg-notion-accent-light font-medium text-notion-accent'
                        : 'border-notion-border bg-white text-notion-text-secondary hover:bg-white hover:text-notion-text'
                    }`}
                    title="Boost similar papers in future recommendations"
                  >
                    {isBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ThumbsUp size={14} />
                    )}
                    {hasMoreLikeThis ? 'Recorded' : 'More like this'}
                  </button>
                  <button
                    onClick={() => handleLessLikeThis(item.candidateId)}
                    disabled={isBusy || !canMarkLessLikeThis}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      hasFewerLikeThis
                        ? 'border-notion-border bg-notion-sidebar text-notion-text-secondary'
                        : 'border-notion-border bg-white text-notion-text-secondary hover:bg-white hover:text-notion-text'
                    }`}
                    title="Hide this paper and down-rank similar recommendations"
                  >
                    {isBusy ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ThumbsDown size={14} />
                    )}
                    {hasFewerLikeThis ? 'Recorded' : 'Fewer like this'}
                  </button>
                  <button
                    onClick={() => handleOpen(item)}
                    disabled={!item.sourceUrl && !item.pdfUrl}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-sm text-notion-text transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ExternalLink size={14} /> Open
                  </button>
                  <button
                    onClick={() => handleIgnore(item.candidateId)}
                    disabled={isBusy || !canIgnore}
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
