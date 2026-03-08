import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';
import { AgentSelector } from './AgentSelector';
import { CwdPicker } from './CwdPicker';
import { PriorityPicker } from './PriorityBar';

interface TodoFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editId?: string;
  projectId?: string;
  initialValues?: {
    title?: string;
    prompt?: string;
    cwd?: string;
    agentId?: string;
    priority?: number;
    yoloMode?: boolean;
  };
}

export function TodoForm({
  isOpen,
  onClose,
  onSuccess,
  editId,
  projectId,
  initialValues,
}: TodoFormProps) {
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [prompt, setPrompt] = useState(initialValues?.prompt ?? '');
  const [cwd, setCwd] = useState(initialValues?.cwd ?? '');
  const [agentId, setAgentId] = useState(initialValues?.agentId ?? '');
  const [priority, setPriority] = useState(initialValues?.priority ?? 0);
  const [yoloMode, setYoloMode] = useState(initialValues?.yoloMode ?? false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !prompt.trim() || !cwd.trim() || !agentId) {
      setError('Please fill in all required fields');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      if (editId) {
        await ipc.updateAgentTodo(editId, { title, prompt, cwd, agentId, priority, yoloMode });
      } else {
        await ipc.createAgentTodo({ title, prompt, cwd, agentId, priority, yoloMode, projectId });
      }
      onSuccess();
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-notion-text">
                {editId ? 'Edit Agent Task' : 'New Agent Task'}
              </h2>
              <button
                onClick={onClose}
                className="text-notion-text-secondary hover:text-notion-text"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-notion-text">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Refactor PDF parser module"
                  className="w-full rounded-md border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-notion-accent"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-notion-text">Agent</label>
                <AgentSelector value={agentId} onChange={setAgentId} />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-notion-text">
                  Working Directory
                </label>
                <CwdPicker value={cwd} onChange={setCwd} />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-notion-text">
                  Task Description
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={4}
                  placeholder="Describe what the agent should do..."
                  className="w-full rounded-md border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-notion-accent resize-none"
                />
              </div>

              {/* Priority */}
              <div>
                <label className="mb-2 block text-sm font-medium text-notion-text">Priority</label>
                <PriorityPicker value={priority} onChange={setPriority} />
              </div>

              {/* YOLO Mode pill toggle */}
              <div className="flex items-center justify-between rounded-lg border border-notion-border px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Zap
                    size={14}
                    className={yoloMode ? 'text-amber-500' : 'text-notion-text-tertiary'}
                  />
                  <span className="text-sm font-medium text-notion-text">YOLO Mode</span>
                  <span className="text-xs text-notion-text-tertiary">
                    auto-approve all permissions
                  </span>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={yoloMode}
                  onClick={() => setYoloMode(!yoloMode)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                    yoloMode ? 'bg-amber-500' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                      yoloMode ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm text-notion-text-secondary hover:bg-notion-accent-light transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:bg-notion-text/80 disabled:opacity-50 transition-colors"
                >
                  {submitting ? 'Saving...' : editId ? 'Save' : 'Create'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
