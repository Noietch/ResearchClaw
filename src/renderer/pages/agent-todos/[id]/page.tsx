import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  ArrowLeft,
  Play,
  Square,
  Calendar,
  Clock,
  Zap,
  ChevronDown,
  ArrowUp,
  X,
  Hash,
  Cpu,
  Folder,
  Settings2,
} from 'lucide-react';
import { ipc } from '../../../hooks/use-ipc';
import { AGENT_TOOL_META, getAgentToolMeta, type ModelOption, type AgentToolKind } from '@shared';
import { useAgentStream } from '../../../hooks/use-agent-stream';
import { MessageStream } from '../../../components/agent-todo/MessageStream';
import { RunTimeline } from '../../../components/agent-todo/RunTimeline';
import { StatusDot } from '../../../components/agent-todo/StatusDot';
import { PriorityBarIcon } from '../../../components/agent-todo/PriorityBar';
import { TodoForm } from '../../../components/agent-todo/TodoForm';

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

function ModelDropdown({
  value,
  agentTool,
  agentDefaultModel,
  onChange,
}: {
  value: string | null;
  agentTool?: AgentToolKind;
  agentDefaultModel?: string;
  onChange: (val: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Get models for the agent type
  const agentMeta = agentTool ? getAgentToolMeta(agentTool) : null;
  const models: ModelOption[] = agentMeta?.models ?? [];

  // Find the selected model's label for display
  const selectedModel = models.find((m) => m.value === value);
  const defaultModel = agentDefaultModel ? models.find((m) => m.value === agentDefaultModel) : null;
  const displayLabel =
    selectedModel?.label ?? defaultModel?.label ?? agentDefaultModel ?? 'Default';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-notion-text-secondary hover:bg-notion-sidebar hover:text-notion-text transition-colors"
        title="Select model"
      >
        <Cpu size={11} className="text-notion-text-tertiary flex-shrink-0" />
        <span
          className={`font-mono max-w-[140px] truncate ${value ? 'text-notion-accent' : 'text-notion-text-tertiary'}`}
        >
          {displayLabel}
        </span>
        <ChevronDown
          size={10}
          className={`text-notion-text-tertiary transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[200px] rounded-lg border border-notion-border bg-white shadow-lg py-1 z-30">
          {/* Default option */}
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange(null);
              setOpen(false);
            }}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
              !value
                ? 'bg-notion-accent-light text-notion-accent'
                : 'text-notion-text-secondary hover:bg-notion-sidebar'
            }`}
          >
            <Cpu size={11} className="flex-shrink-0 text-notion-text-tertiary" />
            <span className="font-mono">
              Default{agentDefaultModel ? ` (${defaultModel?.label ?? agentDefaultModel})` : ''}
            </span>
          </button>
          {models.length > 0 && <div className="my-1 border-t border-notion-border" />}
          {models.map((m) => (
            <button
              key={m.value}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(m.value);
                setOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors ${
                value === m.value
                  ? 'bg-notion-accent-light text-notion-accent'
                  : 'text-notion-text hover:bg-notion-sidebar'
              }`}
            >
              <Cpu size={11} className="flex-shrink-0 text-notion-text-tertiary" />
              <div className="min-w-0">
                <span className="truncate block">{m.label}</span>
                {m.description && (
                  <span className="text-notion-text-tertiary text-[10px]">{m.description}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
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
  const [historicMessages, setHistoricMessages] = useState<any[]>([]);

  const [chatInput, setChatInput] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);
  const [showStderr, setShowStderr] = useState(true);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashMenuIndex, setSlashMenuIndex] = useState(0);
  const [showEditForm, setShowEditForm] = useState(false);

  const {
    messages: streamMessages,
    status: streamStatus,
    permissionRequest,
    setPermissionRequest,
    canChat,
    stderrLines,
    availableCommands,
  } = useAgentStream(id!);

  const filteredCommands = useMemo(() => {
    if (!slashMenuOpen) return [];
    return availableCommands.filter((c) =>
      c.name.toLowerCase().includes(slashFilter.toLowerCase()),
    );
  }, [slashMenuOpen, slashFilter, availableCommands]);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

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

  useEffect(() => {
    if (!selectedRunId) return;
    const currentRun = runs[0];
    if (
      currentRun &&
      selectedRunId === currentRun.id &&
      (currentRun.status === 'running' || streamMessages.length > 0)
    ) {
      setHistoricMessages([]);
      return;
    }
    ipc
      .getAgentTodoRunMessages(selectedRunId)
      .then((msgs) => {
        const parsed = msgs.map((m) => ({
          ...m,
          content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
        }));
        const merged: typeof parsed = [];
        const seen = new Map<string, number>();
        for (const m of parsed) {
          const existing = seen.get(m.msgId);
          if (existing !== undefined && m.type === 'text') {
            const prev = merged[existing];
            const prevText = (prev.content as { text: string }).text;
            const newText = (m.content as { text: string }).text;
            merged[existing] = { ...prev, content: { text: prevText + newText } };
          } else if (existing !== undefined && m.type === 'tool_call') {
            const prev = merged[existing];
            const prevContent = prev.content as Record<string, unknown>;
            const newContent = m.content as Record<string, unknown>;
            const mergedContent: Record<string, unknown> = { ...prevContent };
            for (const [k, v] of Object.entries(newContent)) {
              if (v !== undefined && v !== null && v !== '') mergedContent[k] = v;
            }
            merged[existing] = {
              ...prev,
              status: m.status || prev.status,
              content: mergedContent,
            };
          } else if (existing !== undefined && m.type === 'plan') {
            merged[existing] = m;
          } else {
            seen.set(m.msgId, merged.length);
            merged.push(m);
          }
        }
        setHistoricMessages(merged);
      })
      .catch(console.error);
  }, [selectedRunId, runs]);

  const displayMessages =
    selectedRunId === runs[0]?.id && streamMessages.length > 0 ? streamMessages : historicMessages;

  const latestRunStatus = runs[0]?.status ?? 'idle';
  const currentStatus =
    selectedRunId === runs[0]?.id
      ? streamStatus === 'idle'
        ? latestRunStatus
        : streamStatus
      : (runs.find((r) => r.id === selectedRunId)?.status ?? 'idle');

  // canChat: 当前会话有活跃 session，或最新 run 是 completed 且选中的是最新 run
  const effectiveCanChat =
    canChat || (currentStatus === 'completed' && selectedRunId === runs[0]?.id);

  async function handleRun() {
    setShowStderr(true);
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

  async function handleSendMessage() {
    const text = chatInput.trim();
    if (!text || isRunning || !selectedRunId || !effectiveCanChat) return;
    setChatInput('');
    setChatError(null);
    if (chatInputRef.current) chatInputRef.current.style.height = 'auto';
    try {
      await ipc.sendAgentMessage(id!, selectedRunId!, text);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (msg.includes('No active session')) {
        setChatError('No active session — click Run to start a new session first.');
      } else {
        setChatError(msg);
      }
    }
  }

  async function handleYoloToggle(val: boolean) {
    try {
      await ipc.updateAgentTodo(id!, { yoloMode: val });
      setTodo((prev: any) => ({ ...prev, yoloMode: val }));
    } catch (err) {
      console.error(err);
    }
  }

  async function handleModelChange(val: string | null) {
    try {
      await ipc.updateAgentTodo(id!, { model: val });
      setTodo((prev: any) => ({ ...prev, model: val }));
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
        setHistoricMessages([]);
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

  if (!todo) {
    return (
      <div className="flex h-full items-center justify-center text-notion-text-secondary text-sm">
        Loading...
      </div>
    );
  }

  const isRunning = currentStatus === 'running' || currentStatus === 'initializing';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-notion-border px-4 py-3 flex-shrink-0">
        <button
          onClick={() => {
            const from = (location.state as { from?: string })?.from;
            navigate(from ?? '/agent-todos');
          }}
          className="text-notion-text-secondary hover:text-notion-text transition-colors flex-shrink-0"
        >
          <ArrowLeft size={18} />
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

        {/* Right column: Prompt banner + Message Stream + Chat Input */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {/* Prompt banner at top of chat area */}
          <div className="flex-shrink-0 px-5 py-4 border-b border-notion-border">
            <p className="text-sm text-notion-text leading-relaxed line-clamp-3 whitespace-pre-wrap">
              {todo.prompt}
            </p>
          </div>

          {/* stderr output panel — shown while running */}
          {isRunning && stderrLines.length > 0 && showStderr && (
            <div className="absolute bottom-16 right-4 w-80 rounded-lg bg-gray-900 border border-gray-700 shadow-lg overflow-hidden z-10">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700">
                <span className="text-xs text-gray-400 font-mono">Agent output</span>
                <button
                  onClick={() => setShowStderr(false)}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                >
                  <X size={12} />
                </button>
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

          <div className="flex-1 overflow-y-auto">
            <MessageStream
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

          {/* Chat Input */}
          {selectedRunId && (
            <div className="flex-shrink-0 px-4 pb-4 pt-3">
              <div className="rounded-2xl border border-notion-border bg-white shadow-sm transition-all focus-within:border-notion-text-tertiary focus-within:shadow-md">
                <div className="px-4 pt-3.5 pb-2 relative">
                  {/* Slash command menu */}
                  {slashMenuOpen && filteredCommands.length > 0 && (
                    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-notion-border bg-white shadow-lg overflow-hidden z-20 max-h-52 overflow-y-auto">
                      {filteredCommands.map((cmd, i) => (
                        <button
                          key={cmd.name}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const hint = cmd.input?.hint ? ` ${cmd.input.hint}` : '';
                            setChatInput(`/${cmd.name}${hint}`);
                            setSlashMenuOpen(false);
                            chatInputRef.current?.focus();
                          }}
                          className={`w-full flex items-start gap-2 px-3 py-2 text-left transition-colors ${
                            i === slashMenuIndex
                              ? 'bg-notion-accent-light'
                              : 'hover:bg-notion-sidebar'
                          }`}
                        >
                          <Hash size={12} className="text-notion-accent mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-notion-text">{cmd.name}</span>
                            {cmd.input?.hint && (
                              <span className="ml-1.5 text-xs text-notion-text-tertiary font-mono">
                                {cmd.input.hint}
                              </span>
                            )}
                            <p className="text-xs text-notion-text-secondary truncate">
                              {cmd.description}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={chatInputRef}
                    value={chatInput}
                    onChange={(e) => {
                      const val = e.target.value;
                      setChatInput(val);
                      if (chatError) setChatError(null);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                      const slashMatch = val.match(/^\/(\S*)$/);
                      if (slashMatch && availableCommands.length > 0) {
                        setSlashFilter(slashMatch[1]);
                        setSlashMenuOpen(true);
                        setSlashMenuIndex(0);
                      } else {
                        setSlashMenuOpen(false);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (slashMenuOpen && filteredCommands.length > 0) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setSlashMenuIndex((i) => Math.min(i + 1, filteredCommands.length - 1));
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setSlashMenuIndex((i) => Math.max(i - 1, 0));
                          return;
                        }
                        if (e.key === 'Tab' || (e.key === 'Enter' && !e.nativeEvent.isComposing)) {
                          e.preventDefault();
                          const cmd = filteredCommands[slashMenuIndex];
                          if (cmd) {
                            const hint = cmd.input?.hint ? ` ${cmd.input.hint}` : '';
                            setChatInput(`/${cmd.name}${hint}`);
                          }
                          setSlashMenuOpen(false);
                          return;
                        }
                        if (e.key === 'Escape') {
                          setSlashMenuOpen(false);
                          return;
                        }
                      }
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        handleSendMessage();
                      }
                    }}
                    onBlur={() => setSlashMenuOpen(false)}
                    placeholder={
                      isRunning
                        ? 'Agent is running...'
                        : effectiveCanChat
                          ? 'Ask anything... (type / for commands)'
                          : 'Run the agent to start a conversation...'
                    }
                    disabled={isRunning || !effectiveCanChat}
                    rows={1}
                    className="w-full resize-none bg-transparent text-sm text-notion-text placeholder:text-notion-text-tertiary focus:outline-none disabled:opacity-40"
                    style={{ minHeight: '24px', maxHeight: '120px' }}
                  />
                </div>
                {/* Error message */}
                {chatError && <p className="px-4 pb-1 text-xs text-red-500">{chatError}</p>}
                {/* Bottom toolbar: + icon + model on left, send button on right */}
                <div className="flex items-center justify-between px-3 pb-3">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text-secondary transition-colors"
                      title="Attach"
                    >
                      <span className="text-base leading-none">+</span>
                    </button>
                    <ModelDropdown
                      value={todo.model ?? null}
                      agentTool={todo.agent?.agentTool}
                      agentDefaultModel={todo.agent?.defaultModel}
                      onChange={handleModelChange}
                    />
                    <button
                      type="button"
                      onClick={() => handleYoloToggle(!todo.yoloMode)}
                      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                        todo.yoloMode
                          ? 'text-amber-600 bg-amber-50 hover:bg-amber-100'
                          : 'text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text-secondary'
                      }`}
                      title={
                        todo.yoloMode
                          ? 'YOLO mode on — click to disable'
                          : 'YOLO mode off — click to enable'
                      }
                    >
                      <Zap
                        size={11}
                        className={todo.yoloMode ? 'text-amber-500' : 'text-notion-text-tertiary'}
                      />
                      <span>YOLO</span>
                    </button>
                  </div>
                  <div>
                    {isRunning ? (
                      <button
                        onClick={handleStop}
                        className="rounded-full bg-notion-text p-2 text-white hover:bg-notion-text/80 transition-colors"
                        title="Stop"
                      >
                        <Square size={13} />
                      </button>
                    ) : (
                      <button
                        onClick={handleSendMessage}
                        disabled={!chatInput.trim() || !effectiveCanChat}
                        className="rounded-full bg-notion-text p-2 text-white transition-opacity hover:opacity-80 disabled:opacity-30"
                        title="Send"
                      >
                        <ArrowUp size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
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
