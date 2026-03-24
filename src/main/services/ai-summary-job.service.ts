/**
 * Background job service for AI summary generation.
 *
 * Follows the app's background job pattern (like AcpChatService):
 * - Jobs tracked in memory with status (running/completed/failed)
 * - Broadcasts progress to ALL windows via BrowserWindow.webContents.send()
 * - Supports getActiveStatus() for recovery when user navigates away and back
 * - User can cancel via explicit action; unmount does NOT kill the job
 */

import { BrowserWindow } from 'electron';
import {
  generateAiSummary,
  getCachedAiSummary,
  deleteCachedAiSummary,
} from './paper-summary.service';
import { createStreamingPort, type StreamingPort } from './streaming-port.service';

export interface AiSummaryJobState {
  paperId: string;
  shortId: string;
  status: 'running' | 'completed' | 'failed';
  phase: string;
  /** Accumulated full text so far (for recovery) */
  accumulatedText: string;
  /** Final summary (set on completion) */
  summary: string | null;
  /** Error message (set on failure) */
  error: string | null;
  /** AbortController for cancellation */
  controller: AbortController;
  /** Streaming port for chunk delivery */
  streamPort: StreamingPort | null;
}

/**
 * Singleton service managing AI summary background jobs.
 */
class AiSummaryJobService {
  /** Active and recently completed jobs, keyed by paperId */
  private jobs = new Map<string, AiSummaryJobState>();

  /**
   * Start generating an AI summary as a background job.
   * If a job is already running for this paperId, it is cancelled first.
   */
  startJob(input: {
    paperId: string;
    shortId: string;
    title: string;
    abstract?: string;
    pdfUrl?: string;
    pdfPath?: string;
    language?: 'en' | 'zh';
  }): void {
    const { paperId, shortId, title } = input;

    // Cancel any previous job for this paper
    const prev = this.jobs.get(paperId);
    if (prev && prev.status === 'running') {
      prev.controller.abort();
      prev.streamPort?.close();
    }

    const controller = new AbortController();

    // Create streaming port for the first available window
    let streamPort: StreamingPort | null = null;
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      streamPort = createStreamingPort(windows[0].webContents, paperId);
    }

    const job: AiSummaryJobState = {
      paperId,
      shortId,
      status: 'running',
      phase: '',
      accumulatedText: '',
      summary: null,
      error: null,
      controller,
      streamPort,
    };
    this.jobs.set(paperId, job);

    console.log('[ai-summary-job] Starting job for:', shortId);

    // Run generation in background (fire-and-forget)
    generateAiSummary(
      paperId,
      shortId,
      title,
      (chunk) => {
        job.accumulatedText += chunk;
        // Send via MessagePort for smooth streaming
        job.streamPort?.sendChunk(chunk);
        // Also broadcast via IPC as fallback
        this.broadcast('papers:aiSummaryChunk', { paperId, chunk });
      },
      {
        abstract: input.abstract,
        pdfUrl: input.pdfUrl,
        pdfPath: input.pdfPath,
        language: input.language,
        signal: controller.signal,
        onPhase: (phase: string) => {
          job.phase = phase;
          this.broadcast('papers:aiSummaryPhase', { paperId, phase });
        },
      },
    )
      .then((summary) => {
        job.status = 'completed';
        job.summary = summary;
        job.streamPort?.sendDone();
        job.streamPort?.close();
        job.streamPort = null;
        console.log('[ai-summary-job] Completed, length:', summary.length);
        this.broadcast('papers:aiSummaryDone', { paperId, summary });
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        // Don't treat abort as error
        if (controller.signal.aborted) return;
        job.status = 'failed';
        job.error = msg;
        job.streamPort?.sendError(msg);
        job.streamPort?.close();
        job.streamPort = null;
        console.error('[ai-summary-job] Failed:', msg);
        this.broadcast('papers:aiSummaryError', { paperId, error: msg });
      });
  }

  /**
   * Cancel a running job for a paper. User-initiated only.
   */
  cancelJob(paperId: string): boolean {
    const job = this.jobs.get(paperId);
    if (!job || job.status !== 'running') return false;

    job.controller.abort();
    job.status = 'failed';
    job.error = 'Cancelled by user';
    job.streamPort?.close();
    job.streamPort = null;
    this.broadcast('papers:aiSummaryError', { paperId, error: 'Cancelled by user' });
    console.log('[ai-summary-job] Cancelled job for:', paperId);
    return true;
  }

  /**
   * Get active job status for recovery when renderer remounts.
   * Returns null if no job exists for this paperId.
   */
  getActiveStatus(paperId: string): {
    status: 'running' | 'completed' | 'failed';
    phase: string;
    accumulatedText: string;
    summary: string | null;
    error: string | null;
  } | null {
    const job = this.jobs.get(paperId);
    if (!job) return null;

    return {
      status: job.status,
      phase: job.phase,
      accumulatedText: job.accumulatedText,
      summary: job.summary,
      error: job.error,
    };
  }

  /**
   * Re-attach a streaming port when the renderer re-mounts.
   * This allows resumed streaming after navigation.
   */
  reattachStreamingPort(paperId: string): void {
    const job = this.jobs.get(paperId);
    if (!job || job.status !== 'running') return;

    // Close old port if any
    job.streamPort?.close();

    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      job.streamPort = createStreamingPort(windows[0].webContents, paperId);
    }
  }

  /**
   * Clean up completed/failed jobs older than a threshold.
   */
  cleanup(paperId: string): void {
    const job = this.jobs.get(paperId);
    if (job && job.status !== 'running') {
      this.jobs.delete(paperId);
    }
  }

  /**
   * Broadcast an event to all BrowserWindows.
   */
  private broadcast(channel: string, data: unknown): void {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, data);
      }
    }
  }
}

/** Singleton instance */
export const aiSummaryJobService = new AiSummaryJobService();
