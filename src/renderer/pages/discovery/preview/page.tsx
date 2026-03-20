import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { ipc, type DiscoveredPaper } from '../../../hooks/use-ipc';
import { useTabs } from '../../../hooks/use-tabs';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  Loader2,
  FileSearch,
  Calendar,
  User,
  Tag,
  Sparkles,
} from 'lucide-react';
import clsx from 'clsx';
import { MarkdownContent } from '../../../components/markdown-content';

export function DiscoveryPreviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { openTab } = useTabs();

  const paper = (location.state as { paper?: DiscoveredPaper })?.paper;
  const [downloading, setDownloading] = useState(false);
  const [fetchingAlphaXiv, setFetchingAlphaXiv] = useState(false);
  const [alphaXivSummary, setAlphaXivSummary] = useState<string | null>(null);

  const handleBack = () => {
    navigate('/discovery');
  };

  const handleReadPdf = useCallback(async () => {
    if (!paper || downloading) return;

    // Check if paper already exists
    const existing = await ipc.getPaperByShortId(paper.arxivId);
    if (existing) {
      openTab(`/papers/${existing.shortId}/reader`, { from: '/discovery' });
      return;
    }

    setDownloading(true);
    try {
      const result = await ipc.downloadPaper(paper.arxivId, [], true);
      if (result && result.paper) {
        openTab(`/papers/${result.paper.shortId}/reader`, { from: '/discovery' });
      }
    } catch (e) {
      console.error('Failed to read PDF:', e);
    } finally {
      setDownloading(false);
    }
  }, [paper, downloading, openTab]);

  const handleImport = useCallback(async () => {
    if (!paper) return;

    try {
      await ipc.downloadPaper(paper.arxivId, [], false);
      // Return to Discovery after import
      navigate('/discovery');
    } catch (e) {
      console.error('Failed to import:', e);
    }
  }, [paper, navigate]);

  // Auto-fetch AlphaXiv summary when page loads (skip if already embedded in abstract)
  const hasEmbeddedSummary = paper?.abstract.includes('**AI-Generated Summary (AlphaXiv):**');
  useEffect(() => {
    if (!paper || hasEmbeddedSummary || alphaXivSummary) return;
    let cancelled = false;
    setFetchingAlphaXiv(true);
    ipc
      .getAlphaXivData(paper.arxivId)
      .then((summary) => {
        if (!cancelled && summary) setAlphaXivSummary(summary);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFetchingAlphaXiv(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paper?.arxivId]);

  if (!paper) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-notion-text-secondary">{t('discovery.noPaperData', 'No paper data')}</p>
      </div>
    );
  }

  // Extract AI summary from abstract if present
  const hasAlphaXivMarker = paper.abstract.includes('**AI-Generated Summary (AlphaXiv):**');
  let aiSummary = '';
  let originalAbstract = paper.abstract;

  if (hasAlphaXivMarker) {
    const abstractParts = paper.abstract.split('**Original Abstract:**');
    aiSummary = abstractParts[0]
      .replace('**AI-Generated Summary (AlphaXiv):**\n\n', '')
      .replace('\n\n---\n\n', '')
      .trim();
    originalAbstract = abstractParts[1]?.trim() || paper.abstract;
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center gap-3 border-b border-notion-border px-6 py-4">
        <button
          onClick={handleBack}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-notion-text line-clamp-2">{paper.title}</h1>
          <div className="flex items-center gap-2 text-xs text-notion-text-secondary mt-1">
            <span className="truncate">{paper.authors.slice(0, 3).join(', ')}</span>
            {paper.authors.length > 3 && <span>+{paper.authors.length - 3}</span>}
          </div>
        </div>
        <a
          href={paper.absUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-notion-text-secondary hover:bg-notion-sidebar hover:text-notion-accent"
        >
          <ExternalLink size={16} />
        </a>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Meta info */}
          <div className="flex flex-wrap items-center gap-4 text-sm text-notion-text-secondary">
            <div className="flex items-center gap-1.5">
              <Calendar size={14} />
              <span>{new Date(paper.publishedAt).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Tag size={14} />
              <span className="rounded bg-notion-sidebar px-1.5 py-0.5 text-xs">
                {paper.categories[0]}
              </span>
            </div>
          </div>

          {/* Scores */}
          {(paper.qualityScore ||
            (paper.relevanceScore !== null && paper.relevanceScore !== undefined)) && (
            <div className="flex flex-wrap gap-3">
              {paper.qualityScore && (
                <div
                  className={clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-2',
                    paper.qualityScore >= 8
                      ? 'bg-green-50 text-green-700'
                      : paper.qualityScore >= 6
                        ? 'bg-blue-50 text-blue-700'
                        : paper.qualityScore >= 4
                          ? 'bg-yellow-50 text-yellow-700'
                          : 'bg-red-50 text-red-700',
                  )}
                >
                  <span className="text-sm font-medium">
                    {t('discovery.qualityScore', 'Quality')}
                  </span>
                  <span className="text-lg font-bold">{paper.qualityScore}</span>
                </div>
              )}
              {paper.relevanceScore !== null && paper.relevanceScore !== undefined && (
                <div
                  className={clsx(
                    'flex items-center gap-2 rounded-lg px-3 py-2',
                    paper.relevanceScore >= 70
                      ? 'bg-green-50 text-green-700'
                      : paper.relevanceScore >= 40
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-gray-50 text-gray-700',
                  )}
                >
                  <span className="text-sm font-medium">
                    {t('discovery.relevanceScore', 'Relevance')}
                  </span>
                  <span className="text-lg font-bold">{paper.relevanceScore}%</span>
                </div>
              )}
              {paper.qualityRecommendation && (
                <span
                  className={clsx(
                    'rounded-lg px-3 py-2 text-sm font-medium',
                    paper.qualityRecommendation === 'must-read'
                      ? 'bg-green-100 text-green-700'
                      : paper.qualityRecommendation === 'worth-reading'
                        ? 'bg-blue-100 text-blue-700'
                        : paper.qualityRecommendation === 'skimmable'
                          ? 'bg-yellow-100 text-yellow-700'
                          : 'bg-gray-100 text-gray-600',
                  )}
                >
                  {t(`discovery.${paper.qualityRecommendation}`, paper.qualityRecommendation)}
                </span>
              )}
            </div>
          )}

          {/* AI Summary (from AlphaXiv) */}
          {(aiSummary || alphaXivSummary) && (
            <div className="rounded-xl border border-purple-100 bg-purple-50/30 p-4">
              <div className="flex items-center gap-2 text-purple-700 mb-2">
                <Sparkles size={16} />
                <span className="font-medium">
                  {t('discovery.aiSummary', 'AI Summary (AlphaXiv)')}
                </span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                <MarkdownContent content={alphaXivSummary || aiSummary} />
              </div>
            </div>
          )}

          {/* Loading indicator for AlphaXiv fetch */}
          {fetchingAlphaXiv && !aiSummary && !alphaXivSummary && (
            <div className="flex items-center gap-2 text-purple-500 text-sm">
              <Loader2 size={14} className="animate-spin" />
              {t('paper.alphaXivLoading', 'Loading AI summary...')}
            </div>
          )}

          {/* AI Evaluation Reason */}
          {paper.qualityReason && (
            <div className="rounded-lg border border-notion-border bg-notion-sidebar/50 p-4">
              <div className="text-xs font-medium text-notion-text-secondary uppercase mb-2">
                {t('discovery.aiEvaluation', 'AI Evaluation')}
              </div>
              <p className="text-sm text-notion-text leading-relaxed">{paper.qualityReason}</p>
            </div>
          )}

          {/* Quality Dimensions */}
          {paper.qualityDimensions && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(paper.qualityDimensions).map(([key, value]) => (
                <span
                  key={key}
                  className="flex items-center gap-1.5 rounded-lg bg-notion-sidebar px-3 py-1.5 text-sm"
                >
                  <span className="text-notion-text-tertiary">{t(`discovery.${key}`, key)}:</span>
                  <span className="font-medium text-notion-text">{value}</span>
                </span>
              ))}
            </div>
          )}

          {/* Original Abstract */}
          <div>
            <h2 className="text-sm font-medium text-notion-text mb-2">
              {t('discovery.abstract', 'Abstract')}
            </h2>
            <div className="text-sm text-notion-text-secondary leading-relaxed">
              <MarkdownContent content={originalAbstract} />
            </div>
          </div>

          {/* Authors */}
          <div>
            <h2 className="text-sm font-medium text-notion-text mb-2 flex items-center gap-1.5">
              <User size={14} />
              {t('discovery.authors', 'Authors')}
            </h2>
            <p className="text-sm text-notion-text-secondary">{paper.authors.join(', ')}</p>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex flex-shrink-0 items-center justify-end gap-3 border-t border-notion-border px-6 py-4">
        <button
          onClick={handleReadPdf}
          disabled={downloading}
          className={clsx(
            'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
            downloading
              ? 'cursor-wait border-notion-accent/50 bg-notion-accent-light text-notion-accent'
              : 'border-notion-border bg-white text-notion-text-secondary hover:bg-notion-sidebar',
          )}
        >
          {downloading ? <Loader2 size={16} className="animate-spin" /> : <FileSearch size={16} />}
          {downloading
            ? t('discovery.downloading', 'Downloading...')
            : t('discovery.readPdf', 'Read PDF')}
        </button>
        <button
          onClick={handleImport}
          className="flex items-center gap-2 rounded-lg bg-notion-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-notion-accent/90"
        >
          <Download size={16} />
          {t('discovery.import', 'Import to Library')}
        </button>
      </div>
    </div>
  );
}
