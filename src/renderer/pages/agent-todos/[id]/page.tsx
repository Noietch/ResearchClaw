import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square } from 'lucide-react';
import { ipc } from '../../../hooks/use-ipc';
import { useAgentStream } from '../../../hooks/use-agent-stream';
import { MessageStream } from '../../../components/agent-todo/MessageStream';
import { RunTimeline } from '../../../components/agent-todo/RunTimeline';
import { StatusDot } from '../../../components/agent-todo/StatusDot';

export function AgentTodoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [todo, setTodo] = useState<any>(null);
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [historicMessages, setHistoricMessages] = useState<any[]>([]);

  const {
    messages: streamMessages,
    status: streamStatus,
    permissionRequest,
    setPermissionRequest,
  } = useAgentStream(id!);

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
      // Auto-select latest run
      if (runsData.length > 0 && !selectedRunId) {
        setSelectedRunId(runsData[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  useEffect(() => {
    if (!selectedRunId) return;
    // If it's the current running run, use stream messages
    const currentRun = runs[0];
    if (
      currentRun &&
      selectedRunId === currentRun.id &&
      (currentRun.status === 'running' || streamMessages.length > 0)
    ) {
      setHistoricMessages([]);
      return;
    }
    // Otherwise load from DB
    ipc
      .getAgentTodoRunMessages(selectedRunId)
      .then((msgs) => {
        setHistoricMessages(
          msgs.map((m) => ({
            ...m,
            content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
          })),
        );
      })
      .catch(console.error);
  }, [selectedRunId, runs]);

  const displayMessages =
    selectedRunId === runs[0]?.id && streamMessages.length > 0 ? streamMessages : historicMessages;

  const currentStatus =
    selectedRunId === runs[0]?.id
      ? streamStatus
      : (runs.find((r) => r.id === selectedRunId)?.status ?? 'idle');

  async function handleRun() {
    try {
      await ipc.runAgentTodo(id!);
      await loadData();
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
          onClick={() => navigate('/agent-todos')}
          className="text-notion-text-secondary hover:text-notion-text transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-notion-text truncate">{todo.title}</h1>
          <p className="text-xs text-notion-text-secondary">
            {todo.agent.name} · <span className="font-mono">{todo.cwd}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusDot status={currentStatus} />
          <span className="text-sm text-notion-text-secondary capitalize">{currentStatus}</span>
          {isRunning ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1 rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
            >
              <Square size={12} /> Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              className="flex items-center gap-1 rounded-md bg-notion-accent px-3 py-1.5 text-xs text-white hover:bg-notion-accent/90 transition-colors"
            >
              <Play size={12} /> Run
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Run Timeline */}
        <RunTimeline runs={runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto">
          <MessageStream
            messages={displayMessages}
            todoId={id!}
            permissionRequest={permissionRequest}
            onPermissionResolved={() => {
              setPermissionRequest(null);
              loadData();
            }}
          />
        </div>
      </div>
    </div>
  );
}
