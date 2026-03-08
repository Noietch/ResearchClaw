import { useNavigate } from 'react-router-dom';
import { Play, Square, Settings2, Trash2, User, Folder, Clock } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';
import type { AgentTodoItem } from '@shared';
import { StatusDot } from './StatusDot';
import { PriorityBarIcon } from './PriorityBar';

interface TodoCardProps {
  todo: AgentTodoItem;
  onRefresh: () => void;
  onEdit?: (id: string) => void;
  /** Path to navigate back to from detail page */
  from?: string;
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

export function TodoCard({ todo, onRefresh, onEdit, from }: TodoCardProps) {
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
      className="group bg-white border border-notion-border rounded-lg p-4 hover:bg-notion-sidebar hover:border-notion-border transition-colors duration-150 cursor-pointer"
      onClick={() => navigate(`/agent-todos/${todo.id}`, { state: { from } })}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Line 1: Title + Status + Priority */}
          <div className="flex items-center gap-2">
            <StatusDot status={todo.status} />
            <h3 className="font-medium text-notion-text truncate">{todo.title}</h3>
            {todo.priority > 0 && (
              <span className="flex items-center gap-1 flex-shrink-0">
                <PriorityBarIcon value={todo.priority} />
              </span>
            )}
          </div>

          {/* Line 2: Agent + Cwd + Time */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-notion-text-secondary mt-1">
            {/* Agent */}
            <span className="inline-flex items-center gap-1">
              <User size={10} className="text-notion-text-tertiary" />
              <span>
                {todo.agent.name}{' '}
                <span className="text-notion-text-tertiary">({todo.agent.backend})</span>
              </span>
            </span>

            {/* Working directory */}
            <span className="inline-flex items-center gap-1 min-w-0">
              <Folder size={10} className="text-notion-text-tertiary flex-shrink-0" />
              <span className="font-mono truncate">{todo.cwd}</span>
            </span>

            {/* Last run time */}
            <span className="inline-flex items-center gap-1">
              <Clock size={10} className="text-notion-text-tertiary" />
              <span>{todo.lastRunAt ? formatRelative(todo.lastRunAt) : 'Never run'}</span>
            </span>
          </div>
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
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-notion-text-secondary hover:bg-notion-sidebar-hover transition-colors"
              title="Run"
            >
              <Play size={12} /> Run
            </button>
          )}
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(todo.id);
              }}
              className="rounded p-1 text-notion-text-secondary hover:bg-notion-sidebar-hover transition-colors"
              title="Edit"
            >
              <Settings2 size={14} />
            </button>
          )}
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
