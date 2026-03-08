import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useTabs } from '../../../hooks/use-tabs';
import { WysiwygEditor } from '../../../components/wysiwyg-editor';
import { PdfViewer } from '../../../components/pdf-viewer';
import { ipc, type PaperItem } from '../../../hooks/use-ipc';
import { cleanArxivTitle } from '@shared';

import {
  ArrowLeft,
  Loader2,
  GripVertical,
  Download,
  PanelLeftClose,
  PanelLeftOpen,
  ExternalLink,
  BookOpen,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_TEMPLATE = `# Research Problem

> 这篇论文要解决什么问题？

# Core Method

> 提出了什么方法/架构？

# Key Results

> 主要实验结果和发现

# Strengths

> 优点和亮点

# Weaknesses

> 不足和局限

# Reproducibility Notes

> 可复现性如何？代码/数据是否公开？

# Follow-up Questions

> 后续值得探索的问题
`;

function sectionsToMarkdown(sections: Record<string, string>): string {
  return Object.entries(sections)
    .map(([heading, body]) => `# ${heading}\n\n${body}`)
    .join('\n\n');
}

function markdownToSections(md: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = md.split(/^# /m).filter(Boolean);
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const heading = (newline >= 0 ? part.slice(0, newline) : part).trim();
    const body = newline >= 0 ? part.slice(newline + 1).trim() : '';
    if (heading) sections[heading] = body;
  }
  return sections;
}

function inferPdfUrl(paper: PaperItem): string | null {
  if (paper.pdfUrl) return paper.pdfUrl;
  if (paper.sourceUrl) {
    const m = paper.sourceUrl.match(/arxiv\.org\/abs\/([\d.]+(?:v\d+)?)/i);
    if (m) return `https://arxiv.org/pdf/${m[1]}`;
  }
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(paper.shortId)) {
    return `https://arxiv.org/pdf/${paper.shortId}`;
  }
  return null;
}

function buildPdfSrc(paper: PaperItem): string | null {
  if (paper.pdfPath) return `local-file://${paper.pdfPath}`;
  return null;
}

// ─── Notes Page ───────────────────────────────────────────────────────────────

