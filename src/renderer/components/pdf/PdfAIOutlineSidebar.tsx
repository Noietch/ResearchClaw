import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { Sparkles, ChevronDown, ChevronRight, RefreshCw, Loader2 } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';

interface PdfAIOutlineSidebarProps {
  paperId: string;
  shortId: string;
}

interface OutlineData {
  researchQuestions: string[];
  methodology: string;
  keyFindings: string[];
  contributions: string[];
  limitations: string[];
}

const SECTION_LABELS: Record<
  keyof OutlineData,
  {
    icon: string;
    i18nKey:
      | 'reader.ai.researchQuestions'
      | 'reader.ai.methodology'
      | 'reader.ai.keyFindings'
      | 'reader.ai.contributions'
      | 'reader.ai.limitations';
  }
> = {
  researchQuestions: { icon: '\u{1F4CB}', i18nKey: 'reader.ai.researchQuestions' },
  methodology: { icon: '\u{1F52C}', i18nKey: 'reader.ai.methodology' },
  keyFindings: { icon: '\u{1F4A1}', i18nKey: 'reader.ai.keyFindings' },
  contributions: { icon: '\u{1F3C6}', i18nKey: 'reader.ai.contributions' },
  limitations: { icon: '\u26A0\uFE0F', i18nKey: 'reader.ai.limitations' },
};

const SECTION_ORDER: (keyof OutlineData)[] = [
  'researchQuestions',
  'methodology',
  'keyFindings',
  'contributions',
  'limitations',
];

export function PdfAIOutlineSidebar({ paperId, shortId }: PdfAIOutlineSidebarProps) {
  const { t } = useTranslation();
  const [outline, setOutline] = useState<OutlineData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const generateOutline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await ipc.readerPaperOutline({
        paperId,
        shortId,
        language: i18n.language,
      });
      setOutline(result);
    } catch (err) {
      setError(t('reader.ai.outlineFailed'));
      console.error('Failed to generate outline:', err);
    } finally {
      setLoading(false);
    }
  }, [paperId, shortId, t]);

  const toggleSection = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const renderSectionContent = (key: keyof OutlineData) => {
    if (!outline) return null;
    const value = outline[key];

    if (key === 'methodology') {
      return (
        <p className="text-xs leading-relaxed text-notion-text pl-5 pr-2 pb-2">{value as string}</p>
      );
    }

    const items = value as string[];
    if (!items || items.length === 0) return null;

    return (
      <ul className="space-y-1 pl-5 pr-2 pb-2">
        {items.map((item, idx) => (
          <li key={idx} className="flex items-start gap-1.5">
            <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-notion-text-tertiary" />
            <span className="text-xs leading-relaxed text-notion-text">{item}</span>
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-notion-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Sparkles size={14} className="text-blue-600" />
          <span className="text-xs font-medium text-notion-text">{t('reader.ai.outline')}</span>
        </div>
        {outline && (
          <button
            onClick={generateOutline}
            disabled={loading}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-notion-sidebar-hover disabled:opacity-50"
            title={t('reader.ai.regenerate')}
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} className="text-notion-text-tertiary" />
            )}
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12">
            <Loader2 size={20} className="animate-spin text-blue-600" />
            <span className="text-xs text-notion-text-tertiary">{t('reader.ai.generating')}</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 p-4">
            <p className="text-xs text-red-500">{error}</p>
            <button
              onClick={generateOutline}
              className="rounded-md bg-blue-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500/90"
            >
              {t('reader.ai.regenerate')}
            </button>
          </div>
        ) : outline ? (
          <div className="py-1">
            {SECTION_ORDER.map((key) => {
              const value = outline[key];
              const isEmpty = Array.isArray(value) ? value.length === 0 : !value;
              if (isEmpty) return null;

              const { icon, i18nKey } = SECTION_LABELS[key];
              const isCollapsed = collapsed[key] ?? false;

              return (
                <div key={key} className="border-b border-notion-border last:border-b-0">
                  <button
                    onClick={() => toggleSection(key)}
                    className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-blue-50"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={12} className="flex-shrink-0 text-notion-text-tertiary" />
                    ) : (
                      <ChevronDown size={12} className="flex-shrink-0 text-notion-text-tertiary" />
                    )}
                    <span className="text-sm">{icon}</span>
                    <span className="text-xs font-medium text-notion-text">{t(i18nKey)}</span>
                  </button>
                  {!isCollapsed && renderSectionContent(key)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-12 px-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
              <Sparkles size={18} className="text-blue-600" />
            </div>
            <p className="text-xs text-notion-text-tertiary text-center">
              {t('reader.ai.generateOutline')}
            </p>
            <button
              onClick={generateOutline}
              className="rounded-md bg-blue-500 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500/90"
            >
              {t('reader.ai.generateOutline')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
