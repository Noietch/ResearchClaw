import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Square,
  Calendar,
  Clock,
  Folder,
  Settings2,
  ChevronDown,
  ArrowUp,
  Zap,
} from 'lucide-react';
import { ipc } from '../../../hooks/use-ipc';
import { useAgentStream } from '../../../hooks/use-agent-stream';
import { useRunMessages } from '../../../hooks/use-run-messages';
import { MessageStream } from '../../../components/agent-todo/MessageStream';
import { RunTimeline } from '../../../components/agent-todo/RunTimeline';
import { StatusDot } from '../../../components/agent-todo/StatusDot';
import { PriorityBarIcon } from '../../../components/agent-todo/PriorityBar';
import { TodoForm } from '../../../components/agent-todo/TodoForm';
import { AgentLogo } from '../../../components/agent-todo/AgentLogo';
import type { AgentConfigItem } from '@shared';
import { motion, AnimatePresence } from 'framer-motion';

const LEVEL_LABELS = ['Low', 'Normal', 'Medium', 'High', 'Urgent'];

function TaskInfoPanel({ todo }: { todo: any }) {
  return (
    <div className="px-3 py-3 space-y-2.5 border-t border-notion-border">
      <span className="text-xs font-medium text-notion-text-secondary uppercase tracking-wide block">
        Info
      </span>

      {/* Priority */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-notion-text-tertiary w-14 flex-shrink-0">Priority</span>
        <PriorityBarIcon value={todo.priority ?? 0} />
        <span className="text-xs text-notion-text-secondary">
          {LEVEL_LABELS[todo.priority ?? 0]}
        </span>
      </div>

      {/* Cron */}
      {todo.cronEnabled && todo.cronExpr && (
        <div className="flex items-start gap-2">
          <Calendar size={11} className="text-notion-text-tertiary flex-shrink-0 mt-0.5" />
          <p className="text-xs font-mono text-notion-text-tertiary">{todo.cronExpr}</p>
        </div>
      )}

      {/* Created at */}
      <div className="flex items-center gap-2">
        <Clock size={11} className="text-notion-text-tertiary flex-shrink-0" />
        <span className="text-xs text-notion-text-tertiary">
          {new Date(todo.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </span>
      </div>
    </div>
  );
}

export function AgentTodoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [todo, setTodo] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const [showEditForm, setShowEditForm] = useState(false);

  // Chat input state
  const [chatInput, setChatInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [allAgents, setAllAgents] = useState<AgentConfigItem[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const agentPickerRef = useRef<HTMLDivElement>(null);

  const {
    messages: streamMessages,
    status: streamStatus,
    permissionRequest,
    setPermissionRequest,
    stderrLines,
  } = useAgentStream(id!);

  const isViewingCurrentRun = selectedRunId === runs[0]?.id;

  const {
    messages: displayMessages,
    addOptimisticMessage,
    removeOptimisticMessage,
  } = useRunMessages(selectedRunId, streamMessages, isViewingCurrentRun);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  // Load agents for the picker
  useEffect(() => {
    ipc
      .listAgents()
      .then((agents) => setAllAgents(agents.filter((a) => a.enabled)))
      .catch(() => undefined);
  }, []);

  // Close agent picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (agentPickerRef.current && !agentPickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  async function loadData() {
    try {
      const [todoData, runsData] = await Promise.all([
        ipc.getAgentTodo(id!),
        ipc.listAgentTodoRuns(id!),
      ]);
      setTodo(todoData);
      setRuns(runsData);
      if (runsData.length > 0 && !selectedRunId) {
        setSelectedRunId(runsData[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const latestRunStatus = runs[0]?.status ?? 'idle';
  const currentStatus =
    selectedRunId === runs[0]?.id
      ? streamStatus === 'idle'
        ? latestRunStatus
        : streamStatus
      : (runs.find((r) => r.id === selectedRunId)?.status ?? 'idle');

  const isRunning = currentStatus === 'running' || currentStatus === 'initializing';

  // Derive the agent for the current todo
  const currentAgent = allAgents.find((a) => a.id === todo?.agentId) ?? allAgents[0] ?? null;

  async function handleRun() {
    try {
      await ipc.runAgentTodo(id!);
      const [todoData, runsData] = await Promise.all([
        ipc.getAgentTodo(id!),
        ipc.listAgentTodoRuns(id!),
      ]);
      setTodo(todoData);
      setRuns(runsData);
      if (runsData.length > 0) {
        setSelectedRunId(runsData[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleStop() {
    try {
      await ipc.stopAgentTodo(id!);
      await loadData();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDeleteRun(runId: string) {
    try {
      await ipc.deleteAgentTodoRun(runId);
      const runsData = await ipc.listAgentTodoRuns(id!);
      setRuns(runsData);
      if (selectedRunId === runId) {
        if (runsData.length > 0) {
          setSelectedRunId(runsData[0].id);
        } else {
          setSelectedRunId(null);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }

  const handleSend = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || isRunning || !isViewingCurrentRun) return;

    setChatInput('');
    setSendError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    addOptimisticMessage(text);

    const runId = runs[0]?.id;
    if (runId) {
      try {
        await ipc.sendAgentMessage(id!, runId, text);
      } catch (err) {
        console.error(err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        setSendError(errorMsg);
        // Remove the optimistic message on failure
        removeOptimisticMessage(text);
        // Restore the input text so user can retry
        setChatInput(text);
      }
    }
  }, [
    chatInput,
    isRunning,
    isViewingCurrentRun,
    runs,
    id,
    addOptimisticMessage,
    removeOptimisticMessage,
  ]);

  if (!todo) {
    return (
      <div className="flex h-full items-center justify-center text-notion-text-secondary text-sm">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-notion-border px-4 py-3 flex-shrink-0">
        <button
          onClick={() => {
            const from = (location.state as { from?: string })?.from;
            navigate(from ?? '/agent-todos');
          }}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50 flex-shrink-0"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-semibold text-notion-text truncate">{todo.title}</h1>
            <Folder size={13} className="text-notion-text-tertiary flex-shrink-0" />
            <span className="text-sm text-notion-text-tertiary font-mono truncate min-w-0">
              {todo.cwd}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusDot status={currentStatus} />
          <button
            onClick={() => setShowEditForm(true)}
            className="flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs text-notion-text-secondary hover:bg-notion-sidebar transition-colors"
            title="Edit"
          >
            <Settings2 size={12} /> Edit
          </button>
          {isRunning ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
            >
              <Square size={12} /> Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              className="flex items-center gap-1.5 rounded-lg bg-notion-text px-3 py-1.5 text-xs text-white hover:bg-notion-text/90 transition-colors"
            >
              <Play size={12} /> Run
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left column: Run Timeline + Task Info */}
        <div className="w-52 flex-shrink-0 border-r border-notion-border flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            <RunTimeline
              runs={runs}
              selectedRunId={selectedRunId}
              onSelect={setSelectedRunId}
              onDelete={handleDeleteRun}
            />
          </div>
          <div className="overflow-y-auto flex-shrink-0">
            <TaskInfoPanel todo={todo} />
          </div>
        </div>

        {/* Right column: Messages + Input */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* stderr output panel — shown while running */}
          {isRunning && stderrLines.length > 0 && (
            <div className="absolute bottom-24 right-4 w-80 rounded-lg bg-gray-900 border border-gray-700 shadow-lg overflow-hidden z-10">
              <div className="px-3 py-1.5 border-b border-gray-700">
                <span className="text-xs text-gray-400 font-mono">Agent output</span>
              </div>
              <div className="px-3 py-2 max-h-32 overflow-y-auto">
                {stderrLines.slice(-20).map((line, i) => (
                  <p key={i} className="text-xs font-mono text-green-400 leading-relaxed">
                    {line}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto">
            <MessageStream
              key={selectedRunId ?? 'none'}
              messages={displayMessages}
              todoId={id!}
              status={currentStatus}
              permissionRequest={permissionRequest}
              onPermissionResolved={() => {
                setPermissionRequest(null);
                loadData();
              }}
            />
          </div>

          {/* Input — same style as paper reader */}
          <div className="flex-shrink-0 px-4 py-4 border-t border-notion-border">
            <div className="mx-auto w-full max-w-2xl">
              {/* Error message */}
              {sendError && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  <span className="truncate">{sendError}</span>
                  <button
                    onClick={() => setSendError(null)}
                    className="flex-shrink-0 text-red-400 hover:text-red-600"
                  >
                    ×
                  </button>
                </div>
              )}
              <div className="rounded-2xl border border-notion-border bg-white shadow-sm transition-all">
                <div className="flex items-end gap-2 px-4 pt-3.5">
                  <textarea
                    ref={textareaRef}
                    value={chatInput}
                    onChange={(e) => {
                      setChatInput(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={
                      !isViewingCurrentRun
                        ? 'Viewing past run — select the latest run to chat'
                        : isRunning
                          ? 'Agent is running…'
                          : 'Send a follow-up message…'
                    }
                    disabled={!isViewingCurrentRun || isRunning}
                    rows={1}
                    className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-notion-text placeholder:text-notion-text-tertiary focus:outline-none disabled:opacity-40"
                    style={{ minHeight: '52px', maxHeight: '160px' }}
                  />
                </div>
                {/* Bottom bar: agent indicator + yolo + send button */}
                <div className="flex items-center justify-between px-3 pb-3 pt-2">
                  {/* Agent indicator / picker */}
                  <div ref={agentPickerRef} className="relative">
                    <button
                      onClick={() => setShowAgentPicker((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                    >
                      {currentAgent ? (
                        <>
                          <AgentLogo tool={currentAgent.agentTool} size={13} />
                          <span className="max-w-[120px] truncate font-medium">
                            {currentAgent.name}
                          </span>
                        </>
                      ) : (
                        <span className="text-notion-text-tertiary">Select agent…</span>
                      )}
                      <ChevronDown size={10} className="opacity-60" />
                    </button>

                    <AnimatePresence>
                      {showAgentPicker && (
                        <motion.div
                          initial={{ opacity: 0, y: 4, scale: 0.97 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 4, scale: 0.97 }}
                          transition={{ duration: 0.1 }}
                          className="absolute bottom-full left-0 z-50 mb-1 w-56 rounded-lg border border-notion-border bg-white py-1.5 shadow-lg"
                        >
                          {allAgents.length > 0 ? (
                            allAgents.map((agent) => (
                              <button
                                key={agent.id}
                                onClick={async () => {
                                  setShowAgentPicker(false);
                                  await ipc.updateAgentTodo(id!, { agentId: agent.id });
                                  await loadData();
                                }}
                                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 ${
                                  todo?.agentId === agent.id
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'text-notion-text-secondary'
                                }`}
                              >
                                <span className="flex-shrink-0">
                                  <AgentLogo tool={agent.agentTool} size={14} />
                                </span>
                                <span className="truncate font-medium">{agent.name}</span>
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-3 text-center text-xs text-notion-text-tertiary">
                              No agents configured.{' '}
                              <button
                                onClick={() => {
                                  navigate('/settings');
                                  setShowAgentPicker(false);
                                }}
                                className="text-blue-500 hover:underline"
                              >
                                Go to Settings
                              </button>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Right side: YOLO pill + send/stop */}
                  <div className="flex items-center gap-2">
                    {/* YOLO toggle */}
                    <button
                      onClick={async () => {
                        const next = !todo?.yoloMode;
                        await ipc.updateAgentTodo(id!, { yoloMode: next });
                        await loadData();
                      }}
                      title={
                        todo?.yoloMode
                          ? 'YOLO mode on — click to disable'
                          : 'Enable YOLO mode (auto-approve all permissions)'
                      }
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                        todo?.yoloMode
                          ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                          : 'bg-notion-sidebar text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text-secondary'
                      }`}
                    >
                      <Zap
                        size={11}
                        className={todo?.yoloMode ? 'fill-amber-500 text-amber-500' : ''}
                      />
                      YOLO
                    </button>

                    {/* Send / Stop */}
                    {isRunning ? (
                      <button
                        onClick={handleStop}
                        className="flex-shrink-0 rounded-full bg-gray-400 p-1.5 text-white hover:bg-gray-500"
                        title="Stop"
                      >
                        <Square size={13} />
                      </button>
                    ) : (
                      <button
                        onClick={() => void handleSend()}
                        disabled={!chatInput.trim() || !isViewingCurrentRun || isRunning}
                        className="flex-shrink-0 rounded-full bg-notion-text p-1.5 text-white transition-opacity hover:opacity-80 disabled:opacity-30"
                        title="Send"
                      >
                        <ArrowUp size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Form */}
      <TodoForm
        isOpen={showEditForm}
        onClose={() => setShowEditForm(false)}
        onSuccess={loadData}
        editId={id}
        initialValues={
          todo
            ? {
                title: todo.title,
                prompt: todo.prompt,
                cwd: todo.cwd,
                agentId: todo.agentId,
                priority: todo.priority,
                yoloMode: todo.yoloMode,
              }
            : undefined
        }
      />
    </div>
  );
}
