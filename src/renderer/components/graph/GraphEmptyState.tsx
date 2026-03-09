import { Network, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function GraphEmptyState() {
  const navigate = useNavigate();

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-notion-sidebar">
          <Network size={32} className="text-notion-text-tertiary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-notion-text">No citation data yet</h3>
          <p className="mt-1.5 text-sm text-notion-text-secondary">
            Citation relationships are automatically extracted in the background when you add papers
            to your library. Add some papers to get started.
          </p>
        </div>
        <button
          onClick={() => navigate('/papers')}
          className="flex items-center gap-1.5 rounded-lg bg-notion-accent px-4 py-2 text-sm text-white transition-colors hover:bg-notion-accent/90"
        >
          Go to Library
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
