import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Server,
  Check,
  Loader2,
  ChevronDown,
  Eye,
  EyeOff,
  FolderOpen,
  Key,
  Play,
  AlertCircle,
  Pencil,
  X,
  Bot,
  RefreshCw,
} from 'lucide-react';
import {
  ipc,
  type SshServerItem,
  type RemoteDirEntry,
  type RemoteAgentInfo,
} from '../../hooks/use-ipc';

// ─── Add/Edit SSH Server Modal ────────────────────────────────────────────────

interface SshServerFormData {
  label: string;
  host: string;
  port: number;
  username: string;
  authMethod: 'password' | 'privateKey';
  password: string;
  privateKeyPath: string;
  passphrase: string;
}

const DEFAULT_FORM: SshServerFormData = {
  label: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: '',
};

function SshServerModal({
  server,
  onAdd,
  onUpdate,
  onClose,
}: {
  server?: SshServerItem;
  onAdd: (data: SshServerFormData) => Promise<void>;
  onUpdate: (id: string, data: SshServerFormData) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<SshServerFormData>(
    server
      ? {
          label: server.label,
          host: server.host,
          port: server.port,
          username: server.username,
          authMethod: server.authMethod,
          password: '',
          privateKeyPath: server.privateKeyPath ?? '',
          passphrase: '',
        }
      : DEFAULT_FORM,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    setError(null);
    setTestResult(null);

    if (!form.label.trim()) {
      setError('Label is required');
      return;
    }
    if (!form.host.trim()) {
      setError('Host is required');
      return;
    }
    if (!form.username.trim()) {
      setError('Username is required');
      return;
    }
    if (form.authMethod === 'password' && !form.password && !server) {
      setError('Password is required for new servers');
      return;
    }
    if (form.authMethod === 'privateKey' && !form.privateKeyPath) {
      setError('Private key path is required');
      return;
    }

    setSaving(true);
    try {
      if (server) {
        await onUpdate(server.id, form);
      } else {
        await onAdd(form);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!form.host.trim() || !form.username.trim()) {
      setTestResult({ success: false, message: 'Host and username are required' });
      return;
    }
    if (form.authMethod === 'password' && !form.password && !server) {
      setTestResult({ success: false, message: 'Password is required for new servers' });
      return;
    }
    if (form.authMethod === 'privateKey' && !form.privateKeyPath) {
      setTestResult({ success: false, message: 'Private key path is required' });
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const config = {
        host: form.host,
        port: form.port,
        username: form.username,
        ...(form.authMethod === 'password' && form.password ? { password: form.password } : {}),
        ...(form.authMethod === 'privateKey'
          ? { privateKeyPath: form.privateKeyPath, passphrase: form.passphrase || undefined }
          : {}),
      };
      const result = await ipc.testSshConnection(config);
      if (result.success) {
        setTestResult({
          success: true,
          message: `Connected! Server: ${result.serverInfo?.software ?? 'Unknown'}`,
        });
      } else {
        setTestResult({ success: false, message: result.error ?? 'Connection failed' });
      }
    } catch (e) {
      setTestResult({ success: false, message: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSelectKeyFile = async () => {
    const result = await ipc.selectSshKeyFile();
    if (!result.canceled && result.path) {
      setForm((f) => ({ ...f, privateKeyPath: result.path! }));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15 }}
        className="relative z-10 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-notion-text">
            {server ? 'Edit SSH Server' : 'Add SSH Server'}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-notion-sidebar-hover">
            <X size={18} className="text-notion-text-tertiary" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Label */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-notion-text">Label</label>
            <input
              type="text"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g., Lab GPU Server"
              className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Host & Port */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-sm font-medium text-notion-text">Host</label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                placeholder="hostname or IP"
                className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="w-24">
              <label className="mb-1.5 block text-sm font-medium text-notion-text">Port</label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => setForm((f) => ({ ...f, port: parseInt(e.target.value) || 22 }))}
                className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          </div>

          {/* Username */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-notion-text">Username</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="ssh username"
              className="w-full rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Auth Method */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-notion-text">
              Authentication Method
            </label>
            <div className="flex gap-2">
              {(['password', 'privateKey'] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, authMethod: method }))}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    form.authMethod === method
                      ? 'border-blue-400 bg-blue-50 text-blue-700'
                      : 'border-notion-border text-notion-text-secondary hover:bg-notion-sidebar'
                  }`}
                >
                  {method === 'password' ? (
                    <>
                      <Key size={14} />
                      Password
                    </>
                  ) : (
                    <>
                      <FolderOpen size={14} />
                      Private Key
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Password or Private Key */}
          {form.authMethod === 'password' ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-notion-text">
                Password{' '}
                {server && (
                  <span className="text-notion-text-tertiary">(leave empty to keep existing)</span>
                )}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-notion-border px-3 py-2 pr-10 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-notion-text-tertiary hover:text-notion-text"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-notion-text">
                  Private Key Path
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.privateKeyPath}
                    onChange={(e) => setForm((f) => ({ ...f, privateKeyPath: e.target.value }))}
                    placeholder="~/.ssh/id_rsa"
                    className="flex-1 rounded-lg border border-notion-border px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={handleSelectKeyFile}
                    className="flex items-center gap-1.5 rounded-lg border border-notion-border px-3 text-sm text-notion-text-secondary hover:bg-notion-sidebar"
                  >
                    <FolderOpen size={14} />
                    Browse
                  </button>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-notion-text">
                  Passphrase{' '}
                  <span className="text-notion-text-tertiary">(optional, for encrypted keys)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassphrase ? 'text' : 'password'}
                    value={form.passphrase}
                    onChange={(e) => setForm((f) => ({ ...f, passphrase: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-notion-border px-3 py-2 pr-10 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassphrase((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-notion-text-tertiary hover:text-notion-text"
                  >
                    {showPassphrase ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {/* Test Result */}
        {testResult && (
          <div
            className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
            }`}
          >
            {testResult.success ? <Check size={14} /> : <AlertCircle size={14} />}
            {testResult.message}
          </div>
        )}

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-2 text-sm text-notion-text-secondary hover:bg-notion-sidebar disabled:opacity-50"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-notion-text-secondary hover:bg-notion-sidebar"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Remote Directory Browser Modal ───────────────────────────────────────────

function RemoteDirModal({
  server,
  onSelect,
  onClose,
}: {
  server: SshServerItem;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = useState(server.defaultCwd ?? `/home/${server.username}`);
  const [entries, setEntries] = useState<RemoteDirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDir = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const config = {
        host: server.host,
        port: server.port,
        username: server.username,
        ...(server.authMethod === 'password' ? {} : { privateKeyPath: server.privateKeyPath }),
      };
      const result = await ipc.sshListDirectory(config, currentPath);
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
  }, [server, currentPath]);

  useEffect(() => {
    loadDir();
  }, [loadDir]);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleNavigate = (entry: RemoteDirEntry) => {
    if (entry.isDirectory) {
      setCurrentPath(entry.path);
    }
  };

  const handleGoUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      setCurrentPath('/' + parts.join('/'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15 }}
        className="relative z-10 w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-notion-text">Browse Remote Directory</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-notion-sidebar-hover">
            <X size={18} className="text-notion-text-tertiary" />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={handleGoUp}
            disabled={currentPath === '/'}
            className="rounded-lg p-1.5 text-notion-text-tertiary hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-50"
          >
            <ChevronDown size={16} className="rotate-90" />
          </button>
          <div className="flex-1 overflow-x-auto rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2 font-mono text-sm text-notion-text">
            {currentPath}
          </div>
          <button
            onClick={loadDir}
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
                  <FolderOpen
                    size={16}
                    className={entry.isDirectory ? 'text-blue-500' : 'text-notion-text-tertiary'}
                  />
                  <span className="flex-1 truncate">{entry.name}</span>
                  <span className="text-xs text-notion-text-tertiary">
                    {entry.modifyTime ? new Date(entry.modifyTime * 1000).toLocaleDateString() : ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-notion-text-secondary hover:bg-notion-sidebar"
          >
            Cancel
          </button>
          <button
            onClick={() => onSelect(currentPath)}
            className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600"
          >
            Select This Directory
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── SSH Server Card ───────────────────────────────────────────────────────────

function SshServerCard({
  server,
  onEdit,
  onDelete,
  onDetectAgents,
  onBrowseDir,
  detecting,
}: {
  server: SshServerItem;
  onEdit: () => void;
  onDelete: () => void;
  onDetectAgents: () => void;
  onBrowseDir: () => void;
  detecting: boolean;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Delete "${server.label}"?`)) return;
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="group rounded-lg border border-notion-border bg-white p-4 transition-colors hover:border-notion-accent/30 hover:bg-notion-accent-light">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-notion-sidebar">
            <Server size={18} className="text-notion-text-secondary" />
          </div>
          <div>
            <h3 className="font-medium text-notion-text">{server.label}</h3>
            <p className="text-sm text-notion-text-secondary">
              {server.username}@{server.host}:{server.port}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onEdit}
            className="rounded-lg p-1.5 text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg p-1.5 text-notion-text-tertiary hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
            title="Delete"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs text-notion-text-tertiary">
        <span className="flex items-center gap-1">
          <Key size={12} />
          {server.authMethod === 'password' ? 'Password' : 'Private Key'}
        </span>
        {server.defaultCwd && (
          <span className="flex items-center gap-1">
            <FolderOpen size={12} />
            {server.defaultCwd}
          </span>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onDetectAgents}
          disabled={detecting}
          className="flex items-center gap-1.5 rounded-lg border border-notion-border px-2.5 py-1.5 text-xs text-notion-text-secondary hover:bg-notion-sidebar disabled:opacity-50"
        >
          {detecting ? <Loader2 size={12} className="animate-spin" /> : <Bot size={12} />}
          {detecting ? 'Detecting…' : 'Detect Agents'}
        </button>
        <button
          onClick={onBrowseDir}
          className="flex items-center gap-1.5 rounded-lg border border-notion-border px-2.5 py-1.5 text-xs text-notion-text-secondary hover:bg-notion-sidebar"
        >
          <FolderOpen size={12} />
          Browse
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function SshServerSettings() {
  const [servers, setServers] = useState<SshServerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingServer, setEditingServer] = useState<SshServerItem | null>(null);
  const [detectingId, setDetectingId] = useState<string | null>(null);
  const [detectedAgents, setDetectedAgents] = useState<RemoteAgentInfo[]>([]);
  const [showAgentsModal, setShowAgentsModal] = useState(false);
  const [browseServer, setBrowseServer] = useState<SshServerItem | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
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

  const handleAdd = async (data: SshServerFormData) => {
    const result = await ipc.addSshServer({
      label: data.label,
      host: data.host,
      port: data.port,
      username: data.username,
      authMethod: data.authMethod,
      password: data.authMethod === 'password' ? data.password : undefined,
      privateKeyPath: data.authMethod === 'privateKey' ? data.privateKeyPath : undefined,
      passphrase: data.authMethod === 'privateKey' ? data.passphrase : undefined,
    });
    setServers((prev) => [...prev, result]);
  };

  const handleUpdate = async (id: string, data: SshServerFormData) => {
    const result = await ipc.updateSshServer({
      id,
      label: data.label,
      host: data.host,
      port: data.port,
      username: data.username,
      authMethod: data.authMethod,
      password: data.authMethod === 'password' ? data.password : undefined,
      privateKeyPath: data.authMethod === 'privateKey' ? data.privateKeyPath : undefined,
      passphrase: data.authMethod === 'privateKey' ? data.passphrase : undefined,
    });
    setServers((prev) => prev.map((s) => (s.id === id ? result : s)));
  };

  const handleDelete = async (id: string) => {
    await ipc.removeSshServer(id);
    setServers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleDetectAgents = async (server: SshServerItem) => {
    setDetectingId(server.id);
    try {
      const config = {
        host: server.host,
        port: server.port,
        username: server.username,
        ...(server.authMethod === 'password' ? {} : { privateKeyPath: server.privateKeyPath }),
      };
      const result = await ipc.detectRemoteAgents(config);
      if (result.success && result.agents) {
        setDetectedAgents(result.agents);
        setShowAgentsModal(true);
      } else {
        alert(result.error ?? 'Failed to detect agents');
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to detect agents');
    } finally {
      setDetectingId(null);
    }
  };

  const handleBrowseDir = (server: SshServerItem) => {
    setBrowseServer(server);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-notion-text">SSH Servers</h2>
          <p className="text-sm text-notion-text-secondary">
            Configure remote servers for agent execution
          </p>
        </div>
        <button
          onClick={() => {
            setEditingServer(null);
            setShowModal(true);
          }}
          className="flex items-center gap-1.5 rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600"
        >
          <Plus size={14} />
          Add Server
        </button>
      </div>

      {/* Server List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-notion-border py-12 text-center">
          <Server size={32} className="mx-auto mb-3 text-notion-text-tertiary" />
          <p className="text-sm text-notion-text-secondary">No SSH servers configured</p>
          <p className="mt-1 text-xs text-notion-text-tertiary">
            Add a server to enable remote agent execution
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <SshServerCard
              key={server.id}
              server={server}
              onEdit={() => {
                setEditingServer(server);
                setShowModal(true);
              }}
              onDelete={() => handleDelete(server.id)}
              onDetectAgents={() => handleDetectAgents(server)}
              onBrowseDir={() => handleBrowseDir(server)}
              detecting={detectingId === server.id}
            />
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <SshServerModal
            server={editingServer ?? undefined}
            onAdd={handleAdd}
            onUpdate={handleUpdate}
            onClose={() => {
              setShowModal(false);
              setEditingServer(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Detected Agents Modal */}
      <AnimatePresence>
        {showAgentsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 bg-black/50"
              onClick={() => setShowAgentsModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ duration: 0.15 }}
              className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-notion-text">Detected Agents</h2>
                <button
                  onClick={() => setShowAgentsModal(false)}
                  className="rounded-lg p-1 hover:bg-notion-sidebar-hover"
                >
                  <X size={18} className="text-notion-text-tertiary" />
                </button>
              </div>

              {detectedAgents.length === 0 ? (
                <p className="text-sm text-notion-text-secondary">
                  No agent CLIs detected on this server.
                </p>
              ) : (
                <div className="space-y-2">
                  {detectedAgents.map((agent) => (
                    <div
                      key={agent.path}
                      className="flex items-center gap-3 rounded-lg border border-notion-border p-3"
                    >
                      <Bot size={18} className="text-blue-500" />
                      <div className="flex-1">
                        <p className="font-medium text-notion-text">{agent.name}</p>
                        <p className="text-xs text-notion-text-tertiary">{agent.path}</p>
                      </div>
                      {agent.version && (
                        <span className="text-xs text-notion-text-secondary">v{agent.version}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => setShowAgentsModal(false)}
                  className="rounded-lg px-4 py-2 text-sm text-notion-text-secondary hover:bg-notion-sidebar"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Remote Directory Browser */}
      <AnimatePresence>
        {browseServer && (
          <RemoteDirModal
            server={browseServer}
            onSelect={async (path) => {
              // Update the server's defaultCwd
              try {
                await ipc.updateSshServer({
                  id: browseServer.id,
                  label: browseServer.label,
                  host: browseServer.host,
                  port: browseServer.port,
                  username: browseServer.username,
                  authMethod: browseServer.authMethod,
                  defaultCwd: path,
                });
                setServers((prev) =>
                  prev.map((s) => (s.id === browseServer.id ? { ...s, defaultCwd: path } : s)),
                );
              } catch (e) {
                console.error('Failed to update defaultCwd:', e);
              }
              setBrowseServer(null);
            }}
            onClose={() => setBrowseServer(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
