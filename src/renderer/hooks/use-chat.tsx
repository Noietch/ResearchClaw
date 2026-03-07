import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { ipc, onIpc, type ReadingNote } from './use-ipc';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

export type AiStatus = 'idle' | 'extracting_pdf' | 'thinking';

interface ChatState {
  paperId: string | null;
  sessionId: string;
  chatNotes: ReadingNote[];
  currentChatId: string | null;
  messages: ChatMessage[];
  chatRunning: boolean;
  streamingContent: string;
  aiStatus: AiStatus;
}

interface ChatCtx {
  state: ChatState;
  setChatNotes: (notes: ReadingNote[]) => void;
  setCurrentChatId: (id: string | null) => void;
  setMessages: (msgs: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setChatRunning: (v: boolean) => void;
  setStreamingContent: (v: string | ((prev: string) => string)) => void;
  setAiStatus: (s: AiStatus) => void;
  initForPaper: (paperId: string) => void;
  currentChatIdRef: React.MutableRefObject<string | null>;
}

const ChatContext = createContext<ChatCtx | null>(null);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [paperId, setPaperId] = useState<string | null>(null);
  const [sessionId] = useState(() => `reader-chat-${Date.now()}`);
  const [chatNotes, setChatNotes] = useState<ReadingNote[]>([]);
  const [currentChatId, setCurrentChatIdState] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatRunning, setChatRunning] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [aiStatus, setAiStatus] = useState<AiStatus>('idle');

  const currentChatIdRef = useRef<string | null>(null);
  const paperIdRef = useRef<string | null>(null);

  const setCurrentChatId = useCallback((id: string | null) => {
    setCurrentChatIdState(id);
    currentChatIdRef.current = id;
  }, []);

  const initForPaper = useCallback((pid: string) => {
    if (paperIdRef.current === pid) return; // already initialized for this paper
    // Switching to a different paper — reset chat state
    paperIdRef.current = pid;
    setPaperId(pid);
    setCurrentChatIdState(null);
    currentChatIdRef.current = null;
    setMessages([]);
    setChatNotes([]);
    setStreamingContent('');
    setAiStatus('idle');
    // Don't reset chatRunning — an in-progress chat should keep running
  }, []);

  // Global IPC listeners — these persist across page navigation
  useEffect(() => {
    const offOut = onIpc('chat:output', (_event, d) => {
      setStreamingContent((p) => p + String(d));
      setAiStatus((prev) => (prev === 'thinking' ? 'idle' : prev));
    });
    const offErr = onIpc('chat:error', (_event, d) => setStreamingContent((p) => p + String(d)));
    const offDone = onIpc('chat:done', () => {
      setChatRunning(false);
      setAiStatus('idle');
      setStreamingContent((streamed) => {
        if (streamed.trim()) {
          const msg: ChatMessage = {
            role: 'assistant',
            content: streamed.trim(),
            ts: Date.now(),
          };
          setMessages((prev) => {
            const next = [...prev, msg];
            const pid = paperIdRef.current;
            if (pid) {
              ipc
                .saveChat({ paperId: pid, noteId: currentChatIdRef.current, messages: next })
                .then((r) => {
                  if (!currentChatIdRef.current) {
                    currentChatIdRef.current = r.id;
                    setCurrentChatIdState(r.id);
                    ipc
                      .listReading(pid)
                      .then(setChatNotes)
                      .catch(() => undefined);
                  }
                })
                .catch(() => undefined);
            }
            return next;
          });
        }
        return '';
      });
    });
    return () => {
      offOut();
      offErr();
      offDone();
    };
  }, []);

  const state: ChatState = {
    paperId,
    sessionId,
    chatNotes,
    currentChatId,
    messages,
    chatRunning,
    streamingContent,
    aiStatus,
  };

  return (
    <ChatContext.Provider
      value={{
        state,
        setChatNotes,
        setCurrentChatId,
        setMessages,
        setChatRunning,
        setStreamingContent,
        setAiStatus,
        initForPaper,
        currentChatIdRef,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside ChatProvider');
  return ctx;
}