export function NotesPage() {
  const { id: shortId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { updateTabLabel, openTab } = useTabs();

  const [paper, setPaper] = useState<PaperItem | null>(null);
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState(DEFAULT_TEMPLATE);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [notesCollapsed, setNotesCollapsed] = useState(false);
  const [leftWidth, setLeftWidth] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(50);

  // Code actions
  const [paperDir, setPaperDir] = useState<string | null>(null);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [editorCommand, setEditorCommand] = useState('code');

  const MIN_WIDTH = 25;
  const MAX_WIDTH = 75;

  useEffect(() => {
    if (!shortId) return;

    Promise.all([ipc.getPaperByShortId(shortId), ipc.getSettings(), ipc.getStorageRoot()])
      .then(([p, settings, storageRoot]) => {
        setPaper(p);
        const dir = `${storageRoot}/papers/${p.shortId}`;
        setPaperDir(dir);
        setEditorCommand(settings.editorCommand ?? 'code');
        const shortTitle = p.title.replace(/^\[\d{4}\.\d{4,5}\]\s*/, '').slice(0, 30) || p.shortId;
        updateTabLabel(location.pathname, shortTitle);
        return ipc.listReading(p.id);
      })
      .then((notes) => {
        const readingNote = notes.find((n) => !n.title.startsWith('Chat:'));
        if (readingNote) {
          setCurrentNoteId(readingNote.id);
          if (readingNote.content) {
            const stringContent = Object.fromEntries(
              Object.entries(readingNote.content)
                .filter(([, value]) => typeof value === 'string')
                .map(([key, value]) => [key, value as string]),
            );
            setMarkdown(sectionsToMarkdown(stringContent));
          }
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, [shortId]);

  // Auto-save notes
  const autoSave = useCallback(
    (md: string, paperId: string, noteId: string | null) => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = setTimeout(async () => {
        const sections = markdownToSections(md);
        try {
          if (noteId) {
            await ipc.updateReading(noteId, sections);
          } else {
            const created = await ipc.createReading({
              paperId,
              type: 'paper',
              title: `Reading: ${paper?.title ?? ''}`,
              content: sections,
            });
            setCurrentNoteId(created.id);
          }
        } catch {
          /* silent */
        }
      }, 1000);
    },
    [paper],
  );

  const handleChange = useCallback(
    (value: string) => {
      setMarkdown(value);
      if (paper) autoSave(value, paper.id, currentNoteId);
    },
    [paper, currentNoteId, autoSave],
  );

  const handleOpenInEditor = useCallback(async () => {
    if (!paperDir) return;
    setOpeningEditor(true);
    try {
      await ipc.openInEditor(paperDir);
    } finally {
      setOpeningEditor(false);
    }
  }, [paperDir]);

  const handleDownloadPdf = useCallback(async () => {
    if (!paper) return;
    const pdfUrl = inferPdfUrl(paper);
    if (!pdfUrl) return;
    setDownloading(true);
    try {
      const result = await ipc.downloadPdf(paper.id, pdfUrl);
      setPaper((prev) => (prev ? { ...prev, pdfPath: result.pdfPath } : prev));
    } catch {
      /* silent */
    } finally {
      setDownloading(false);
    }
  }, [paper]);

  // Resizing
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - startXRef.current) / rect.width) * 100;
      setLeftWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidthRef.current + pct)));
    };
    const onUp = () => {
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = leftWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    setIsDragging(true);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-notion-border border-t-notion-text" />
      </div>
    );
  }

  if (!paper) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-notion-text-tertiary">
        Paper not found
      </div>
    );
  }

  const pdfSrc = buildPdfSrc(paper);

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-notion-border px-4 py-2">
        <button
          onClick={() => {
            const from = (location.state as { from?: string })?.from;
            navigate(`/papers/${paper.shortId}`, { state: from ? { from } : undefined });
          }}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar/50"
        >
          <ArrowLeft size={14} />
          <span className="max-w-[200px] truncate">{cleanArxivTitle(paper.title)}</span>
        </button>
        <div className="flex-1" />

        <button
          onClick={handleOpenInEditor}
          disabled={openingEditor}
          className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-40"
          title={`Open in ${editorCommand}`}
        >
          {openingEditor ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ExternalLink size={12} />
          )}
          Open in {editorCommand === 'cursor' ? 'Cursor' : 'VS Code'}
        </button>

        {/* Open reader */}
        <button
          onClick={() => openTab(`/papers/${paper.shortId}/reader`)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-2.5 py-1 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
        >
          <BookOpen size={12} />
          Chat
        </button>
      </div>

      {/* Split pane */}
      <div ref={containerRef} className="relative flex flex-1 overflow-hidden">
        {/* Left: Notes */}
        {!notesCollapsed && (
          <div
            className="flex flex-col border-r border-notion-border"
            style={{ width: `${leftWidth}%` }}
          >
            <div className="notion-scrollbar flex-1 overflow-y-auto">
              <WysiwygEditor
                value={markdown}
                onChange={handleChange}
                placeholder="Start writing…"
                editable={true}
              />
            </div>
          </div>
        )}

        {/* Divider */}
        {!notesCollapsed && (
          <div
            onMouseDown={handleMouseDown}
            className="group flex w-1.5 cursor-col-resize items-center justify-center bg-notion-border transition-colors hover:bg-blue-400 active:bg-blue-500"
          >
            <GripVertical size={14} className="text-white opacity-0 group-hover:opacity-100" />
          </div>
        )}

        {/* Right: PDF */}
        <div
          className="relative flex flex-col"
          style={{ width: notesCollapsed ? '100%' : `${100 - leftWidth}%` }}
        >
          <button
            onClick={() => setNotesCollapsed((v) => !v)}
            className="absolute left-2 top-2 z-10 inline-flex items-center justify-center rounded-lg border border-notion-border bg-white/90 p-1.5 shadow-sm backdrop-blur-sm text-notion-text-secondary transition-colors hover:bg-white hover:text-notion-text"
            title={notesCollapsed ? 'Show notes' : 'Hide notes'}
          >
            {notesCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>

          {pdfSrc ? (
            <PdfViewer path={pdfSrc} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-notion-sidebar">
                <Download size={24} strokeWidth={1.5} className="text-notion-text-tertiary" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-notion-text-secondary">No PDF downloaded</p>
                <p className="mt-1 text-xs text-notion-text-tertiary">Download to read locally</p>
              </div>
              {inferPdfUrl(paper) && (
                <button
                  onClick={handleDownloadPdf}
                  disabled={downloading}
                  className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-50"
                >
                  {downloading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Download size={14} />
                  )}
                  {downloading ? 'Downloading…' : 'Download PDF'}
                </button>
              )}
            </div>
          )}
        </div>

        {isDragging && <div className="absolute inset-0 z-50 cursor-col-resize" />}
      </div>
    </div>
  );
}
