import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Send, Loader2, Sparkles, ArrowLeft, MessageSquare } from 'lucide-react';
import { ipc, onIpc } from '../../hooks/use-ipc';
import { AgentSelector } from '../agent-todo/AgentSelector';
import { CwdPicker } from '../agent-todo/CwdPicker';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface IdeaChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectWorkdir?: string | null;
  paperIds: string[];
  repoIds?: string[];
  onTaskCreated: () => void;
}

export function IdeaChatModal({
  isOpen,
  onClose,
  projectId,
  projectWorkdir,
  paperIds,
  repoIds,
  onTaskCreated,
}: IdeaChatModalProps) {
  const [view, setView] = useState<'chat' | 'task-form'>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);

  // Task form state
  const [taskTitle, setTaskTitle] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskAgentId, setTaskAgentId] = useState('');
  const [taskCwd, setTaskCwd] = useState<string>(projectWorkdir ?? '');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const sessionId = useRef(`idea-chat-${Date.now()}`);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setView('chat');
      setMessages([]);
      setInput('');
      setStreaming(false);
      setStreamingContent('');
      setExtractError(null);
      setCreateError(null);
      sessionId.current = `idea-chat-${Date.now()}`;
    }
  }, [isOpen]);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  // IPC event subscriptions
  useEffect(() => {
    if (!isOpen) return;

    const unsubOutput = onIpc('idea-chat:output', (...args) => {
      const chunk = args[1] as string;
      setStreamingContent((prev) => prev + chunk);
    });

    const unsubDone = onIpc('idea-chat:done', () => {
      setStreamingContent((prev) => {
        if (prev) {
          setMessages((msgs) => [...msgs, { role: 'assistant', content: prev }]);
        }
        return '';
      });
      setStreaming(false);
    });

    const unsubError = onIpc('idea-chat:error', () => {
      setStreamingContent((prev) => {
        if (prev) {
          setMessages((msgs) => [...msgs, { role: 'assistant', content: prev }]);
        }
        return '';
      });
      setStreaming(false);
    });

    return () => {
      unsubOutput();
      unsubDone();
      unsubError();
    };
  }, [isOpen]);

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

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);
    setStreamingContent('');

    try {
      await ipc.startIdeaChat({
        sessionId: sessionId.current,
        projectId,
        paperIds,
        repoIds,
        messages: newMessages,
      });
    } catch (err) {
      setStreaming(false);
      setStreamingContent('');
      setMessages((msgs) => [
        ...msgs,
        {
          role: 'assistant',
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ]);
    }
  }, [input, streaming, messages, projectId, paperIds, repoIds]);

  const generateTask = async () => {
    if (messages.length === 0 || streaming || extracting) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const result = await ipc.extractTaskFromChat({ projectId, messages });
      setTaskTitle(result.title);
      setTaskPrompt(result.prompt);
      setTaskCwd(projectWorkdir ?? '');

      setTaskAgentId('');
      setCreateError(null);
      setView('task-form');
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtracting(false);
    }
  };

  const createTask = async () => {
    if (!taskTitle.trim() || !taskPrompt.trim() || !taskAgentId) {
      setCreateError('Please fill in title, prompt, and select an agent.');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      await ipc.createAgentTodo({
        title: taskTitle.trim(),
        prompt: taskPrompt.trim(),
        cwd: taskCwd.trim(),
        agentId: taskAgentId,
        projectId,
      });
      onTaskCreated();
      onClose();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const sourceCount = paperIds.length + (repoIds?.length ?? 0);

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
            className="fixed right-0 top-0 z-[101] flex h-full w-[640px] flex-col bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {view === 'chat' ? (
              <>
                {/* Chat Header */}
                <div className="flex flex-shrink-0 items-center gap-3 border-b border-notion-border px-4 py-3">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-notion-tag-blue">
                    <MessageSquare size={14} className="text-notion-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="text-sm font-semibold text-notion-text">Research Chat</h2>
                    {sourceCount > 0 && (
                      <p className="text-xs text-notion-text-tertiary">
                        {sourceCount} source{sourceCount > 1 ? 's' : ''} selected
                      </p>
                    )}
                  </div>
                  <button
                    onClick={generateTask}
                    disabled={messages.length === 0 || streaming || extracting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-3 py-1.5 text-xs font-medium text-white hover:opacity-80 disabled:opacity-40"
                  >
                    {extracting ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Sparkles size={12} />
                    )}
                    Generate Task
                  </button>
                  <button
                    onClick={onClose}
                    className="text-notion-text-tertiary hover:text-notion-text"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Extract error */}
                <AnimatePresence>
                  {extractError && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="flex-shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-600"
                    >
                      {extractError}
                    </motion.div>
                  )}
                </AnimatePresence>

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
                            ? 'bg-notion-accent-light text-notion-text'
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

                {/* Input Footer - ChatGPT style */}
                <div className="flex-shrink-0 px-4 py-4">
                  <div className="relative rounded-2xl border border-notion-border bg-white shadow-sm focus-within:border-notion-text/30 focus-within:shadow-md transition-all">
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
                      disabled={streaming}
                      className="w-full resize-none bg-transparent px-4 py-3 pr-12 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none disabled:opacity-50"
                      style={{ minHeight: '48px', maxHeight: '200px' }}
                    />
                    <button
                      onClick={() => void sendMessage()}
                      disabled={!input.trim() || streaming}
                      className="absolute bottom-2.5 right-2.5 flex h-8 w-8 items-center justify-center rounded-lg bg-notion-text text-white transition-all hover:opacity-80 disabled:opacity-40 disabled:bg-gray-200 disabled:text-gray-400"
                    >
                      {streaming ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Send size={14} />
                      )}
                    </button>
                  </div>
                  <p className="mt-2 text-center text-xs text-notion-text-tertiary">
                    Press Enter to send, Shift+Enter for new line
                  </p>
                </div>
              </>
            ) : (
              <>
                {/* Task Form Header */}
                <div className="flex flex-shrink-0 items-center gap-3 border-b border-notion-border px-4 py-3">
                  <button
                    onClick={() => setView('chat')}
                    className="flex items-center gap-1.5 text-sm text-notion-text-secondary hover:text-notion-text"
                  >
                    <ArrowLeft size={14} />
                    Back
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={onClose}
                    className="text-notion-text-tertiary hover:text-notion-text"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Task Form Body */}
                <div className="notion-scrollbar flex-1 overflow-y-auto px-6 py-6 space-y-5">
                  <div>
                    <h2 className="text-base font-semibold text-notion-text">Create Agent Task</h2>
                    <p className="mt-0.5 text-xs text-notion-text-tertiary">
                      Review and edit the extracted task, then confirm to create it.
                    </p>
                  </div>

                  {/* Title */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-notion-text-secondary">
                      Title
                    </label>
                    <input
                      type="text"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      className="w-full rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text focus:outline-none focus:ring-1 focus:ring-notion-text/20"
                    />
                  </div>

                  {/* Prompt */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-notion-text-secondary">
                      Prompt
                    </label>
                    <textarea
                      value={taskPrompt}
                      onChange={(e) => setTaskPrompt(e.target.value)}
                      rows={8}
                      className="w-full resize-none rounded-lg border border-notion-border bg-transparent px-3 py-2 text-sm text-notion-text focus:outline-none focus:ring-1 focus:ring-notion-text/20"
                    />
                  </div>

                  {/* Agent */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-notion-text-secondary">
                      Agent
                    </label>
                    <AgentSelector value={taskAgentId} onChange={setTaskAgentId} />
                  </div>

                  {/* Working Directory */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-notion-text-secondary">
                      Working Directory
                    </label>
                    <CwdPicker value={taskCwd} onChange={setTaskCwd} />
                  </div>

                  {/* Error */}
                  <AnimatePresence>
                    {createError && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600"
                      >
                        {createError}
                      </motion.p>
                    )}
                  </AnimatePresence>
                </div>

                {/* Task Form Footer */}
                <div className="flex-shrink-0 border-t border-notion-border px-6 py-4">
                  <button
                    onClick={() => void createTask()}
                    disabled={creating || !taskTitle.trim() || !taskPrompt.trim() || !taskAgentId}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-notion-text px-4 py-2.5 text-sm font-medium text-white hover:opacity-80 disabled:opacity-40"
                  >
                    {creating ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Sparkles size={14} />
                    )}
                    {creating ? 'Creating…' : 'Create Task'}
                  </button>
                </div>
              </>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
