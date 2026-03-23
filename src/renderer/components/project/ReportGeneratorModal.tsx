import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc, onIpc } from '../../hooks/use-ipc';
import type { AgentTodoItem, TaskResultItem } from '@shared';
import { X, Loader2, Sparkles, Check, FileText, Image, FileCode, File } from 'lucide-react';
import clsx from 'clsx';

interface ReportGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onSuccess: () => void;
}

const FILE_TYPE_ICONS: Record<string, React.ElementType> = {
  data: FileCode,
  figure: Image,
  log: FileText,
  document: FileText,
  other: File,
};

export function ReportGeneratorModal({
  isOpen,
  onClose,
  projectId,
  onSuccess,
}: ReportGeneratorModalProps) {
  const [tasks, setTasks] = useState<AgentTodoItem[]>([]);
  const [results, setResults] = useState<TaskResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [selectedTasks, setSelectedTasks] = useState<Set<string>>(new Set());
  const [selectedResults, setSelectedResults] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [taskData, resultData] = await Promise.all([
        ipc.listAgentTodos({ projectId }),
        ipc.listTaskResults({ projectId }),
      ]);
      setTasks(taskData);
      setResults(resultData);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (isOpen) {
      loadData();
      setTitle(`Research Report - ${new Date().toLocaleDateString()}`);
      setSelectedTasks(new Set());
      setSelectedResults(new Set());
      setStreamingContent('');
      setError(null);
    }
  }, [isOpen, loadData]);

  useEffect(() => {
    if (!isOpen) return;

    const unsubChunk = onIpc('report:generate:chunk', (...args: unknown[]) => {
      const chunk = args[1] as string;
      setStreamingContent((prev) => prev + chunk);
    });

    const unsubDone = onIpc('report:generate:done', () => {
      setGenerating(false);
      onSuccess();
    });

    const unsubError = onIpc('report:generate:error', (...args: unknown[]) => {
      const msg = args[1] as string;
      setGenerating(false);
      setError(msg);
    });

    return () => {
      unsubChunk();
      unsubDone();
      unsubError();
    };
  }, [isOpen, onSuccess]);

  const toggleTask = (taskId: string) => {
    const newSet = new Set(selectedTasks);
    if (newSet.has(taskId)) {
      newSet.delete(taskId);
    } else {
      newSet.add(taskId);
    }
    setSelectedTasks(newSet);
  };

  const toggleResult = (resultId: string) => {
    const newSet = new Set(selectedResults);
    if (newSet.has(resultId)) {
      newSet.delete(resultId);
    } else {
      newSet.add(resultId);
    }
    setSelectedResults(newSet);
  };

  const handleGenerate = async () => {
    if (!title.trim()) {
      setError('Please enter a report title');
      return;
    }
    if (selectedTasks.size === 0) {
      setError('Please select at least one task');
      return;
    }

    setGenerating(true);
    setStreamingContent('');
    setError(null);

    try {
      await ipc.generateReport({
        projectId,
        title: title.trim(),
        todoIds: Array.from(selectedTasks),
        resultIds: selectedResults.size > 0 ? Array.from(selectedResults) : undefined,
      });
    } catch (e) {
      setGenerating(false);
      setError(e instanceof Error ? e.message : 'Failed to generate report');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
          onKeyDown={handleKeyDown}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-notion-border px-6 py-4">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-blue-500" />
                <h3 className="text-lg font-semibold text-notion-text">Generate Report</h3>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
                </div>
              ) : generating ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-notion-text-secondary">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Generating report...</span>
                  </div>
                  <div className="rounded-lg border border-notion-border bg-gray-50 p-4">
                    <pre className="whitespace-pre-wrap text-sm text-notion-text">
                      {streamingContent || 'Starting...'}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-6">
                  {/* Left column: Task and result selection */}
                  <div className="space-y-6">
                    {/* Title input */}
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-notion-text">
                        Report Title
                      </label>
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Enter report title"
                        className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-100"
                      />
                    </div>

                    {/* Task selection */}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-notion-text">
                        Select Tasks
                      </label>
                      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-notion-border p-2">
                        {tasks.length === 0 ? (
                          <p className="py-2 text-center text-xs text-notion-text-tertiary">
                            No tasks available
                          </p>
                        ) : (
                          tasks.map((task) => (
                            <button
                              key={task.id}
                              onClick={() => toggleTask(task.id)}
                              className={clsx(
                                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                                selectedTasks.has(task.id)
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'hover:bg-notion-sidebar-hover',
                              )}
                            >
                              <div
                                className={clsx(
                                  'flex h-4 w-4 items-center justify-center rounded border',
                                  selectedTasks.has(task.id)
                                    ? 'border-blue-400 bg-blue-500 text-white'
                                    : 'border-notion-border',
                                )}
                              >
                                {selectedTasks.has(task.id) && <Check size={10} />}
                              </div>
                              <span className="truncate">{task.title}</span>
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Result selection */}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-notion-text">
                        Select Results (optional)
                      </label>
                      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-notion-border p-2">
                        {results.length === 0 ? (
                          <p className="py-2 text-center text-xs text-notion-text-tertiary">
                            No results available
                          </p>
                        ) : (
                          results.map((result) => {
                            const Icon = FILE_TYPE_ICONS[result.fileType] ?? File;
                            return (
                              <button
                                key={result.id}
                                onClick={() => toggleResult(result.id)}
                                className={clsx(
                                  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                                  selectedResults.has(result.id)
                                    ? 'bg-blue-50 text-blue-600'
                                    : 'hover:bg-notion-sidebar-hover',
                                )}
                              >
                                <div
                                  className={clsx(
                                    'flex h-4 w-4 items-center justify-center rounded border',
                                    selectedResults.has(result.id)
                                      ? 'border-blue-400 bg-blue-500 text-white'
                                      : 'border-notion-border',
                                  )}
                                >
                                  {selectedResults.has(result.id) && <Check size={10} />}
                                </div>
                                <Icon
                                  size={14}
                                  className="flex-shrink-0 text-notion-text-tertiary"
                                />
                                <span className="truncate">{result.fileName}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Right column: Preview / Info */}
                  <div className="space-y-4">
                    <div className="rounded-lg border border-notion-border bg-notion-sidebar p-4">
                      <h4 className="mb-2 text-sm font-medium text-notion-text">
                        What will happen?
                      </h4>
                      <ul className="space-y-1 text-xs text-notion-text-secondary">
                        <li>• AI will analyze selected tasks and results</li>
                        <li>• Generate a comprehensive Markdown report</li>
                        <li>• Include task summaries and key findings</li>
                        <li>• Save to database and file system</li>
                      </ul>
                    </div>

                    <div className="rounded-lg border border-notion-border bg-blue-50 p-4">
                      <h4 className="mb-1 text-sm font-medium text-blue-800">Tips</h4>
                      <p className="text-xs text-blue-700">
                        Select completed tasks for best results. Include result files (data,
                        figures) to get more detailed reports.
                      </p>
                    </div>

                    {error && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                        {error}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {!generating && (
              <div className="flex justify-end gap-2 border-t border-notion-border px-6 py-4">
                <button
                  onClick={onClose}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-notion-text-secondary hover:bg-notion-sidebar-hover"
                >
                  Cancel
                </button>
                <motion.button
                  onClick={handleGenerate}
                  disabled={selectedTasks.size === 0 || !title.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <Sparkles size={14} />
                  Generate Report
                </motion.button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
