/**
 * Hook for AI summary streaming with background job recovery.
 *
 * Key behaviors:
 * - On mount, checks if a background job is already running/completed for this paperId
 * - Recovers accumulated text and status from the main process
 * - Does NOT auto-cancel on unmount — user can navigate away and come back
 * - Supports explicit cancel via returned `cancel` function
 * - Uses MessagePort for smooth chunk delivery + IPC fallback
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { ipc, onIpc, onStreamingPort } from './use-ipc';
import i18n from 'i18next';

interface AiSummaryStreamState {
  /** Whether generation is in progress */
  generating: boolean;
  /** Current phase: 'extracting' | 'generating' | '' */
  phase: string;
  /** Accumulated streaming content for display */
  streamingContent: string;
  /** Final completed summary (null while generating) */
  localAiSummary: string | null;
  /** Error message if generation failed */
  error: string | null;
}

interface AiSummaryStreamActions {
  /** Start generating AI summary */
  generate: () => void;
  /** Regenerate (delete cache + generate) */
  regenerate: () => void;
  /** Cancel a running generation */
  cancel: () => void;
}

export function useAiSummaryStream(
  paperId: string,
  shortId: string,
  title: string,
  abstract?: string,
  pdfUrl?: string,
  pdfPath?: string,
): [AiSummaryStreamState, AiSummaryStreamActions] {
  const [generating, setGenerating] = useState(false);
  const [phase, setPhase] = useState('');
  const [streamingContent, setStreamingContent] = useState('');
  const [localAiSummary, setLocalAiSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Ref-based chunk buffer for RAF batching
  const chunkBufferRef = useRef('');
  const rafRef = useRef(0);
  const paperIdRef = useRef(paperId);
  paperIdRef.current = paperId;

  // Helper to flush chunk buffer to state via requestAnimationFrame
  const scheduleFlush = useCallback(() => {
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        setStreamingContent(chunkBufferRef.current);
      });
    }
  }, []);

  // Reset state when paper changes
  useEffect(() => {
    setLocalAiSummary(null);
    setStreamingContent('');
    setGenerating(false);
    setPhase('');
    setError(null);
    chunkBufferRef.current = '';
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, [paperId]);

  // On mount (or paperId change): check for active background job and recover
  useEffect(() => {
    let cancelled = false;

    async function recover() {
      try {
        const status = await ipc.getAiSummaryStatus(paperId);
        if (cancelled || !status) return;

        if (status.status === 'running') {
          // Job is still running — recover accumulated text and re-attach streaming
          setGenerating(true);
          setPhase(status.phase);
          chunkBufferRef.current = status.accumulatedText;
          setStreamingContent(status.accumulatedText);
          // Re-attach MessagePort so new chunks flow to this renderer
          ipc.reattachAiSummaryPort(paperId);
        } else if (status.status === 'completed' && status.summary) {
          // Job completed while we were away
          setLocalAiSummary(status.summary);
        } else if (status.status === 'failed' && status.error) {
          setError(status.error);
        }
      } catch {
        // No active job, that's fine
      }

      // Also check for cached summary on disk
      if (!cancelled) {
        try {
          const cached = await ipc.getAiSummary(shortId);
          if (!cancelled && cached) {
            setLocalAiSummary(cached);
          }
        } catch {
          // ignore
        }
      }
    }

    recover();
    return () => {
      cancelled = true;
    };
  }, [paperId, shortId]);

  // Subscribe to IPC events + MessagePort streaming
  useEffect(() => {
    // MessagePort-based chunk streaming
    const unsubPort = onStreamingPort(
      paperId,
      (chunk: string) => {
        chunkBufferRef.current += chunk;
        scheduleFlush();
      },
      () => {
        // onDone from port — rely on IPC done event for final summary
      },
      (portError: string) => {
        console.error('[useAiSummaryStream] Port error:', portError);
      },
    );

    // Fallback: IPC-based chunks
    const unsubChunk = onIpc('papers:aiSummaryChunk', (...args: unknown[]) => {
      const data = args[1] as { paperId: string; chunk: string };
      if (data?.paperId !== paperIdRef.current) return;
      chunkBufferRef.current += data.chunk;
      scheduleFlush();
    });

    const unsubPhase = onIpc('papers:aiSummaryPhase', (...args: unknown[]) => {
      const data = args[1] as { paperId: string; phase: string };
      if (data?.paperId !== paperIdRef.current) return;
      setPhase(data.phase);
    });

    const unsubDone = onIpc('papers:aiSummaryDone', (...args: unknown[]) => {
      const data = args[1] as { paperId: string; summary: string };
      if (data?.paperId !== paperIdRef.current) return;
      // Cancel any pending RAF
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      chunkBufferRef.current = '';
      setLocalAiSummary(data.summary);
      setStreamingContent('');
      setGenerating(false);
      setError(null);
    });

    const unsubError = onIpc('papers:aiSummaryError', (...args: unknown[]) => {
      const data = args[1] as { paperId: string; error: string };
      if (data?.paperId !== paperIdRef.current) return;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      chunkBufferRef.current = '';
      setStreamingContent('');
      setGenerating(false);
      setError(data.error);
      console.error('[useAiSummaryStream] Generation failed:', data.error);
    });

    return () => {
      unsubPort();
      unsubChunk();
      unsubPhase();
      unsubDone();
      unsubError();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [paperId, scheduleFlush]);

  const generate = useCallback(() => {
    setGenerating(true);
    setStreamingContent('');
    setError(null);
    chunkBufferRef.current = '';
    setPhase('');
    ipc.startAiSummary({
      paperId,
      shortId,
      title,
      abstract,
      pdfUrl,
      pdfPath,
      language: i18n.language as 'en' | 'zh',
    });
  }, [paperId, shortId, title, abstract, pdfUrl, pdfPath]);

  const regenerate = useCallback(async () => {
    try {
      await ipc.deleteAiSummary(shortId);
    } catch {
      // ignore
    }
    generate();
  }, [shortId, generate]);

  const cancel = useCallback(() => {
    ipc.cancelAiSummary(paperId);
    setGenerating(false);
    setStreamingContent('');
    chunkBufferRef.current = '';
    setPhase('');
  }, [paperId]);

  return [
    { generating, phase, streamingContent, localAiSummary, error },
    { generate, regenerate, cancel },
  ];
}
