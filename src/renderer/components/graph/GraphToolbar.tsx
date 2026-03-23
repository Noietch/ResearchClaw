import { useState } from 'react';
import {
  LayoutGrid,
  GitBranch,
  Circle,
  Grid3X3,
  Download,
  Eye,
  EyeOff,
  Search,
  RotateCcw,
  FileJson,
} from 'lucide-react';
import type { LayoutType } from './GraphCanvas';

interface GraphToolbarProps {
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  showGhostNodes: boolean;
  onToggleGhostNodes: () => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onExportPng: () => void;
  onExportJson: () => void;
  onResetView: () => void;
  nodeCount: number;
  edgeCount: number;
}

const layouts: { value: LayoutType; label: string; icon: typeof LayoutGrid }[] = [
  { value: 'cose', label: 'Force', icon: GitBranch },
  { value: 'dagre', label: 'Hierarchy', icon: LayoutGrid },
  { value: 'circle', label: 'Circle', icon: Circle },
  { value: 'grid', label: 'Grid', icon: Grid3X3 },
];

export function GraphToolbar({
  layout,
  onLayoutChange,
  showGhostNodes,
  onToggleGhostNodes,
  searchQuery,
  onSearchChange,
  onExportPng,
  onExportJson,
  onResetView,
  nodeCount,
  edgeCount,
}: GraphToolbarProps) {
  const [searchFocused, setSearchFocused] = useState(false);

  return (
    <div className="flex items-center gap-2 border-b border-notion-border bg-white px-4 py-2">
      {/* Layout selector */}
      <div className="flex items-center gap-0.5 rounded-lg bg-notion-sidebar p-0.5">
        {layouts.map((l) => {
          const Icon = l.icon;
          const isActive = layout === l.value;
          return (
            <button
              key={l.value}
              onClick={() => onLayoutChange(l.value)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                isActive
                  ? 'bg-white text-notion-text shadow-sm'
                  : 'text-notion-text-tertiary hover:text-notion-text-secondary'
              }`}
              title={l.label}
            >
              <Icon size={13} strokeWidth={isActive ? 2 : 1.5} />
              <span className="hidden sm:inline">{l.label}</span>
            </button>
          );
        })}
      </div>

      {/* Separator */}
      <div className="h-5 w-px bg-notion-border" />

      {/* Ghost nodes toggle */}
      <button
        onClick={onToggleGhostNodes}
        className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
          showGhostNodes
            ? 'bg-notion-sidebar-hover text-notion-text'
            : 'text-notion-text-tertiary hover:text-notion-text-secondary'
        }`}
        title={showGhostNodes ? 'Hide external references' : 'Show external references'}
      >
        {showGhostNodes ? <Eye size={13} /> : <EyeOff size={13} />}
        <span className="hidden sm:inline">External</span>
      </button>

      {/* Search */}
      <div
        className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 transition-colors ${
          searchFocused ? 'border-blue-400 bg-white' : 'border-notion-border bg-notion-sidebar'
        }`}
      >
        <Search size={13} className="text-notion-text-tertiary" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search nodes..."
          className="w-32 bg-transparent text-xs text-notion-text outline-none placeholder:text-notion-text-tertiary"
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
          }}
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Stats */}
      <span className="text-xs text-notion-text-tertiary">
        {nodeCount} nodes · {edgeCount} edges
      </span>

      {/* Actions */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={onResetView}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text-secondary transition-colors"
          title="Reset view"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={onExportPng}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text-secondary transition-colors"
          title="Export as PNG"
        >
          <Download size={14} />
        </button>
        <button
          onClick={onExportJson}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text-secondary transition-colors"
          title="Export as JSON"
        >
          <FileJson size={14} />
        </button>
      </div>
    </div>
  );
}
