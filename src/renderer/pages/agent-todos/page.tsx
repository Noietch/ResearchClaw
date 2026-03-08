import { useState, useEffect, useCallback } from 'react';
import { Bot, Plus } from 'lucide-react';
import { ipc, onIpc } from '../../hooks/use-ipc';
import type { AgentTodoItem, AgentTodoQuery } from '@shared';
import { TodoCard } from '../../components/agent-todo/TodoCard';
import { TodoForm } from '../../components/agent-todo/TodoForm';

type StatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'idle';

export function AgentTodosPage() {
  const [todos, setTodos] = useState<AgentTodoItem[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | undefined>();
  const [editValues, setEditValues] = useState<
    | {
        title?: string;
        prompt?: string;
        cwd?: string;
        agentId?: string;
        priority?: number;
        yoloMode?: boolean;
      }
    | undefined
  >();

  const loadTodos = useCallback(async () => {
    try {
      const query: AgentTodoQuery | undefined = filter !== 'all' ? { status: filter } : undefined;
      const data = await ipc.listAgentTodos(query);
      setTodos(data);
    } catch (err) {
      console.error(err);
    }
  }, [filter]);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  // Listen for status changes to refresh list
  useEffect(() => {
    const off = onIpc('agent-todo:status', () => {
      loadTodos();
    });
    return off;
  }, [loadTodos]);

  async function handleEdit(id: string) {
    try {
      const todo = await ipc.getAgentTodo(id);
      setEditId(id);
      setEditValues({
        title: todo.title,
        prompt: todo.prompt,
        cwd: todo.cwd,
        agentId: todo.agentId,
        priority: todo.priority,
        yoloMode: todo.yoloMode,
      });
      setShowForm(true);
    } catch (err) {
      console.error(err);
    }
  }

  const filters: Array<{ id: StatusFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'running', label: 'Running' },
    { id: 'completed', label: 'Completed' },
    { id: 'failed', label: 'Failed' },
    { id: 'idle', label: 'Idle' },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot size={22} className="text-notion-text-tertiary" />
          <h1 className="text-2xl font-bold tracking-tight text-notion-text">Agent Tasks</h1>
        </div>
        <button
          onClick={() => {
            setEditId(undefined);
            setEditValues(undefined);
            setShowForm(true);
          }}
          className="flex items-center gap-2 rounded-md bg-notion-accent px-3 py-2 text-sm font-medium text-white hover:bg-notion-accent/90 transition-colors"
        >
          <Plus size={14} />
          New Task
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-1">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
              filter === f.id
                ? 'bg-notion-accent-light text-notion-accent font-medium'
                : 'text-notion-text-secondary hover:bg-notion-accent-light hover:text-notion-text'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Todo List */}
      <div className="space-y-3">
        {todos.length === 0 ? (
          <div className="py-16 text-center text-notion-text-secondary">
            <Bot size={32} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">No agent tasks yet.</p>
            <p className="text-xs mt-1">Create one to get started.</p>
          </div>
        ) : (
          todos.map((todo) => (
            <TodoCard key={todo.id} todo={todo} onRefresh={loadTodos} onEdit={handleEdit} />
          ))
        )}
      </div>

      {/* Form Modal */}
      <TodoForm
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditId(undefined);
          setEditValues(undefined);
        }}
        onSuccess={loadTodos}
        editId={editId}
        initialValues={editValues}
      />
    </div>
  );
}
