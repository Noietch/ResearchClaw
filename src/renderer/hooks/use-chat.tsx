import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ipc, onIpc, type ChatJobStatus } from './use-ipc';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export type AiStatus = 'idle' | 'extracting_pdf' | 'thinking';

interface StartChatInput {
  paperId: string;
  messages: ChatMessage[];
  pdfUrl?: string;
  chatNoteId?: string | null;
}

interface ChatCtx {
  jobs: ChatJobStatus[];
  refreshJobs: () => Promise<void>;
  startChat: (input: StartChatInput) => Promise<{ jobId: string; started: boolean }>;
  cancelChat: (jobId: string) => Promise<boolean>;
}

const ChatContext = createContext<ChatCtx | null>(null);

function sortJobs(jobs: ChatJobStatus[]) {
  return [...jobs].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function upsertJob(jobs: ChatJobStatus[], nextJob: ChatJobStatus) {
  const filtered = jobs.filter((job) => job.jobId !== nextJob.jobId);
  return sortJobs([nextJob, ...filtered]);
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [jobs, setJobs] = useState<ChatJobStatus[]>([]);

  const refreshJobs = useCallback(async () => {
    const nextJobs = await ipc.listChatJobs().catch(() => null);
    if (nextJobs) {
      setJobs(sortJobs(nextJobs));
    }
  }, []);

  useEffect(() => {
    void refreshJobs();

    if (!window.electronAPI?.on) return;

    return onIpc('chat:status', (_event, payload) => {
      const job = payload as ChatJobStatus;
      if (!job?.jobId) return;
      setJobs((prev) => upsertJob(prev, job));
    });
  }, [refreshJobs]);

  const startChat = useCallback(
    async (input: StartChatInput) => {
      const result = await ipc.chat({
        sessionId: `chat-${Date.now()}`,
        paperId: input.paperId,
        messages: input.messages,
        pdfUrl: input.pdfUrl,
        chatNoteId: input.chatNoteId,
      });
      await refreshJobs().catch(() => undefined);
      return result;
    },
    [refreshJobs],
  );

  const cancelChat = useCallback(
    async (jobId: string) => {
      const result = await ipc.killChat(jobId);
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
      startChat,
      cancelChat,
    }),
    [cancelChat, jobs, refreshJobs, startChat],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
