import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FolderOpen, ChevronDown, ChevronRight, Loader2, RefreshCw, X, Home } from 'lucide-react';
import { ipc, type RemoteDirEntry } from '../../hooks/use-ipc';

export interface RemoteSshConfig {
  label: string;
  host: string;
  port: number;
  username: string;
  authMethod?: string;
  privateKeyPath?: string;
  defaultCwd?: string | null;
}

interface RemoteCwdPickerProps {
  server: RemoteSshConfig;
  value: string;
  onChange: (path: string) => void;
  className?: string;
}

export function RemoteCwdPicker({ server, value, onChange, className }: RemoteCwdPickerProps) {
  const [showModal, setShowModal] = useState(false);
  const [currentPath, setCurrentPath] = useState(
    (value || server.defaultCwd) ?? `/home/${server.username}`,
  );
  const [entries, setEntries] = useState<RemoteDirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const loadDir = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const config = {
          host: server.host,
          port: server.port,
          username: server.username,
          ...(server.authMethod === 'password'
            ? {}
            : { privateKeyPath: server.privateKeyPath ?? undefined }),
        };
        const result = await ipc.sshListDirectory(config, path);
        if (result.success && result.entries) {
          // Sort: directories first, then by name
          const sorted = [...result.entries].sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          setEntries(sorted);
        } else {
          setError(result.error ?? 'Failed to list directory');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to list directory');
      } finally {
        setLoading(false);
      }
    },
    [server],
  );

  useEffect(() => {
    if (showModal) {
      loadDir(currentPath);
    }
  }, [showModal, currentPath, loadDir]);

  // ESC to close
  useEffect(() => {
    if (!showModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowModal(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showModal]);

  const handleNavigate = (entry: RemoteDirEntry) => {
    if (entry.isDirectory) {
      setCurrentPath(entry.path);
      setExpandedFolders(new Set());
    }
  };

  const handleGoUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      setCurrentPath('/' + parts.join('/'));
    }
  };

  const handleGoHome = () => {
    setCurrentPath(`/home/${server.username}`);
  };

  const handleSelect = () => {
    onChange(currentPath);
    setShowModal(false);
  };

  // Display value with ellipsis if too long
  const displayValue = value.length > 40 ? '…' + value.slice(-37) : value;

  return (
    <div className={className}>
      <div className="flex gap-2">
        <div
          onClick={() => setShowModal(true)}
          className="flex flex-1 cursor-pointer items-center gap-2 rounded-lg border border-notion-border bg-white px-3 py-2 text-sm text-notion-text transition-colors hover:border-blue-300"
        >
          <FolderOpen size={14} className="text-notion-text-tertiary" />
          <span className="flex-1 truncate font-mono text-xs">
            {displayValue || 'Select directory…'}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="flex items-center gap-1.5 rounded-lg border border-notion-border px-3 text-sm text-notion-text-secondary hover:bg-notion-sidebar"
        >
          Browse
        </button>
      </div>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-black/50"
              onClick={() => setShowModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="relative z-10 w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-notion-text">
                    Select Remote Directory
                  </h2>
                  <p className="text-sm text-notion-text-secondary">
                    {server.label} ({server.username}@{server.host})
                  </p>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-lg p-1 hover:bg-notion-sidebar-hover"
                >
                  <X size={18} className="text-notion-text-tertiary" />
                </button>
              </div>

              {/* Toolbar */}
              <div className="mb-4 flex items-center gap-2">
                <button
                  onClick={handleGoUp}
                  disabled={currentPath === '/'}
                  className="rounded-lg p-2 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-50"
                  title="Go up"
                >
                  <ChevronDown size={16} className="rotate-90" />
                </button>
                <button
                  onClick={handleGoHome}
                  className="rounded-lg p-2 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text"
                  title="Home"
                >
                  <Home size={16} />
                </button>
                <div className="flex-1 overflow-x-auto rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2 font-mono text-sm text-notion-text">
                  {currentPath}
                </div>
                <button
                  onClick={() => loadDir(currentPath)}
                  disabled={loading}
                  className="rounded-lg p-2 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-50"
                >
                  <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                </button>
              </div>

              {/* Directory List */}
              <div className="mb-4 h-80 overflow-y-auto rounded-lg border border-notion-border">
                {loading ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
                  </div>
                ) : error ? (
                  <div className="flex h-full items-center justify-center text-sm text-red-500">
                    {error}
                  </div>
                ) : entries.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-notion-text-tertiary">
                    Empty directory
                  </div>
                ) : (
                  <div className="divide-y divide-notion-border">
                    {entries.map((entry) => (
                      <button
                        key={entry.path}
                        onClick={() => handleNavigate(entry)}
                        disabled={!entry.isDirectory}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          entry.isDirectory
                            ? 'hover:bg-notion-accent-light'
                            : 'cursor-default text-notion-text-tertiary'
                        }`}
                      >
                        {entry.isDirectory ? (
                          <ChevronRight size={14} className="text-notion-text-tertiary" />
                        ) : (
                          <span className="w-3.5" />
                        )}
                        <FolderOpen
                          size={16}
                          className={
                            entry.isDirectory ? 'text-blue-500' : 'text-notion-text-tertiary'
                          }
                        />
                        <span className="flex-1 truncate">{entry.name}</span>
                        <span className="text-xs text-notion-text-tertiary">
                          {entry.modifyTime
                            ? new Date(entry.modifyTime * 1000).toLocaleDateString()
                            : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-lg px-4 py-2 text-sm text-notion-text-secondary hover:bg-notion-sidebar"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSelect}
                  className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
                >
                  Select "{currentPath.split('/').pop() || '/'}"
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
