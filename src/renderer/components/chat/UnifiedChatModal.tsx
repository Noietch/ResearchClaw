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
  Zap,
  FileText,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ipc } from '../../hooks/use-ipc';
import { useAcpChatStream } from '../../hooks/use-acp-chat-stream';

interface ChatSession {
  id: string;
  projectId: string;
  title: string;
  paperIds: string[];
  repoIds: string[];
  backend: string | null;
  cwd: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UnifiedChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectWorkdir?: string | null;
  paperIds: string[];
  repoIds?: string[];
}

/**
 * Unified chat modal supporting both lightweight (direct LLM) and ACP agent modes.
 * Replaces the old IdeaChatModal with the new ACP infrastructure.
 */
export function UnifiedChatModal({
  isOpen,
  onClose,
  projectId,
  projectWorkdir,
  paperIds,
  repoIds,
}: UnifiedChatModalProps) {
  const { t, i18n } = useTranslation();
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [currentSessionPaperIds, setCurrentSessionPaperIds] = useState<string[] | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [backend, setBackend] = useState<string | null>(null); // 'lightweight' | 'claude-code' | null
  const [paperTitles, setPaperTitles] = useState<Map<string, string>>(new Map());

  const jobIdRef = useRef<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Use ACP chat streaming hook
  const { messages, status, canSend, permissionRequest, setPermissionRequest } = useAcpChatStream(
    jobIdRef.current,
    jobIdRef,
  );

  // Load sessions when modal opens
  useEffect(() => {
    if (isOpen) {
      void loadSessions();
    }
  }, [isOpen, projectId]);

  // Reset when modal closes (prepare for next open)
  useEffect(() => {
    if (!isOpen) {
      setInput('');
      setCurrentSessionId(null);
      setCurrentSessionPaperIds(null);
      setBackend(null);
      jobIdRef.current = '';
    }
  }, [isOpen]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ESC to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Load paper titles for display
  useEffect(() => {
    const activePapers = currentSessionPaperIds ?? paperIds;
    if (activePapers.length === 0) return;

    const loadTitles = async () => {
      const titles = new Map<string, string>();
      for (const paperId of activePapers) {
        try {
          const paper = await ipc.getPaper(paperId);
          if (paper) {
            titles.set(paperId, paper.title);
          }
        } catch (err) {
          console.error('Failed to load paper title:', err);
        }
      }
      setPaperTitles(titles);
    };

    void loadTitles();
  }, [currentSessionPaperIds, paperIds]);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const result = await ipc.listAcpChatSessions(projectId);
      setSessions(
        result.map((s) => ({
          ...s,
          paperIds: JSON.parse(s.paperIdsJson) as string[],
          repoIds: JSON.parse(s.repoIdsJson) as string[],
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
        backend,
        cwd: projectWorkdir ?? undefined,
      });
      const newSession: ChatSession = {
        id: result.id,
        projectId: result.projectId,
        title: result.title,
        paperIds: JSON.parse(result.paperIdsJson) as string[],
        repoIds: JSON.parse(result.repoIdsJson) as string[],
        backend: result.backend,
        cwd: result.cwd,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      };
      setSessions((prev) => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      setCurrentSessionPaperIds(null);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const session = await ipc.getAcpChatSession(sessionId);
      if (!session) return;

      setCurrentSessionId(sessionId);
      setCurrentSessionPaperIds(session.paperIds.length > 0 ? session.paperIds : null);
      setBackend(session.backend);
      // Messages will be loaded by a future enhancement
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
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !canSend) return;

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
          backend,
          cwd: projectWorkdir ?? undefined,
        });
        sessionId = result.id;
        const newSession: ChatSession = {
          id: result.id,
          projectId: result.projectId,
          title: result.title,
          paperIds: JSON.parse(result.paperIdsJson) as string[],
          repoIds: JSON.parse(result.repoIdsJson) as string[],
          backend: result.backend,
          cwd: result.cwd,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        };
        setSessions((prev) => [newSession, ...prev]);
        setCurrentSessionId(sessionId);

        // Generate title from first message
        void ipc.generateAcpChatTitle(text).then((title) => {
          void ipc.updateAcpChatSessionTitle(sessionId!, title);
          setSessions((prev) => prev.map((s) => (s.id === sessionId ? { ...s, title } : s)));
        });
      } catch (err) {
        console.error('Failed to create session:', err);
        return;
      }
    }

    setInput('');

    try {
      const result = await ipc.sendAcpChatMessage({
        chatSessionId: sessionId,
        projectId,
        paperIds: activePaperIds,
        repoIds,
        prompt: text,
        backend,
        cwd: projectWorkdir ?? undefined,
        language: i18n.language === 'zh' ? 'zh' : 'en',
      });
      jobIdRef.current = result.jobId;
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }, [
    input,
    canSend,
    currentSessionId,
    currentSessionPaperIds,
    projectId,
    paperIds,
    repoIds,
    backend,
    projectWorkdir,
  ]);

  const handlePermissionResponse = async (optionId: string) => {
    if (!permissionRequest || !jobIdRef.current) return;
    try {
      await ipc.respondToAcpChatPermission(jobIdRef.current, permissionRequest.requestId, optionId);
      setPermissionRequest(null);
    } catch (err) {
      console.error('Failed to respond to permission:', err);
    }
  };

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
                  {/* Backend Selector */}
                  <div className="flex-shrink-0 border-b border-notion-border p-3">
                    <label className="mb-1.5 block text-xs font-medium text-notion-text">
                      {t('chat.mode')}
                    </label>
                    <select
                      value={backend ?? 'lightweight'}
                      onChange={async (e) => {
                        const newBackend = e.target.value === 'lightweight' ? null : e.target.value;
                        setBackend(newBackend);
                        // Persist backend change to current session
                        if (currentSessionId) {
                          try {
                            await ipc.updateAcpChatSessionBackend(currentSessionId, newBackend);
                            // Update local sessions list
                            setSessions((prev) =>
                              prev.map((s) =>
                                s.id === currentSessionId ? { ...s, backend: newBackend } : s,
                              ),
                            );
                          } catch (err) {
                            console.error('Failed to update session backend:', err);
                          }
                        }
                      }}
                      className="w-full rounded-lg border border-notion-border bg-white px-2 py-1.5 text-sm text-notion-text focus:border-blue-400 focus:outline-none"
                    >
                      <option value="lightweight">{t('chat.backend.lightweight')}</option>
                      <option value="claude-code">{t('chat.backend.claude')}</option>
                      <option value="codex">{t('chat.backend.codex')}</option>
                      <option value="gemini">{t('chat.backend.gemini')}</option>
                      <option value="opencode">{t('chat.backend.opencode')}</option>
                    </select>
                  </div>

                  {/* Sidebar Header */}
                  <div className="flex flex-shrink-0 items-center justify-between border-b border-notion-border px-3 py-3">
                    <div className="flex items-center gap-2">
                      <History size={16} className="text-notion-text-secondary" />
                      <span className="text-sm font-medium text-notion-text">
                        {t('chat.history')}
                      </span>
                    </div>
                    <button
                      onClick={createNewSession}
                      className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-notion-sidebar-hover"
                      title={t('chat.newChat')}
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
                        <p className="text-xs text-notion-text-tertiary">{t('chat.noHistory')}</p>
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
                              <div className="flex items-center gap-1">
                                {session.backend === 'claude-code' && (
                                  <Zap size={12} className="flex-shrink-0" />
                                )}
                                <span className="block truncate">{session.title}</span>
                              </div>
                              {session.paperIds.length > 0 && (
                                <span className="text-xs text-notion-text-tertiary">
                                  {t('chat.paperCount', { count: session.paperIds.length })}
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
                  title={showSidebar ? t('chat.hideSidebar') : t('chat.showSidebar')}
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
                      ? sessions.find((s) => s.id === currentSessionId)?.title ||
                        t('chat.researchChatTitle')
                      : t('chat.researchChatTitle')}
                  </h2>
                  {sourceCount > 0 && (
                    <p className="text-xs text-notion-text-tertiary">
                      {t('chat.sourcesSelected', { count: sourceCount })}
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
                {messages.length === 0 && status === 'idle' && (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <MessageSquare
                        size={32}
                        className="mx-auto mb-3 text-notion-text-tertiary/40"
                      />
                      <p className="text-sm text-notion-text-tertiary">
                        {t('chat.startConversation')}
                      </p>
                      {sourceCount > 0 && (
                        <p className="mt-1 text-xs text-notion-text-tertiary">
                          {t('chat.sourcesSelected', { count: sourceCount })}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => {
                  const content = msg.content as { text?: string };
                  if (msg.type === 'text' && msg.role === 'user') {
                    return (
                      <div key={i} className="flex justify-end">
                        <div className="max-w-[80%] rounded-xl bg-blue-50 px-4 py-2.5 text-sm leading-relaxed text-notion-text">
                          <p className="whitespace-pre-wrap">{content.text}</p>
                        </div>
                      </div>
                    );
                  }
                  if (msg.type === 'text' && msg.role === 'assistant') {
                    return (
                      <div key={i} className="flex justify-start">
                        <div className="max-w-[80%] rounded-xl bg-notion-sidebar px-4 py-2.5 text-sm leading-relaxed text-notion-text">
                          <p className="whitespace-pre-wrap">{content.text}</p>
                        </div>
                      </div>
                    );
                  }
                  if (msg.type === 'error') {
                    return (
                      <div
                        key={i}
                        className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
                      >
                        {content.text}
                      </div>
                    );
                  }
                  return null;
                })}

                {/* Streaming indicator */}
                {status === 'running' && !permissionRequest && (
                  <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-xl bg-notion-sidebar px-4 py-2.5 text-sm leading-relaxed text-notion-text">
                      <span className="flex items-center gap-2 text-notion-text-tertiary">
                        <Loader2 size={12} className="animate-spin" />
                        {t('chat.thinking')}
                      </span>
                    </div>
                  </div>
                )}

                {/* Permission Request */}
                {permissionRequest && (
                  <div className="rounded-lg border border-notion-border bg-white p-4 shadow-sm">
                    <p className="mb-3 text-sm font-medium text-notion-text">
                      {permissionRequest.request.toolCall.title}
                    </p>
                    <div className="space-y-2">
                      {permissionRequest.request.options.map((option) => (
                        <button
                          key={option.optionId}
                          onClick={() => void handlePermissionResponse(option.optionId)}
                          className="w-full rounded-lg border border-notion-border px-3 py-2 text-left text-sm hover:bg-blue-50"
                        >
                          {option.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input Footer */}
              <div className="flex-shrink-0 px-4 py-4">
                {/* Paper context indicator */}
                {activePaperIds.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {activePaperIds.slice(0, 3).map((paperId) => (
                      <div
                        key={paperId}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-100 px-2 py-1 text-xs text-notion-text"
                        title={paperTitles.get(paperId) || paperId}
                      >
                        <FileText size={10} />
                        <span className="max-w-[160px] truncate">
                          {paperTitles.get(paperId) || paperId}
                        </span>
                      </div>
                    ))}
                    {activePaperIds.length > 3 && (
                      <div className="inline-flex items-center rounded-lg bg-notion-sidebar px-2 py-1 text-xs text-notion-text-tertiary">
                        {t('chat.moreCount', { count: activePaperIds.length - 3 })}
                      </div>
                    )}
                  </div>
                )}
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
                    placeholder={t('chat.placeholder')}
                    rows={1}
                    className="w-full resize-none bg-transparent px-4 py-3 pr-12 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none"
                    style={{ minHeight: '48px', maxHeight: '200px' }}
                  />
                  {status === 'running' ? (
                    <button
                      onClick={() => void ipc.killAcpChatJob(jobIdRef.current)}
                      className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-red-500 text-white transition-all hover:bg-red-600"
                    >
                      <Square size={12} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      onClick={() => void sendMessage()}
                      disabled={!input.trim() || !canSend}
                      className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-notion-text text-white transition-all hover:opacity-80 disabled:bg-gray-200 disabled:text-gray-400 disabled:opacity-40"
                    >
                      <Send size={14} />
                    </button>
                  )}
                </div>
                <p className="mt-2 text-center text-xs text-notion-text-tertiary">
                  {t('chat.sendHint')}
                </p>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
