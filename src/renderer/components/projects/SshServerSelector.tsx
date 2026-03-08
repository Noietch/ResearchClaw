import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, Server, Check, Loader2, X } from 'lucide-react';
import { ipc, type SshServerItem } from '../../hooks/use-ipc';

interface SshServerSelectorProps {
  value?: string; // SSH server ID, empty means "local"
  onChange: (id: string | undefined) => void;
  className?: string;
}

export function SshServerSelector({ value, onChange, className }: SshServerSelectorProps) {
  const [servers, setServers] = useState<SshServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const loadServers = useCallback(async () => {
    try {
      const list = await ipc.listSshServers();
      setServers(list);
    } catch (e) {
      console.error('Failed to load SSH servers:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-ssh-selector]')) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedServer = value ? servers.find((s) => s.id === value) : null;

  return (
    <div className={`relative ${className ?? ''}`} data-ssh-selector>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className="flex w-full items-center justify-between rounded-lg border border-notion-border bg-white px-3 py-2 text-sm text-notion-text transition-colors hover:border-blue-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
      >
        <span className="flex items-center gap-2">
          <Server
            size={14}
            className={selectedServer ? 'text-blue-500' : 'text-notion-text-tertiary'}
          />
          {loading ? (
            'Loading…'
          ) : selectedServer ? (
            <span className="truncate">
              {selectedServer.label}{' '}
              <span className="text-notion-text-tertiary">
                ({selectedServer.username}@{selectedServer.host})
              </span>
            </span>
          ) : (
            <span className="text-notion-text-secondary">None (local execution)</span>
          )}
        </span>
        <ChevronDown
          size={14}
          className={`text-notion-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-notion-border bg-white shadow-lg">
          {/* None option */}
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-notion-sidebar ${
              !value ? 'bg-blue-50 text-blue-700' : 'text-notion-text'
            }`}
          >
            <span className="flex items-center gap-2">
              <X size={14} className="text-notion-text-tertiary" />
              None (local execution)
            </span>
            {!value && <Check size={13} className="text-blue-600" />}
          </button>

          {servers.length > 0 && (
            <div className="border-t border-notion-border">
              {servers.map((server) => (
                <button
                  key={server.id}
                  type="button"
                  onClick={() => {
                    onChange(server.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-notion-sidebar ${
                    value === server.id ? 'bg-blue-50 text-blue-700' : 'text-notion-text'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Server size={14} className="text-blue-500" />
                    <span className="truncate">
                      {server.label}{' '}
                      <span className="text-notion-text-tertiary">
                        ({server.username}@{server.host}:{server.port})
                      </span>
                    </span>
                  </span>
                  {value === server.id && <Check size={13} className="text-blue-600" />}
                </button>
              ))}
            </div>
          )}

          {servers.length === 0 && !loading && (
            <div className="border-t border-notion-border px-3 py-2.5 text-xs text-notion-text-tertiary">
              No SSH servers configured. Add one in Settings → SSH Servers.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
