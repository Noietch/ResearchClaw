import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import type { Core } from 'cytoscape';
import type { GraphData, GraphNode } from '@shared';
import { ipc } from '../../hooks/use-ipc';
import { GraphCanvas, type LayoutType } from '../../components/graph/GraphCanvas';
import { GraphToolbar } from '../../components/graph/GraphToolbar';
import { GraphNodeDetail } from '../../components/graph/GraphNodeDetail';
import { GraphEmptyState } from '../../components/graph/GraphEmptyState';

export function GraphPage() {
  const navigate = useNavigate();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<LayoutType>('cose');
  const [showGhostNodes, setShowGhostNodes] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [highlightPath, setHighlightPath] = useState<string[] | undefined>();
  const cyRef = useRef<Core | null>(null);

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await ipc.getGraphData({ includeGhostNodes: true });
      setGraphData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load graph');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Search: highlight matching nodes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !searchQuery) {
      cy?.nodes().style({ opacity: 1 });
      cy?.edges().style({ opacity: 1 });
      return;
    }

    const q = searchQuery.toLowerCase();
    cy.nodes().forEach((node) => {
      const title = (node.data('fullTitle') || '').toLowerCase();
      const matches = title.includes(q);
      node.style({ opacity: matches ? 1 : 0.15 });
    });
    cy.edges().style({ opacity: 0.15 });
  }, [searchQuery]);

  const selectedNode = graphData?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      const node = graphData?.nodes.find((n) => n.id === nodeId);
      if (node?.isInLibrary && node.shortId) {
        navigate(`/papers/${node.shortId}`);
      }
    },
    [graphData, navigate],
  );

  const handleExportPng = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const png = cy.png({ full: true, scale: 2, bg: '#ffffff' });
    const link = document.createElement('a');
    link.href = png;
    link.download = 'citation-graph.png';
    link.click();
  }, []);

  const handleExportJson = useCallback(() => {
    if (!graphData) return;
    ipc.exportGraph(graphData);
  }, [graphData]);

  const handleResetView = useCallback(() => {
    cyRef.current?.fit(undefined, 50);
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={loadGraph}
            className="mt-2 rounded-lg bg-blue-500 px-3 py-1.5 text-sm text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0) {
    return <GraphEmptyState />;
  }

  return (
    <div className="flex h-full flex-col">
      <GraphToolbar
        layout={layout}
        onLayoutChange={setLayout}
        showGhostNodes={showGhostNodes}
        onToggleGhostNodes={() => setShowGhostNodes(!showGhostNodes)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onExportPng={handleExportPng}
        onExportJson={handleExportJson}
        onResetView={handleResetView}
        nodeCount={graphData.stats.totalNodes}
        edgeCount={graphData.stats.totalEdges}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1">
          <GraphCanvas
            data={graphData}
            layout={layout}
            showGhostNodes={showGhostNodes}
            highlightPath={highlightPath}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
            onNodeDoubleClick={handleNodeDoubleClick}
            cyRef={cyRef}
          />
        </div>
        {selectedNode && (
          <GraphNodeDetail
            node={selectedNode}
            graphData={graphData}
            onClose={() => setSelectedNodeId(null)}
            onNodeSelect={setSelectedNodeId}
          />
        )}
      </div>
    </div>
  );
}
