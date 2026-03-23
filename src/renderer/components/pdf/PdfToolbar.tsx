import { useState, useCallback, type KeyboardEvent } from 'react';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  ArrowLeftToLine,
  List,
  Search,
  Sun,
  Moon,
  Coffee,
  Undo2,
  BookOpen,
  Sparkles,
  Volume2,
} from 'lucide-react';
import type { FitMode } from './use-pdf-viewport';
import type { ReadingMode } from './PdfDocument';

interface PdfToolbarProps {
  currentPage: number;
  numPages: number;
  scale: number;
  fitMode: FitMode;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSetFitMode: (mode: FitMode) => void;
  onGoToPage: (page: number) => void;
  showOutline?: boolean;
  onToggleOutline?: () => void;
  showCitationSidebar?: boolean;
  onToggleCitationSidebar?: () => void;
  showAIOutline?: boolean;
  onToggleAIOutline?: () => void;
  showSearch?: boolean;
  onToggleSearch?: () => void;
  readingMode?: ReadingMode;
  onSetReadingMode?: (mode: ReadingMode) => void;
  canGoBack?: boolean;
  onGoBack?: () => void;
  ttsActive?: boolean;
  onToggleTts?: () => void;
}

const READING_MODE_ICONS: Record<ReadingMode, typeof Sun> = {
  light: Sun,
  sepia: Coffee,
  dark: Moon,
};

const READING_MODE_CYCLE: ReadingMode[] = ['light', 'sepia', 'dark'];

