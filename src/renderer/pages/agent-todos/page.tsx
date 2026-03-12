import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bot, ChevronDown, ChevronRight, FolderOpen, ArrowRight } from 'lucide-react';
import { ipc, onIpc } from '../../hooks/use-ipc';
import type { ProjectItem } from '../../hooks/use-ipc';
import type { AgentTodoItem } from '@shared';
import { TodoCard } from '../../components/agent-todo/TodoCard';
import { StatusDot } from '../../components/agent-todo/StatusDot';
import { TodoForm } from '../../components/agent-todo/TodoForm';

type StatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'idle';

interface ProjectGroup {
  projectId: string | null;
  projectName: string;
  todos: AgentTodoItem[];
}

export function AgentTodosPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [todos, setTodos] = useState<AgentTodoItem[]>([]);
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editTodo, setEditTodo] = useState<AgentTodoItem | null>(null);
  const [showForm, setShowForm] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [todosData, projectsData] = await Promise.all([
        ipc.listAgentTodos(),
        ipc.listProjects(),
      ]);
      setTodos(todosData);
      setProjects(projectsData);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for status changes to refresh list
  useEffect(() => {
    const off = onIpc('agent-todo:status', () => {
      loadData();
    });
    return off;
  }, [loadData]);

  const toggleCollapsed = (groupId: string) => {
    setCollapsed((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  function handleEdit(id: string) {
    const todo = todos.find((t) => t.id === id);
    if (todo) {
      setEditTodo(todo);
      setShowForm(true);
    }
  }

  const filters: Array<{ id: StatusFilter; label: string }> = [
    { id: 'all', label: t('agentTodos.filters.all') },
    { id: 'running', label: t('agentTodos.filters.running') },
    { id: 'completed', label: t('agentTodos.filters.completed') },
    { id: 'failed', label: t('agentTodos.filters.failed') },
    { id: 'idle', label: t('agentTodos.filters.idle') },
  ];

  // Apply status filter and exclude chat sessions (titles starting with "Chat: ")
  const filteredTodos = (
    filter === 'all' ? todos : todos.filter((t) => t.status === filter)
  ).filter((t) => !t.title.startsWith('Chat: '));

  // Build project groups
  const projectMap = new Map<string, ProjectItem>(projects.map((p) => [p.id, p]));

  const groupMap = new Map<string | null, AgentTodoItem[]>();
  for (const todo of filteredTodos) {
    const key = todo.projectId ?? null;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(todo);
  }

  // Build ordered groups: assigned projects first (by project name), then unassigned
  const groups: ProjectGroup[] = [];

  // Add groups for known projects (in project list order)
  for (const project of projects) {
    const todosInGroup = groupMap.get(project.id);
    if (todosInGroup && todosInGroup.length > 0) {
      groups.push({ projectId: project.id, projectName: project.name, todos: todosInGroup });
    }
  }

  // Add any todos with a projectId not in the projects list (orphaned)
  for (const [key, todosInGroup] of groupMap.entries()) {
    if (key !== null && !projectMap.has(key)) {
      groups.push({ projectId: key, projectName: 'Unknown Project', todos: todosInGroup });
    }
  }

  // Unassigned last
  const unassigned = groupMap.get(null);
  if (unassigned && unassigned.length > 0) {
    groups.push({ projectId: null, projectName: 'Unassigned', todos: unassigned });
  }

  const totalFiltered = filteredTodos.length;

  return (
    <div className="mx-auto max-w-3xl">
      {/* Header */}
      <div className="mb-6 flex items-center">
        <div className="flex items-center gap-3">
          <Bot size={22} className="text-notion-text-tertiary" />
          <h1 className="text-2xl font-bold tracking-tight text-notion-text">Tasks</h1>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex gap-1">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              filter === f.id
                ? 'bg-notion-sidebar-hover text-notion-text font-medium'
                : 'text-notion-text-secondary hover:bg-notion-sidebar hover:text-notion-text'
            }`}
          >
            {f.id !== 'all' && <StatusDot status={f.id} size="sm" />}
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {totalFiltered === 0 ? (
        <div className="py-16 text-center text-notion-text-secondary">
          <Bot size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">No tasks yet.</p>
          <button
            onClick={() => navigate('/projects')}
            className="mt-2 inline-flex items-center gap-1 text-xs text-notion-text hover:underline"
          >
            Create tasks from a Project's Tasks tab
            <ArrowRight size={12} />
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const groupKey = group.projectId ?? '__unassigned__';
            const isCollapsed = collapsed[groupKey] ?? false;

            return (
              <div key={groupKey}>
                {/* Group header */}
                <button
                  onClick={() => toggleCollapsed(groupKey)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-notion-sidebar transition-colors"
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} className="text-notion-text-tertiary flex-shrink-0" />
                  ) : (
                    <ChevronDown size={14} className="text-notion-text-tertiary flex-shrink-0" />
                  )}
                  <FolderOpen size={14} className="text-notion-text-tertiary flex-shrink-0" />
                  <span className="text-sm font-medium text-notion-text">{group.projectName}</span>
                  <span className="ml-1 text-xs text-notion-text-tertiary">
                    {group.todos.length}
                  </span>
                </button>

                {/* Group tasks */}
                {!isCollapsed && (
                  <div className="mt-2 space-y-3 pl-4">
                    {group.todos.map((todo) => (
                      <TodoCard
                        key={todo.id}
                        todo={todo}
                        onRefresh={loadData}
                        onEdit={handleEdit}
                        from="/agent-todos"
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit Form */}
      <TodoForm
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditTodo(null);
        }}
        onSuccess={loadData}
        editId={editTodo?.id}
        initialValues={
          editTodo
            ? {
                title: editTodo.title,
                prompt: editTodo.prompt,
                cwd: editTodo.cwd,
                agentId: editTodo.agentId,
                priority: editTodo.priority,
                yoloMode: editTodo.yoloMode,
              }
            : undefined
        }
      />
    </div>
  );
}
