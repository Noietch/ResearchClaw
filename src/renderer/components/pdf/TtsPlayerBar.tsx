import { useState, useRef, useEffect } from 'react';
import { Play, Pause, Square, Volume2, ChevronDown, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TtsStatus, TtsVoice, SubtitleWord } from './use-tts';
import { RATE_OPTIONS } from './use-tts';

interface TtsPlayerBarProps {
  status: TtsStatus;
  voice: string;
  voices: TtsVoice[];
  rate: string;
  readingPage: number;
  numPages: number;
  currentText: string;
  subtitles: SubtitleWord[];
  activeWordIndex: number;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onSetVoice: (voice: string) => void;
  onSetRate: (rate: string) => void;
}

const RATE_LABELS: Record<string, string> = {
  '-50%': '0.5x',
  '-25%': '0.75x',
  '+0%': '1x',
  '+25%': '1.25x',
  '+50%': '1.5x',
  '+100%': '2x',
};

export function TtsPlayerBar({
  status,
  voice,
  voices,
  rate,
  readingPage,
  numPages,
  currentText,
  subtitles,
  activeWordIndex,
  onPause,
  onResume,
  onStop,
  onSetVoice,
  onSetRate,
}: TtsPlayerBarProps) {
  const { t } = useTranslation();
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [showRateMenu, setShowRateMenu] = useState(false);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const activeWordRef = useRef<HTMLSpanElement>(null);
  const safeSubtitles = subtitles ?? [];
  const safeVoices = voices ?? [];

  // Auto-scroll text container to keep active word visible
  useEffect(() => {
    if (activeWordRef.current && textContainerRef.current) {
      const container = textContainerRef.current;
      const word = activeWordRef.current;
      const wordLeft = word.offsetLeft;
      const wordWidth = word.offsetWidth;
      const containerWidth = container.clientWidth;
      const scrollLeft = container.scrollLeft;

      // Scroll so active word is roughly in the center
      if (wordLeft < scrollLeft || wordLeft + wordWidth > scrollLeft + containerWidth) {
        container.scrollTo({
          left: wordLeft - containerWidth / 3,
          behavior: 'smooth',
        });
      }
    }
  }, [activeWordIndex]);

  if (status === 'idle') return null;

  const currentVoice = safeVoices.find((v) => v.shortName === voice);
  const hasSubtitles = safeSubtitles.length > 0;

  return (
    <div className="flex flex-col border-b border-blue-100 bg-blue-50">
      {/* Controls row */}
      <div className="flex h-8 items-center justify-between px-3">
        {/* Left: controls + page indicator */}
        <div className="flex items-center gap-1.5">
          <Volume2 size={14} className="text-blue-600" />

          {status === 'loading' && (
            <>
              <Loader2 size={14} className="animate-spin text-blue-600" />
              <span className="text-xs text-blue-600">{t('reader.tts.loading')}</span>
            </>
          )}

          {status === 'playing' && (
            <button
              onClick={onPause}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-blue-500/10"
              title={t('reader.tts.pause')}
            >
              <Pause size={14} className="text-blue-600" />
            </button>
          )}

          {status === 'paused' && (
            <button
              onClick={onResume}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-blue-500/10"
              title={t('reader.tts.resume')}
            >
              <Play size={14} className="text-blue-600" />
            </button>
          )}

          {(status === 'playing' || status === 'paused') && (
            <button
              onClick={onStop}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-blue-500/10"
              title={t('reader.tts.stop')}
            >
              <Square size={12} className="text-blue-600" />
            </button>
          )}

          {readingPage > 0 && (
            <span className="ml-1 text-xs font-medium text-blue-600">
              {t('reader.tts.page', { current: readingPage, total: numPages })}
            </span>
          )}
        </div>

        {/* Right: voice + rate */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              onClick={() => {
                setShowVoiceMenu((v) => !v);
                setShowRateMenu(false);
              }}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-500/10"
            >
              <span className="max-w-[100px] truncate">
                {currentVoice?.name || voice || t('reader.tts.selectVoice')}
              </span>
              <ChevronDown size={10} />
            </button>
            {showVoiceMenu && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setShowVoiceMenu(false)} />
                <div className="absolute right-0 top-full z-[100] mt-1 max-h-60 w-56 overflow-y-auto rounded-lg border border-notion-border bg-white shadow-lg">
                  {safeVoices.map((v) => (
                    <button
                      key={v.shortName}
                      onClick={() => {
                        onSetVoice(v.shortName);
                        setShowVoiceMenu(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-notion-sidebar ${
                        v.shortName === voice ? 'bg-blue-50 text-blue-600' : 'text-notion-text'
                      }`}
                    >
                      <span>{v.name}</span>
                      <span className="text-notion-text-tertiary">{v.locale}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => {
                setShowRateMenu((v) => !v);
                setShowVoiceMenu(false);
              }}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-500/10"
            >
              <span>{RATE_LABELS[rate] || '1x'}</span>
              <ChevronDown size={10} />
            </button>
            {showRateMenu && (
              <>
                <div className="fixed inset-0 z-[99]" onClick={() => setShowRateMenu(false)} />
                <div className="absolute right-0 top-full z-[100] mt-1 w-24 overflow-y-auto rounded-lg border border-notion-border bg-white shadow-lg">
                  {RATE_OPTIONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => {
                        onSetRate(r);
                        setShowRateMenu(false);
                      }}
                      className={`flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-notion-sidebar ${
                        r === rate ? 'bg-blue-50 text-blue-600' : 'text-notion-text'
                      }`}
                    >
                      {RATE_LABELS[r]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Karaoke text row — shows current text with word-level highlighting */}
      {currentText && (status === 'playing' || status === 'paused') && (
        <div
          ref={textContainerRef}
          className="scrollbar-hide overflow-x-auto whitespace-nowrap border-t border-blue-400/10 px-3 py-1.5"
        >
          {hasSubtitles ? (
            <span className="text-xs leading-relaxed">
              {safeSubtitles.map((word, i) => (
                <span
                  key={i}
                  ref={i === activeWordIndex ? activeWordRef : undefined}
                  className={
                    i < activeWordIndex
                      ? 'text-notion-text-tertiary'
                      : i === activeWordIndex
                        ? 'rounded bg-blue-500/20 px-0.5 font-medium text-blue-600'
                        : 'text-notion-text-secondary'
                  }
                >
                  {word.part}
                </span>
              ))}
            </span>
          ) : (
            <span className="text-xs text-notion-text-secondary">{currentText}</span>
          )}
        </div>
      )}
    </div>
  );
}
