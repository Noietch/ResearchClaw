import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ipc, onIpc, type AnalysisJobStatus } from './use-ipc';

interface StartAnalysisInput {
  paperId: string;
  pdfUrl?: string;
}

interface AnalysisCtx {
  jobs: AnalysisJobStatus[];
  refreshJobs: () => Promise<void>;
  startAnalysis: (input: StartAnalysisInput) => Promise<{
    jobId: string;
    sessionId: string;
    started: boolean;
    alreadyRunning?: boolean;
  }>;
  cancelAnalysis: (jobId: string) => Promise<boolean>;
}

const AnalysisContext = createContext<AnalysisCtx | null>(null);

function sortJobs(jobs: AnalysisJobStatus[]) {
  return [...jobs].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function upsertJob(jobs: AnalysisJobStatus[], nextJob: AnalysisJobStatus) {
  const filtered = jobs.filter((job) => job.jobId !== nextJob.jobId);
  return sortJobs([nextJob, ...filtered]);
}

export function AnalysisProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<AnalysisJobStatus[]>([]);

  const refreshJobs = useCallback(async () => {
    const nextJobs = await ipc.listAnalysisJobs().catch(() => null);
    if (nextJobs) {
      setJobs(sortJobs(nextJobs));
    }
  }, []);

  useEffect(() => {
    void refreshJobs();

    if (!window.electronAPI?.on) return;

    return onIpc('analysis:status', (_event, payload) => {
      const job = payload as AnalysisJobStatus;
      if (!job?.jobId) return;
      setJobs((prev) => upsertJob(prev, job));
    });
  }, [refreshJobs]);

  const startAnalysis = useCallback(
    async (input: StartAnalysisInput) => {
      const result = await ipc.analyzePaper(input);
      await refreshJobs().catch(() => undefined);
      return result;
    },
    [refreshJobs],
  );

  const cancelAnalysis = useCallback(
    async (jobId: string) => {
      const result = await ipc.killAnalysis(jobId);
      if (result.killed) {
        await refreshJobs().catch(() => undefined);
      }
      return result.killed;
    },
    [refreshJobs],
  );

  const value = useMemo(
    () => ({
      jobs,
      refreshJobs,
      startAnalysis,
      cancelAnalysis,
    }),
    [cancelAnalysis, jobs, refreshJobs, startAnalysis],
  );

  return <AnalysisContext.Provider value={value}>{children}</AnalysisContext.Provider>;
}

export function useAnalysis() {
  const ctx = useContext(AnalysisContext);
  if (!ctx) throw new Error('useAnalysis must be used inside AnalysisProvider');
  return ctx;
}
