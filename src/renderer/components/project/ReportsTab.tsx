import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ipc, type ProjectItem, onIpc } from '../../hooks/use-ipc';
import type { ExperimentReportItem, TaskResultItem, AgentTodoItem } from '@shared';
import { FileText, Plus, Trash2, Loader2, ExternalLink, Sparkles, File } from 'lucide-react';
import clsx from 'clsx';
import { ReportGeneratorModal } from './ReportGeneratorModal';

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ReportsTab({ project }: { project: ProjectItem }) {
  const [reports, setReports] = useState<ExperimentReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerator, setShowGenerator] = useState(false);
  const [selectedReport, setSelectedReport] = useState<ExperimentReportItem | null>(null);

  const loadReports = useCallback(async () => {
    try {
      const data = await ipc.listReports(project.id);
      setReports(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleDelete = async (reportId: string) => {
    if (!confirm('Delete this report?')) return;
    try {
      await ipc.deleteReport(reportId);
      await loadReports();
      if (selectedReport?.id === reportId) {
        setSelectedReport(null);
      }
    } catch (e) {
      console.error('[deleteReport] failed:', e);
    }
  };

  const handleOpenFile = async (reportId: string) => {
    try {
      // Report file path: {workdir}/reports/{reportId}.md
      const workdir = project.workdir;
      if (workdir) {
        const { shell } = window.require ? window.require('electron') : { shell: null };
        if (shell) {
          const path = `${workdir}/reports/${reportId}.md`;
          shell.openPath(path);
        }
      }
    } catch (e) {
      console.error('[openFile] failed:', e);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 size={20} className="animate-spin text-notion-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Reports list */}
      <div className="w-80 flex-shrink-0 space-y-4">
        <motion.button
          onClick={() => setShowGenerator(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-notion-text px-3 py-2 text-sm font-medium text-white hover:opacity-80"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <Plus size={14} />
          Generate Report
        </motion.button>

        {reports.length === 0 ? (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="py-8 text-center text-sm text-notion-text-tertiary"
          >
            No reports yet. Generate a report from your task results.
          </motion.p>
        ) : (
          <div className="space-y-2">
            {reports.map((report) => (
              <motion.div
                key={report.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => setSelectedReport(report)}
                className={clsx(
                  'group cursor-pointer rounded-lg border p-3 transition-colors',
                  selectedReport?.id === report.id
                    ? 'border-notion-accent/50 bg-notion-accent-light'
                    : 'border-notion-border bg-white hover:border-notion-accent/30 hover:bg-notion-accent-light',
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 rounded-lg bg-blue-50 p-1.5 text-blue-600">
                    <FileText size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-notion-text">{report.title}</p>
                    <p className="truncate text-xs text-notion-text-tertiary">
                      {formatDate(report.generatedAt)}
                      {report.modelUsed && ` • ${report.modelUsed}`}
                    </p>
                    {report.summary && (
                      <p className="mt-1 line-clamp-2 text-xs text-notion-text-secondary">
                        {report.summary}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenFile(report.id);
                    }}
                    className="rounded p-1 text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text"
                    title="Open file"
                  >
                    <ExternalLink size={12} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(report.id);
                    }}
                    className="rounded p-1 text-notion-text-tertiary hover:bg-red-50 hover:text-red-500"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Report preview */}
      <div className="flex-1">
        {selectedReport ? (
          <motion.div
            key={selectedReport.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="rounded-lg border border-notion-border bg-white p-6"
          >
            <h2 className="mb-4 text-xl font-bold text-notion-text">{selectedReport.title}</h2>
            <div className="mb-4 flex gap-3 text-xs text-notion-text-tertiary">
              <span>Generated: {formatDate(selectedReport.generatedAt)}</span>
              {selectedReport.modelUsed && <span>Model: {selectedReport.modelUsed}</span>}
              <span>Version: {selectedReport.version}</span>
            </div>
            <div className="prose prose-sm max-w-none">
              <MarkdownContent content={selectedReport.content} />
            </div>
          </motion.div>
        ) : (
          <div className="flex h-64 flex-col items-center justify-center text-notion-text-tertiary">
            <File size={48} strokeWidth={1.2} className="mb-3 text-notion-border" />
            <p className="text-sm">Select a report to preview</p>
          </div>
        )}
      </div>

      {/* Report Generator Modal */}
      <ReportGeneratorModal
        isOpen={showGenerator}
        onClose={() => setShowGenerator(false)}
        projectId={project.id}
        onSuccess={() => {
          loadReports();
          setShowGenerator(false);
        }}
      />
    </div>
  );
}

// Simple markdown renderer
function MarkdownContent({ content }: { content: string }) {
  // Basic markdown to HTML conversion
  const html = content
    // Headers
    .replace(/^### (.*$)/gm, '<h3 class="text-lg font-semibold mt-6 mb-2">$1</h3>')
    .replace(/^## (.*$)/gm, '<h2 class="text-xl font-semibold mt-8 mb-3">$1</h2>')
    .replace(/^# (.*$)/gm, '<h1 class="text-2xl font-bold mt-8 mb-4">$1</h1>')
    // Bold and italic
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code blocks
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre class="bg-gray-50 p-4 rounded-lg overflow-x-auto my-4"><code>$2</code></pre>',
    )
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-gray-100 px-1 rounded text-sm">$1</code>')
    // Lists
    .replace(/^- (.*$)/gm, '<li class="ml-4">$1</li>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p class="my-3">');

  return (
    <div
      className="text-sm leading-relaxed text-notion-text"
      dangerouslySetInnerHTML={{ __html: `<p class="my-3">${html}</p>` }}
    />
  );
}