export function PdfToolbar({
  currentPage,
  numPages,
  scale,
  fitMode,
  onZoomIn,
  onZoomOut,
  onSetFitMode,
  onGoToPage,
  showOutline,
  onToggleOutline,
  showCitationSidebar,
  onToggleCitationSidebar,
  showAIOutline,
  onToggleAIOutline,
  showSearch,
  onToggleSearch,
  readingMode = 'light',
  onSetReadingMode,
  canGoBack,
  onGoBack,
  ttsActive,
  onToggleTts,
}: PdfToolbarProps) {
  const [pageInput, setPageInput] = useState('');
  const [editing, setEditing] = useState(false);

  const handlePageInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === 'Enter') {
        const num = parseInt(pageInput, 10);
        if (num >= 1 && num <= numPages) {
          onGoToPage(num);
        }
        setEditing(false);
        setPageInput('');
      } else if (e.key === 'Escape') {
        setEditing(false);
        setPageInput('');
      }
    },
    [pageInput, numPages, onGoToPage],
  );

  const zoomPercent = Math.round(scale * 100);

  const cycleReadingMode = useCallback(() => {
    if (!onSetReadingMode) return;
    const idx = READING_MODE_CYCLE.indexOf(readingMode);
    const next = READING_MODE_CYCLE[(idx + 1) % READING_MODE_CYCLE.length];
    onSetReadingMode(next);
  }, [readingMode, onSetReadingMode]);

  const ReadingModeIcon = READING_MODE_ICONS[readingMode];

  const progressPercent = numPages > 0 ? Math.round((currentPage / numPages) * 100) : 0;

  return (
    <div className="relative flex h-9 items-center justify-between border-b border-notion-border bg-white px-2">
      {/* Reading progress bar */}
      <div
        className="absolute bottom-0 left-0 h-[2px] bg-blue-500/60 transition-all duration-300"
        style={{ width: `${progressPercent}%` }}
      />
      {/* Left: outline + search toggles */}
      <div className="flex items-center gap-0.5">
        {onToggleOutline && (
          <button
            onClick={onToggleOutline}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              showOutline
                ? 'bg-blue-50 text-blue-600'
                : 'text-notion-text-secondary hover:bg-notion-sidebar'
            }`}
            title="Table of Contents"
          >
            <List size={14} />
          </button>
        )}
        {onToggleCitationSidebar && (
          <button
            onClick={onToggleCitationSidebar}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              showCitationSidebar
                ? 'bg-blue-50 text-blue-600'
                : 'text-notion-text-secondary hover:bg-notion-sidebar'
            }`}
            title="Citations"
          >
            <BookOpen size={14} />
          </button>
        )}
        {onToggleAIOutline && (
          <button
            onClick={onToggleAIOutline}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              showAIOutline
                ? 'bg-blue-50 text-blue-600'
                : 'text-notion-text-secondary hover:bg-notion-sidebar'
            }`}
            title="AI Outline"
          >
            <Sparkles size={14} />
          </button>
        )}
        {onToggleSearch && (
          <button
            onClick={onToggleSearch}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              showSearch
                ? 'bg-blue-50 text-blue-600'
                : 'text-notion-text-secondary hover:bg-notion-sidebar'
            }`}
            title="Search (Ctrl+F)"
          >
            <Search size={14} />
          </button>
        )}

        <div className="mx-1 h-4 w-px bg-notion-border" />

        {/* Page navigation */}
        {editing ? (
          <input
            type="text"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onKeyDown={handlePageInputKeyDown}
            onBlur={() => {
              setEditing(false);
              setPageInput('');
            }}
            autoFocus
            className="w-12 rounded border border-blue-400 px-1.5 py-0.5 text-center text-xs text-notion-text outline-none"
          />
        ) : (
          <button
            onClick={() => {
              setEditing(true);
              setPageInput(String(currentPage));
            }}
            className="rounded px-1.5 py-0.5 text-xs text-notion-text hover:bg-notion-sidebar"
          >
            {currentPage}
          </button>
        )}
        <span className="text-xs text-notion-text-tertiary">/ {numPages}</span>

        {canGoBack && onGoBack && (
          <>
            <div className="mx-1 h-4 w-px bg-notion-border" />
            <button
              onClick={onGoBack}
              className="flex h-6 items-center gap-1 rounded px-1.5 text-xs font-medium text-blue-600 hover:bg-blue-50"
              title="Go back"
            >
              <Undo2 size={12} />
              <span>Back</span>
            </button>
          </>
        )}
      </div>

      {/* Center: zoom controls */}
      <div className="flex items-center gap-1">
        <button
          onClick={onZoomOut}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-notion-sidebar"
          title="Zoom out (Ctrl+-)"
        >
          <ZoomOut size={14} className="text-notion-text-secondary" />
        </button>

        <span className="min-w-[3rem] text-center text-xs text-notion-text-secondary">
          {zoomPercent}%
        </span>

        <button
          onClick={onZoomIn}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-notion-sidebar"
          title="Zoom in (Ctrl+=)"
        >
          <ZoomIn size={14} className="text-notion-text-secondary" />
        </button>

        <div className="mx-1 h-4 w-px bg-notion-border" />

        <button
          onClick={() => onSetFitMode(fitMode === 'fit-width' ? 'fit-page' : 'fit-width')}
          className={`flex h-6 items-center gap-1 rounded px-1.5 text-xs transition-colors ${
            fitMode !== 'custom'
              ? 'bg-blue-50 text-blue-600'
              : 'text-notion-text-secondary hover:bg-notion-sidebar'
          }`}
          title={fitMode === 'fit-width' ? 'Fit page' : 'Fit width'}
        >
          {fitMode === 'fit-page' ? <Maximize size={12} /> : <ArrowLeftToLine size={12} />}
          <span>{fitMode === 'fit-page' ? 'Page' : 'Width'}</span>
        </button>
      </div>

      {/* Right: TTS + reading mode */}
      <div className="flex items-center gap-0.5">
        {onToggleTts && (
          <button
            onClick={onToggleTts}
            className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
              ttsActive
                ? 'bg-blue-50 text-blue-600'
                : 'text-notion-text-secondary hover:bg-notion-sidebar'
            }`}
            title="Read aloud"
          >
            <Volume2 size={14} />
          </button>
        )}
        {onSetReadingMode && (
          <button
            onClick={cycleReadingMode}
            className="flex h-6 w-6 items-center justify-center rounded text-notion-text-secondary hover:bg-notion-sidebar"
            title={`Reading mode: ${readingMode}`}
          >
            <ReadingModeIcon size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
