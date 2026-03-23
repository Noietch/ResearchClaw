import { useNavigate } from 'react-router-dom';
import { X, ExternalLink, ArrowUpRight, ArrowDownLeft, Crown } from 'lucide-react';
import type { GraphNode, GraphData } from '@shared';

interface GraphNodeDetailProps {
  node: GraphNode;
  graphData: GraphData;
  onClose: () => void;
  onNodeSelect: (nodeId: string) => void;
}

export function GraphNodeDetail({ node, graphData, onClose, onNodeSelect }: GraphNodeDetailProps) {
  const navigate = useNavigate();

  const references = graphData.edges
    .filter((e) => e.source === node.id)
    .map((e) => ({
      edge: e,
      node: graphData.nodes.find((n) => n.id === e.target),
    }))
    .filter((r) => r.node);

  const citedBy = graphData.edges
    .filter((e) => e.target === node.id)
    .map((e) => ({
      edge: e,
      node: graphData.nodes.find((n) => n.id === e.source),
    }))
    .filter((r) => r.node);

  return (
    <div className="flex h-full w-72 flex-col border-l border-notion-border bg-white">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 border-b border-notion-border p-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-notion-text leading-snug">{node.title}</h3>
          {node.authors.length > 0 && (
            <p className="mt-1 text-xs text-notion-text-tertiary truncate">
              {node.authors.join(', ')}
            </p>
          )}
          {node.year && <p className="mt-0.5 text-xs text-notion-text-tertiary">{node.year}</p>}
        </div>
        <button
          onClick={onClose}
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-3 border-b border-notion-border px-4 py-3">
        <div className="text-center">
          <div className="text-lg font-semibold text-notion-text">{node.referenceCount}</div>
          <div className="text-[10px] text-notion-text-tertiary">References</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold text-notion-text">{node.citationCount}</div>
          <div className="text-[10px] text-notion-text-tertiary">Cited by</div>
        </div>
        {node.pageRank !== undefined && (
          <div className="text-center">
            <div className="flex items-center gap-0.5 text-lg font-semibold text-notion-text">
              <Crown size={12} className="text-yellow-500" />
              {(node.pageRank * 100).toFixed(1)}
            </div>
            <div className="text-[10px] text-notion-text-tertiary">PageRank</div>
          </div>
        )}
      </div>

      {/* Tags */}
      {node.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-notion-border px-4 py-3">
          {node.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-notion-sidebar px-1.5 py-0.5 text-[10px] text-notion-text-secondary"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* References & Citations lists */}
      <div className="flex-1 overflow-y-auto notion-scrollbar">
        {references.length > 0 && (
          <div className="px-4 py-3">
            <h4 className="mb-2 flex items-center gap-1 text-xs font-medium text-notion-text">
              <ArrowUpRight size={12} className="text-notion-text-tertiary" />
              References ({references.length})
            </h4>
            <div className="flex flex-col gap-1">
              {references.map((r) => (
                <button
                  key={r.edge.id}
                  onClick={() => onNodeSelect(r.node!.id)}
                  className="rounded-md px-2 py-1.5 text-left text-xs text-notion-text-secondary hover:bg-blue-50 hover:text-notion-text transition-colors"
                >
                  <span className="line-clamp-2">{r.node!.title}</span>
                  {!r.node!.isInLibrary && (
                    <span className="mt-0.5 block text-[10px] text-notion-text-tertiary italic">
                      External
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {citedBy.length > 0 && (
          <div className="px-4 py-3">
            <h4 className="mb-2 flex items-center gap-1 text-xs font-medium text-notion-text">
              <ArrowDownLeft size={12} className="text-notion-text-tertiary" />
              Cited by ({citedBy.length})
            </h4>
            <div className="flex flex-col gap-1">
              {citedBy.map((r) => (
                <button
                  key={r.edge.id}
                  onClick={() => onNodeSelect(r.node!.id)}
                  className="rounded-md px-2 py-1.5 text-left text-xs text-notion-text-secondary hover:bg-blue-50 hover:text-notion-text transition-colors"
                >
                  <span className="line-clamp-2">{r.node!.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Action button */}
      {node.isInLibrary && (
        <div className="border-t border-notion-border p-4">
          <button
            onClick={() => navigate(`/papers/${node.shortId}`)}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white transition-colors hover:bg-blue-500/90"
          >
            <ExternalLink size={13} />
            View Paper
          </button>
        </div>
      )}
    </div>
  );
}
