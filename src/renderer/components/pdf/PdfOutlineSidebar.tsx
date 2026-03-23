import { useState, useEffect, useCallback } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronRight, List } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface OutlineNode {
  title: string;
  pageNumber: number;
  children: OutlineNode[];
}

interface PdfOutlineSidebarProps {
  document: PDFDocumentProxy;
  onGoToPage: (page: number) => void;
  currentPage: number;
}

async function resolveOutline(
  doc: PDFDocumentProxy,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[],
): Promise<OutlineNode[]> {
  const nodes: OutlineNode[] = [];

  for (const item of items) {
    let pageNumber = 1;
    try {
      if (item.dest) {
        const dest =
          typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
        if (dest && dest[0]) {
          const pageIndex = await doc.getPageIndex(dest[0]);
          pageNumber = pageIndex + 1;
        }
      }
    } catch {
      // fallback to page 1
    }

    const children =
      item.items && item.items.length > 0 ? await resolveOutline(doc, item.items) : [];

    nodes.push({ title: item.title, pageNumber, children });
  }

  return nodes;
}

function OutlineItem({
  node,
  depth,
  onGoToPage,
  currentPage,
}: {
  node: OutlineNode;
  depth: number;
  onGoToPage: (page: number) => void;
  currentPage: number;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = node.children.length > 0;
  const isActive = node.pageNumber === currentPage;

  return (
    <div>
      <button
        onClick={() => onGoToPage(node.pageNumber)}
        className={`flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-sm transition-colors duration-100 ${
          isActive
            ? 'bg-blue-50 text-blue-600 font-medium'
            : 'text-notion-text hover:bg-notion-sidebar-hover'
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        title={`${node.title} (p. ${node.pageNumber})`}
      >
        {hasChildren ? (
          <span
            role="button"
            className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded hover:bg-notion-border"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <motion.span
              animate={{ rotate: expanded ? 90 : 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-center"
            >
              <ChevronRight size={12} />
            </motion.span>
          </span>
        ) : (
          <span className="w-4 flex-shrink-0" />
        )}
        <span className="truncate">{node.title}</span>
        <span className="ml-auto flex-shrink-0 text-xs text-notion-text-tertiary">
          {node.pageNumber}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {hasChildren && expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {node.children.map((child, i) => (
              <OutlineItem
                key={`${child.title}-${i}`}
                node={child}
                depth={depth + 1}
                onGoToPage={onGoToPage}
                currentPage={currentPage}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function PdfOutlineSidebar({ document, onGoToPage, currentPage }: PdfOutlineSidebarProps) {
  const [outline, setOutline] = useState<OutlineNode[] | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOutline = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await document.getOutline();
      if (!raw || raw.length === 0) {
        setOutline([]);
      } else {
        const resolved = await resolveOutline(document, raw);
        setOutline(resolved);
      }
    } catch {
      setOutline([]);
    } finally {
      setLoading(false);
    }
  }, [document]);

  useEffect(() => {
    loadOutline();
  }, [loadOutline]);

  return (
    <div className="flex h-full w-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-notion-border px-3 py-2">
        <List size={14} className="text-notion-text-secondary" />
        <span className="text-sm font-medium text-notion-text">Outline</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-1 py-1">
        {loading && (
          <div className="px-3 py-4 text-xs text-notion-text-tertiary">Loading outline...</div>
        )}

        {!loading && outline && outline.length === 0 && (
          <div className="px-3 py-4 text-xs text-notion-text-tertiary">No outline available</div>
        )}

        {!loading &&
          outline &&
          outline.length > 0 &&
          outline.map((node, i) => (
            <OutlineItem
              key={`${node.title}-${i}`}
              node={node}
              depth={0}
              onGoToPage={onGoToPage}
              currentPage={currentPage}
            />
          ))}
      </div>
    </div>
  );
}
