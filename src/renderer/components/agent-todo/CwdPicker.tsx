import { FolderOpen } from 'lucide-react';
import { ipc } from '../../hooks/use-ipc';

interface CwdPickerProps {
  value: string;
  onChange: (path: string) => void;
  onBlur?: () => void;
}

export function CwdPicker({ value, onChange, onBlur }: CwdPickerProps) {
  async function handleBrowse() {
    const folder = await ipc.selectFolder();
    if (folder) onChange(folder);
  }

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="/path/to/working/directory"
        className="flex-1 rounded-md border border-notion-border bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-100"
      />
      <button
        type="button"
        onClick={handleBrowse}
        className="flex items-center gap-1 rounded-lg border border-notion-border px-3 py-2 text-sm text-notion-text-secondary hover:bg-blue-50 transition-colors"
        title="Browse for directory"
      >
        <FolderOpen size={14} />
      </button>
    </div>
  );
}
