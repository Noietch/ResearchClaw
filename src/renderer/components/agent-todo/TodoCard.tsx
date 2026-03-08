import { useNavigate } from 'react-router-dom';
import { Play, Square, Settings2, Trash2 } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';
import type { AgentTodoItem } from '@shared';
import { StatusDot } from './StatusDot';

interface TodoCardProps {
  todo: AgentTodoItem;
  onRefresh: () => void;
  onEdit: (id: string) => void;
}

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function TodoCard({ todo, onRefresh, onEdit }: TodoCardProps) {
  const navigate = useNavigate();

  async function handleRun(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await ipc.runAgentTodo(todo.id);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleStop(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await ipc.stopAgentTodo(todo.id);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete "${todo.title}"?`)) return;
    try {
      await ipc.deleteAgentTodo(todo.id);
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  }

  const isRunning = todo.status === 'running';

  return (
    <div
      className="group bg-white border border-notion-border rounded-lg p-4 hover:bg-notion-accent-light hover:border-notion-accent/30 transition-colors duration-150 cursor-pointer"
      onClick={() => navigate(`/agent-todos/${todo.id}`)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusDot status={todo.status} />
            <h3 className="font-medium text-notion-text truncate">{todo.title}</h3>
            {todo.yoloMode && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex-shrink-0">
                YOLO
              </span>
            )}
          </div>

          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-notion-accent-light text-notion-accent text-xs rounded-full mb-1">
            {todo.agent.name}
          </span>

          <p className="text-xs text-notion-text-secondary font-mono truncate mt-1">{todo.cwd}</p>

          <p className="text-xs text-notion-text-secondary mt-1">
            {todo.lastRunAt
              ? `Last run: ${formatRelative(todo.lastRunAt)} · ${todo.status}`
              : 'Never run'}
            {todo.cronEnabled && todo.cronExpr && ` · Cron: ${todo.cronExpr}`}
          </p>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {isRunning ? (
            <button
              onClick={handleStop}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 transition-colors"
              title="Stop"
            >
              <Square size={12} /> Stop
            </button>
          ) : (
            <button
              onClick={handleRun}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-notion-accent hover:bg-notion-accent-light transition-colors"
              title="Run"
            >
              <Play size={12} /> Run
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(todo.id);
            }}
            className="rounded p-1 text-notion-text-secondary hover:bg-notion-accent-light transition-colors"
            title="Edit"
          >
            <Settings2 size={14} />
          </button>
          <button
            onClick={handleDelete}
            className="rounded p-1 text-notion-text-secondary hover:bg-red-50 hover:text-red-500 transition-colors"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
