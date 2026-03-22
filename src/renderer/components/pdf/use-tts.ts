import { useState, useCallback, useRef, useEffect } from 'react';
import { ipc } from '../../hooks/use-ipc';
import i18n from 'i18next';

export type TtsStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface TtsVoice {
  name: string;
  shortName: string;
  locale: string;
  gender: string;
}

export interface SubtitleWord {
  part: string;
  start: number;
  end: number;
}

export interface UseTtsOptions {
  getPageText: (page: number) => Promise<string>;
  numPages: number;
  onPageChange?: (page: number) => void;
}

export interface UseTtsReturn {
  status: TtsStatus;
  voice: string;
  voices: TtsVoice[];
  rate: string;
  readingPage: number;
  currentText: string;
  subtitles: SubtitleWord[];
  activeWordIndex: number;
  /** The word/phrase currently being spoken — for PDF text layer highlighting */
  spokenContext: string;
  /** Start reading from a given page. If startText is provided, skip to that text's position. */
  speakFromPage: (startPage: number, startText?: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  setVoice: (voice: string) => void;
  setRate: (rate: string) => void;
}

const RATE_OPTIONS = ['-50%', '-25%', '+0%', '+25%', '+50%', '+100%'];

// ─── PDF text normalization ─────────────────────────────────────────────────

function normalizePdfText(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  const paragraphs = text.split(/\n\n+/);
  const cleaned = paragraphs.map((para) =>
    para.split('\n').reduce((acc, line) => {
      const trimmed = line.trim();
      if (!trimmed) return acc;
      if (acc.length === 0) return trimmed;
      if (acc.endsWith('-')) return acc.slice(0, -1) + trimmed;
      return acc + ' ' + trimmed;
    }, ''),
  );

  let result = cleaned.filter((p) => p.length > 0).join('\n\n');

  // Remove inline citation markers: [1], [2,3], [1-5], [1, 2, 3], (1), (Smith et al., 2020), etc.
  result = result.replace(/\[\d[\d,\s–—-]*\]/g, ''); // [1], [2, 3], [1-5]
  result = result.replace(/\(\d[\d,\s–—-]*\)/g, ''); // (1), (2, 3)
  // Remove superscript-style refs that appear as standalone numbers after words: "method1,2"
  // But be careful not to remove real numbers like "Figure 1"

  // Collapse leftover double spaces
  result = result.replace(/ {2,}/g, ' ');

  return result;
}

/**
 * Remove non-article noise commonly found in academic PDFs:
 * headers, footers, page numbers, emails, URLs, copyright, reference markers, etc.
 */
function cleanAcademicNoise(text: string): string {
  const lines = text.split('\n');
  const cleaned = lines.filter((line) => {
    const t = line.trim();
    if (!t) return true; // keep blank lines (paragraph separators)

    // Pure page numbers
    if (/^\d{1,4}$/.test(t)) return false;

    // "Page X of Y" or "X / Y"
    if (/^page\s+\d+/i.test(t)) return false;
    if (/^\d+\s*\/\s*\d+$/.test(t)) return false;

    // Email addresses standing alone
    if (/^[\w.+-]+@[\w.-]+\.\w+$/.test(t)) return false;

    // URLs standing alone
    if (/^https?:\/\/\S+$/.test(t)) return false;

    // arXiv IDs
    if (/^arxiv:\s*\d{4}\.\d+/i.test(t)) return false;

    // DOI lines
    if (/^(doi|https?:\/\/doi\.org)/i.test(t)) return false;

    // Copyright/license lines
    if (/^(©|\(c\)|copyright|licensed under|permission to make)/i.test(t)) return false;

    // Conference/journal running headers (short, all-caps or typical patterns)
    if (
      t.length < 80 &&
      /^(proceedings of|published in|accepted at|appear(s|ed) in|preprint)/i.test(t)
    )
      return false;

    // Lines that are mostly numbers/symbols (tables, formulas rendered as text)
    const alphaRatio = t.replace(/[^a-zA-Z\u4e00-\u9fff]/g, '').length / t.length;
    if (t.length > 5 && alphaRatio < 0.3) return false;

    // Isolated reference markers like "[1]", "[2, 3]", "[1–5]"
    if (/^\[\d[\d,\s–-]*\]\.?$/.test(t)) return false;

    return true;
  });

  return cleaned.join('\n');
}

function splitIntoChunks(text: string, maxLen = 500): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitIdx = -1;
    const paraBreak = remaining.lastIndexOf('\n\n', maxLen);
    if (paraBreak > 50) splitIdx = paraBreak + 2;

