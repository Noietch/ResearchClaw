import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Send,
  Loader2,
  MessageSquare,
  Square,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  History,
} from 'lucide-react';
import { ipc, onIpc } from '../../hooks/use-ipc';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSession {
  id: string;
  projectId: string;
  title: string;
  paperIds: string[];
  repoIds: string[];
  createdAt: string;
  updatedAt: string;
}

interface IdeaChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectWorkdir?: string | null;
  paperIds: string[];
  repoIds?: string[];
}

export function IdeaChatModal({
  isOpen,
  onClose,
  projectId,
  paperIds,
  repoIds,
}: IdeaChatModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');

  // Session management
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionPaperIds, setCurrentSessionPaperIds] = useState<string[] | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  const streamId = useRef(`chat-${Date.now()}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load sessions when modal opens
  useEffect(() => {
    if (isOpen) {
      void loadSessions();
    }
  }, [isOpen, projectId]);

  // Reset when modal opens (start new chat)
  useEffect(() => {
    if (isOpen) {
      setMessages([]);
      setInput('');
      setStreaming(false);
      setStreamingContent('');
      setCurrentSessionId(null);
      setCurrentSessionPaperIds(null);
      streamId.current = `chat-${Date.now()}`;
    }
  }, [isOpen]);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const result = await ipc.listAcpChatSessions(projectId);
      setSessions(
        result.map((r) => ({
          ...r,
          paperIds: JSON.parse(r.paperIdsJson) as string[],
          repoIds: JSON.parse(r.repoIdsJson) as string[],
        })),
      );
    } catch (err) {
      console.error('Failed to load chat sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  };

  const createNewSession = async () => {
    try {
      const result = await ipc.createAcpChatSession({
        projectId,
        title: 'New Chat',
        paperIds,
        repoIds,
      });
      const newSession: ChatSession = {
        ...result,
        paperIds: JSON.parse(result.paperIdsJson) as string[],
        repoIds: JSON.parse(result.repoIdsJson) as string[],
      };
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      setCurrentSessionPaperIds(null); // use prop paperIds for new session
      setMessages([]);
      streamId.current = `chat-${Date.now()}`;
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const session = await ipc.getAcpChatSession(sessionId);
      if (!session) return;

      setCurrentSessionId(sessionId);
      // Use the paperIds saved with this session so continued conversation uses the same context
      const savedPaperIds = session.paperIds as string[];
      setCurrentSessionPaperIds(savedPaperIds.length > 0 ? savedPaperIds : null);
      const msgs = await ipc.listAcpChatMessages(sessionId);
      setMessages(
        msgs.map((m: any) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      );
      streamId.current = `chat-${Date.now()}`;
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await ipc.deleteAcpChatSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // IPC event subscriptions for streaming
  useEffect(() => {
    if (!isOpen) return;

    const unsubOutput = onIpc('chat:output', (...args) => {
      const recvStreamId = args[0] as string;
      const chunk = args[1] as string;
      if (recvStreamId === streamId.current) {
        setStreamingContent((prev) => prev + chunk);
      }
    });

    const unsubDone = onIpc('chat:done', (...args) => {
      const recvStreamId = args[0] as string;
      if (recvStreamId === streamId.current) {
        setStreamingContent((prev) => {
          if (prev && currentSessionId) {
            // Save assistant message to database
            void (ipc as any).addAcpChatMessage({
              sessionId: currentSessionId,
              role: 'assistant',
              content: prev,
            });
            setMessages((msgs) => [...msgs, { role: 'assistant', content: prev }]);
          }
          return '';
        });
        setStreaming(false);
      }
    });

    const unsubError = onIpc('chat:error', (...args) => {
      const recvStreamId = args[0] as string;
      const msg = args[1] as string;
      if (recvStreamId === streamId.current) {
        setStreamingContent((prev) => {
          const content = prev || `Error: ${msg}`;
          if (currentSessionId) {
            void (ipc as any).addAcpChatMessage({
              sessionId: currentSessionId,
              role: 'assistant',
              content,
            });
            setMessages((msgs) => [...msgs, { role: 'assistant', content }]);
          }
          return '';
        });
        setStreaming(false);
      }
    });

    return () => {
      unsubOutput();
      unsubDone();
      unsubError();
    };
  }, [isOpen, currentSessionId]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    // Use the session's saved paperIds when continuing a historical session,
    // otherwise fall back to the current prop paperIds (new session).
    const activePaperIds = currentSessionPaperIds ?? paperIds;

    // Create session if not exists
    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        const result = await ipc.createAcpChatSession({
          projectId,
          title: 'New Chat',
          paperIds: activePaperIds,
          repoIds,
        });
        sessionId = result.id;
        const newSession: ChatSession = {
          ...result,
          paperIds: JSON.parse(result.paperIdsJson) as string[],
          repoIds: JSON.parse(result.repoIdsJson) as string[],
        };
        setSessions((prev) => [newSession, ...prev]);
        setCurrentSessionId(sessionId);

        // Generate title from first message
        if (messages.length === 0) {
          void ipc.generateAcpChatTitle(text).then((title: string) => {
            void ipc.updateAcpChatSessionTitle(sessionId!, title);
            setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
          });
        }
      } catch (err) {
        console.error('Failed to create session:', err);
        return;
      }
    }

    // Save user message
    try {
      await (ipc as any).addAcpChatMessage({
        sessionId,
        role: 'user',
        content: text,
      });
    } catch (err) {
      console.error('Failed to save message:', err);
    }

    const userMsg: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setStreaming(true);
    setStreamingContent('');

    // Capture current messages + new user message for the stream request
    const newMessages = [...messages, userMsg];

    try {
      await (ipc as any).startAcpChatStream({
        streamId: streamId.current,
        sessionId,
        projectId,
        paperIds: activePaperIds,
        repoIds,
        messages: newMessages,
      });
    } catch (err) {
      setStreaming(false);
      setStreamingContent('');
      const errorMsg = `Error: ${err instanceof Error ? err.message : String(err)}`;
      setMessages((msgs) => [...msgs, { role: 'assistant', content: errorMsg }]);
      // Save error message
      void (ipc as any).addAcpChatMessage({
        sessionId,
        role: 'assistant',
        content: errorMsg,
      });
    }
  }, [
    input,
    streaming,
    messages,
    currentSessionId,
    currentSessionPaperIds,
    projectId,
    paperIds,
    repoIds,
  ]);

  const activePaperIds = currentSessionPaperIds ?? paperIds;
  const sourceCount = activePaperIds.length + (repoIds?.length ?? 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] bg-black/30"
            onClick={onClose}
          />

          {/* Drawer */}
          <motion.div
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed right-0 top-0 z-[101] flex h-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar - Session List */}
            <AnimatePresence initial={false}>
              {showSidebar && (
                <motion.div
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: 240, opacity: 1 }}
                  exit={{ width: 0, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="flex h-full flex-col border-r border-notion-border bg-notion-sidebar"
                >
                  {/* Sidebar Header */}
                  <div className="flex flex-shrink-0 items-center justify-between border-b border-notion-border px-3 py-3">
                    <div className="flex items-center gap-2">
                      <History size={16} className="text-notion-text-secondary" />
                      <span className="text-sm font-medium text-notion-text">Chat History</span>
                    </div>
                    <button
                      onClick={createNewSession}
                      className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-notion-sidebar-hover"
                      title="New Chat"
                    >
                      <Plus size={16} className="text-notion-text-secondary" />
                    </button>
                  </div>

                  {/* Session List */}
                  <div className="notion-scrollbar flex-1 overflow-y-auto p-2">
                    {loadingSessions ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 size={16} className="animate-spin text-notion-text-tertiary" />
                      </div>
                    ) : sessions.length === 0 ? (
                      <div className="px-2 py-4 text-center">
                        <p className="text-xs text-notion-text-tertiary">No chat history</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {sessions.map((session) => (
                          <button
                            key={session.id}
                            onClick={() => void loadSession(session.id)}
                            className={`group flex w-full items-start justify-between rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                              currentSessionId === session.id
                                ? 'bg-blue-50 text-blue-600'
                                : 'text-notion-text-secondary hover:bg-notion-sidebar-hover'
                            }`}
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <span className="block truncate">{session.title}</span>
                              {session.paperIds.length > 0 && (
                                <span className="text-xs text-notion-text-tertiary">
                                  {session.paperIds.length} paper
                                  {session.paperIds.length > 1 ? 's' : ''}
                                </span>
                              )}
                            </div>
                            <div
                              onClick={(e) => void deleteSession(session.id, e)}
                              className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 hover:text-red-500"
                            >
                              <Trash2 size={12} />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Main Chat Area */}
            <div className="flex h-full w-[640px] flex-col bg-white">
              {/* Chat Header */}
              <div className="flex flex-shrink-0 items-center gap-3 border-b border-notion-border px-4 py-3">
                <button
                  onClick={() => setShowSidebar(!showSidebar)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-notion-sidebar-hover"
                  title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
                >
                  {showSidebar ? (
                    <ChevronLeft size={16} className="text-notion-text-secondary" />
                  ) : (
                    <ChevronRight size={16} className="text-notion-text-secondary" />
                  )}
                </button>
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-100">
                  <MessageSquare size={14} className="text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-semibold text-notion-text">
                    {currentSessionId
                      ? sessions.find((s) => s.id === currentSessionId)?.title || 'Research Chat'
                      : 'Research Chat'}
                  </h2>
                  {sourceCount > 0 && (
                    <p className="text-xs text-notion-text-tertiary">
                      {sourceCount} source{sourceCount > 1 ? 's' : ''} selected
                    </p>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="text-notion-text-tertiary hover:text-notion-text"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Messages */}
              <div className="notion-scrollbar flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {messages.length === 0 && !streaming && (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <MessageSquare
                        size={32}
                        className="mx-auto mb-3 text-notion-text-tertiary/40"
                      />
                      <p className="text-sm text-notion-text-tertiary">
                        Start a conversation about your research ideas
                      </p>
                      {sourceCount > 0 && (
                        <p className="mt-1 text-xs text-notion-text-tertiary">
                          {sourceCount} source{sourceCount > 1 ? 's' : ''} will be used as context
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-blue-50 text-notion-text'
                          : 'bg-notion-sidebar text-notion-text'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}

                {/* Streaming indicator */}
                {streaming && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-xl bg-notion-sidebar px-4 py-2.5 text-sm leading-relaxed text-notion-text">
                      {streamingContent ? (
                        <p className="whitespace-pre-wrap">{streamingContent}</p>
                      ) : (
                        <span className="flex items-center gap-2 text-notion-text-tertiary">
                          <Loader2 size={12} className="animate-spin" />
                          Thinking…
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input Footer */}
              <div className="flex-shrink-0 px-4 py-4">
                <div className="relative rounded-2xl border border-notion-border bg-white shadow-sm transition-all focus-within:border-notion-text/30 focus-within:shadow-md">
                  <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        void sendMessage();
                      }
                    }}
                    placeholder="Ask about research ideas…"
                    rows={1}
                    className="w-full resize-none bg-transparent px-4 py-3 pr-12 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none"
                    style={{ minHeight: '48px', maxHeight: '200px' }}
                  />
                  {streaming ? (
                    <button
                      onClick={() => void (ipc as any).killAcpChatStream(streamId.current)}
                      className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 text-white transition-all hover:bg-red-600"
                    >
                      <Square size={12} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      onClick={() => void sendMessage()}
                      disabled={!input.trim()}
                      className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-notion-text text-white transition-all hover:opacity-80 disabled:bg-gray-200 disabled:text-gray-400 disabled:opacity-40"
                    >
                      <Send size={14} />
                    </button>
                  )}
                </div>
                <p className="mt-2 text-center text-xs text-notion-text-tertiary">
                  Press Enter to send, Shift+Enter for new line
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
