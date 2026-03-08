import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';
import { AgentSelector } from './AgentSelector';
import { CwdPicker } from './CwdPicker';

interface TodoFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editId?: string;
  initialValues?: {
    title?: string;
    prompt?: string;
    cwd?: string;
    agentId?: string;
    priority?: number;
    yoloMode?: boolean;
  };
}

export function TodoForm({ isOpen, onClose, onSuccess, editId, initialValues }: TodoFormProps) {
  const [title, setTitle] = useState(initialValues?.title ?? '');
  const [prompt, setPrompt] = useState(initialValues?.prompt ?? '');
  const [cwd, setCwd] = useState(initialValues?.cwd ?? '');
  const [agentId, setAgentId] = useState(initialValues?.agentId ?? '');
  const [priority, setPriority] = useState(initialValues?.priority ?? 0);
  const [yoloMode, setYoloMode] = useState(initialValues?.yoloMode ?? false);
  const [showAdvanced, setShowAdvanced] = useState(false);
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
        await ipc.createAgentTodo({ title, prompt, cwd, agentId, priority, yoloMode });
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

              {/* Advanced */}
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-sm text-notion-text-secondary hover:text-notion-text flex items-center gap-1"
                >
                  <span>{showAdvanced ? '▼' : '▶'}</span> Advanced
                </button>
                {showAdvanced && (
                  <div className="mt-3 space-y-3 rounded-md border border-notion-border p-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={yoloMode}
                        onChange={(e) => setYoloMode(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm text-notion-text">
                        YOLO Mode (auto-approve all permissions)
                      </span>
                    </label>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-notion-text">
                        Priority
                      </label>
                      <div className="flex gap-3">
                        {[
                          { label: 'Normal', value: 0 },
                          { label: 'High', value: 1 },
                          { label: 'Urgent', value: 2 },
                        ].map((p) => (
                          <label key={p.value} className="flex items-center gap-1 cursor-pointer">
                            <input
                              type="radio"
                              name="priority"
                              checked={priority === p.value}
                              onChange={() => setPriority(p.value)}
                            />
                            <span className="text-sm text-notion-text">{p.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md px-4 py-2 text-sm text-notion-text-secondary hover:bg-notion-accent-light transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-notion-accent px-4 py-2 text-sm font-medium text-white hover:bg-notion-accent/90 disabled:opacity-50 transition-colors"
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