    if (splitIdx <= 0) {
      for (const ender of ['. ', '。', '! ', '！', '? ', '？', '; ']) {
        const idx = remaining.lastIndexOf(ender, maxLen);
        if (idx > 0 && idx > splitIdx) splitIdx = idx + ender.length;
      }
    }

    if (splitIdx <= 0) splitIdx = remaining.lastIndexOf(' ', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;

    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Extract a context window of ~3 subtitle words around the active index.
 * This gives us a phrase to search for in the PDF text layer.
 */
function getSpokenContext(subs: SubtitleWord[], activeIdx: number): string {
  if (!subs.length || activeIdx < 0) return '';
  const start = Math.max(0, activeIdx - 1);
  const end = Math.min(subs.length, activeIdx + 3);
  return subs
    .slice(start, end)
    .map((w) => w.part)
    .join('')
    .trim();
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useTts(options: UseTtsOptions): UseTtsReturn {
  const [status, setStatus] = useState<TtsStatus>('idle');
  const [voice, setVoice] = useState('');
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [rate, setRate] = useState('+0%');
  const [readingPage, setReadingPage] = useState(0);
  const [currentText, setCurrentText] = useState('');
  const [subtitles, setSubtitles] = useState<SubtitleWord[]>([]);
  const [activeWordIndex, setActiveWordIndex] = useState(-1);
  const [spokenContext, setSpokenContext] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<string[]>([]);
  const chunkIndexRef = useRef(0);
  const stoppedRef = useRef(true);
  const sessionIdRef = useRef(0); // incremented on each speakFromPage to cancel stale callbacks
  const voiceRef = useRef(voice);
  const rateRef = useRef(rate);
  const currentPageRef = useRef(0);
  const numPagesRef = useRef(options.numPages);
  const getPageTextRef = useRef(options.getPageText);
  const onPageChangeRef = useRef(options.onPageChange);
  const subtitlesRef = useRef<SubtitleWord[]>([]);
  const rafRef = useRef<number>(0);

  voiceRef.current = voice;
  rateRef.current = rate;
  numPagesRef.current = options.numPages;
  getPageTextRef.current = options.getPageText;
  onPageChangeRef.current = options.onPageChange;

  useEffect(() => {
    ipc.ttsVoices().then((v) => setVoices(v));
    ipc.ttsDefaultVoice(i18n.language).then((r) => setVoice(r.voice));
  }, []);

  const startWordTracking = useCallback(() => {
    const tick = () => {
      const audio = audioRef.current;
      const subs = subtitlesRef.current;
      if (!audio || subs.length === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const timeMs = audio.currentTime * 1000;
      let wordIdx = -1;
      for (let i = 0; i < subs.length; i++) {
        if (timeMs >= subs[i].start && timeMs < subs[i].end) {
          wordIdx = i;
          break;
        }
        if (timeMs >= subs[i].start) {
          wordIdx = i;
        }
      }
      setActiveWordIndex(wordIdx);
      setSpokenContext(getSpokenContext(subs, wordIdx));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopWordTracking = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  /** Check if the current session is still valid */
  const isStale = (sid: number) => stoppedRef.current || sid !== sessionIdRef.current;

  const startPage = useCallback(async (page: number, sid: number, skipToText?: string) => {
    if (isStale(sid)) return;
    if (page > numPagesRef.current) {
      stoppedRef.current = true;
      setStatus('idle');
      setReadingPage(0);
      setCurrentText('');
      setSubtitles([]);
      setActiveWordIndex(-1);
      setSpokenContext('');
      return;
    }

    currentPageRef.current = page;
    setReadingPage(page);
    onPageChangeRef.current?.(page);

    setStatus('loading');
    try {
      const rawText = await getPageTextRef.current(page);
      if (isStale(sid)) return;

      let normalized = normalizePdfText(cleanAcademicNoise(rawText));
      if (!normalized.trim()) {
        startPage(page + 1, sid);
        return;
      }

      // If skipToText is given, find it and start reading from that exact position
      if (skipToText) {
        const needle = skipToText.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 60);
        const pos = normalized.toLowerCase().indexOf(needle);
        if (pos > 0) {
          normalized = normalized.slice(pos);
        }
      }

      chunksRef.current = splitIntoChunks(normalized);
      chunkIndexRef.current = 0;
      playNextChunk(sid);
    } catch {
      if (isStale(sid)) return;
      startPage(page + 1, sid);
    }
  }, []);

  const playNextChunk = useCallback(
    async (sid: number) => {
      if (isStale(sid)) return;

      const idx = chunkIndexRef.current;
      const chunks = chunksRef.current;

      if (idx >= chunks.length) {
        startPage(currentPageRef.current + 1, sid);
        return;
      }

      if (idx === 0) setStatus('loading');

      try {
        const result = await ipc.ttsSynthesize({
          text: chunks[idx],
          voice: voiceRef.current || undefined,
          rate: rateRef.current,
        });

        if (isStale(sid)) return;

        setCurrentText(chunks[idx]);
        setSubtitles(result.subtitles);
        subtitlesRef.current = result.subtitles;
        setActiveWordIndex(-1);
        setSpokenContext('');

        const audio = new Audio(result.audioDataUrl);
        audioRef.current = audio;

        audio.onended = () => {
          if (isStale(sid)) return;
          stopWordTracking();
          chunkIndexRef.current += 1;
          playNextChunk(sid);
        };
        audio.onerror = () => {
          if (isStale(sid)) return;
          stopWordTracking();
          chunkIndexRef.current += 1;
          playNextChunk(sid);
        };

        await audio.play();
        if (isStale(sid)) {
          audio.pause();
          return;
        }
        setStatus('playing');
        startWordTracking();

        // Pre-synthesize next chunk
        if (idx + 1 < chunks.length) {
          ipc
            .ttsSynthesize({
              text: chunks[idx + 1],
              voice: voiceRef.current || undefined,
              rate: rateRef.current,
            })
            .catch(() => {});
        }
      } catch {
        if (isStale(sid)) return;
        setStatus('idle');
      }
    },
    [startPage, startWordTracking, stopWordTracking],
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    sessionIdRef.current += 1; // invalidate all pending async callbacks
    stopWordTracking();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    chunksRef.current = [];
    chunkIndexRef.current = 0;
    subtitlesRef.current = [];
    ipc.ttsStop();
    setStatus('idle');
    setReadingPage(0);
    setCurrentText('');
    setSubtitles([]);
    setActiveWordIndex(-1);
    setSpokenContext('');
  }, [stopWordTracking]);

  const speakFromPage = useCallback(
    (startPageNum: number, startText?: string) => {
      stop();
      sessionIdRef.current += 1;
      const sid = sessionIdRef.current;
      stoppedRef.current = false;
      startPage(startPageNum, sid, startText);
    },
    [stop, startPage],
  );

  const pause = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      stopWordTracking();
      setStatus('paused');
    }
  }, [stopWordTracking]);

  const resume = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.play();
      startWordTracking();
      setStatus('playing');
    }
  }, [startWordTracking]);

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      stopWordTracking();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, [stopWordTracking]);

  return {
    status,
    voice,
    voices,
    rate,
    readingPage,
    currentText,
    subtitles,
    activeWordIndex,
    spokenContext,
    speakFromPage,
    pause,
    resume,
    stop,
    setVoice,
    setRate,
  };
}

export { RATE_OPTIONS };
