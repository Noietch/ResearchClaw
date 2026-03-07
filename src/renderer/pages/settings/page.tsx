import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ipc,
  onIpc,
  type ImportStatus,
  type ModelConfig,
  type ModelKind,
  type ModelBackend,
  type ProviderKind,
  type CliConfig,
  type TokenUsageRecord,
  type TokenUsageSummary,
} from '../../hooks/use-ipc';
import {
  Settings,
  Check,
  Loader2,
  Eye,
  EyeOff,
  FolderOpen,
  HardDrive,
  Plus,
  Trash2,
  ChevronDown,
  RefreshCw,
  Code2,
  Cpu,
  Zap,
  MessageSquare,
  Globe,
  BarChart3,
  Trash,
  Pencil,
  Wrench,
} from 'lucide-react';
import { ResponsiveLine } from '@nivo/line';
import { ModelCombobox } from '../../components/model-combobox';

// ─── Editor SVG Icons ─────────────────────────────────────────────────────────

const VSCodeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5">
    <path
      d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z"
      fill="#007ACC"
    />
  </svg>
);

const CursorIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5">
    <path d="M3.5 3.5L12 12L3.5 20.5V3.5Z" fill="#000" />
    <path d="M3.5 3.5L20.5 12L12 12L3.5 3.5Z" fill="#000" />
    <path d="M12 12L20.5 12L3.5 20.5L12 12Z" fill="#000" />
    <path
      d="M3.5 3.5L12 12M12 12L3.5 20.5V3.5ZM12 12L20.5 12L3.5 3.5L12 12Z"
      stroke="#000"
      strokeWidth="0.5"
    />
    <circle cx="18" cy="12" r="2" fill="#000" />
  </svg>
);

const ZedIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5">
    <path d="M4 4H20L12 20H4L12 4H4Z" fill="#F5A623" />
  </svg>
);

const WindsurfIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5">
    <circle cx="12" cy="12" r="10" fill="#6366F1" />
    <path
      d="M7 12C7 9.23858 9.23858 7 12 7C14.7614 7 17 9.23858 17 12C17 14.7614 14.7614 17 12 17"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
    />
    <circle cx="12" cy="12" r="2" fill="white" />
  </svg>
);

const NeovimIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5">
    <path d="M2 3L8 9L8 21L2 15V3Z" fill="#57A143" />
    <path d="M22 3L16 9L16 21L22 15V3Z" fill="#57A143" />
    <path d="M8 9L12 5L16 9L12 13L8 9Z" fill="#57A143" />
  </svg>
);

const EDITOR_OPTIONS = [
  { id: 'code', name: 'VS Code', command: 'code', Icon: VSCodeIcon },
  { id: 'cursor', name: 'Cursor', command: 'cursor', Icon: CursorIcon },
  { id: 'zed', name: 'Zed', command: 'zed', Icon: ZedIcon },
  { id: 'windsurf', name: 'Windsurf', command: 'windsurf', Icon: WindsurfIcon },
  { id: 'nvim', name: 'Neovim', command: 'nvim', Icon: NeovimIcon },
  { id: 'custom', name: 'Custom', command: '', Icon: Code2 },
] as const;

type Tab = 'models' | 'storage' | 'editor' | 'proxy' | 'maintenance';

// ─── Provider selector ───────────────────────────────────────────────────────

const PROVIDER_OPTIONS: Array<{ id: ProviderKind; label: string }> = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI (Codex / GPT)' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'custom', label: 'Custom / Other' },
];

/** Default env var key per provider (for silent mode) */
const PROVIDER_ENV_DEFAULTS: Record<ProviderKind, string> = {
  anthropic: 'ANTHROPIC_API_KEY=',
  openai: 'OPENAI_API_KEY=',
  gemini: 'GEMINI_API_KEY=',
  custom: '',
};

function ProviderSelect({
  value,
  onChange,
}: {
  value: ProviderKind;
  onChange: (v: ProviderKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = PROVIDER_OPTIONS.find((p) => p.id === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-provider-select]')) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="relative" data-provider-select>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-notion-border bg-white px-3 py-2.5 text-sm text-notion-text transition-colors hover:border-blue-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        <span>{selected?.label ?? 'Select provider…'}</span>
        <ChevronDown
          size={14}
          className={`text-notion-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-notion-border bg-white shadow-lg">
          {PROVIDER_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                onChange(opt.id);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-notion-sidebar ${
                value === opt.id ? 'bg-blue-50 text-blue-700' : 'text-notion-text'
              }`}
            >
              {opt.label}
              {value === opt.id && <Check size={13} className="text-blue-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Utility functions ───────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Add Tool Modal ───────────────────────────────────────────────────────────

function AddToolModal({ onAdd, onClose }: { onAdd: (t: CliConfig) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [provider, setProvider] = useState<ProviderKind>('anthropic');
  const [envVars, setEnvVars] = useState(PROVIDER_ENV_DEFAULTS['anthropic']);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleProviderChange = (p: ProviderKind) => {
    setProvider(p);
    // Pre-fill env var only if user hasn't typed anything custom yet
    setEnvVars(PROVIDER_ENV_DEFAULTS[p]);
  };

  const handleAdd = () => {
    if (!command.trim()) return;
    onAdd({
      id: makeId(),
      name: name.trim() || command.trim().split(' ')[0],
      command: command.trim(),
      envVars: envVars.trim(),
      provider,
      active: false,
    });
    onClose();
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
          className="w-full max-w-md rounded-2xl border border-notion-border bg-white p-6 shadow-xl"
        >
          <h2 className="mb-4 text-base font-semibold text-notion-text">Add CLI Tool</h2>

          <div className="space-y-4">
            {/* Provider */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                Provider
              </label>
              <ProviderSelect value={provider} onChange={handleProviderChange} />
            </div>

            {/* Display name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                Name <span className="font-normal text-notion-text-tertiary">(optional)</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Claude Code"
                className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {/* Command */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                Command
              </label>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g. claude --dangerously-skip-permissions"
                className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-xs text-notion-text-tertiary">
                Full command including any flags for silent / non-interactive mode
              </p>
            </div>

            {/* Env vars */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                Environment Variables{' '}
                <span className="font-normal text-notion-text-tertiary">(optional)</span>
              </label>
              <input
                value={envVars}
                onChange={(e) => setEnvVars(e.target.value)}
                placeholder="KEY=value KEY2=value2"
                className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
              <p className="mt-1 text-xs text-notion-text-tertiary">
                Space-separated KEY=value pairs injected when running this tool
              </p>
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!command.trim()}
              className="rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── CLI Tool card ────────────────────────────────────────────────────────────

function CliToolCard({
  tool,
  onUpdate,
  onSetActive,
  onDelete,
}: {
  tool: CliConfig;
  onUpdate: (t: CliConfig) => void;
  onSetActive: () => void;
  onDelete: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [showEnv, setShowEnv] = useState(false);

  const providerLabel =
    PROVIDER_OPTIONS.find((p) => p.id === tool.provider)?.label ?? tool.provider;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // command may include args, split on first space for the binary
      const parts = tool.command.trim().split(/\s+/);
      const bin = parts[0];
      const extraArgs = parts.slice(1).join(' ');
      const res = await ipc.testCli(bin, extraArgs || undefined, tool.envVars || undefined);
      setTestResult(
        res.success
          ? { success: true, error: undefined }
          : { success: false, error: res.error ?? 'Failed' },
      );
    } catch (e) {
      setTestResult({ success: false, error: e instanceof Error ? e.message : 'Error' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className={`rounded-xl border p-5 transition-all ${
        tool.active ? 'border-blue-200 bg-blue-50/40 shadow-sm' : 'border-notion-border bg-white'
      }`}
    >
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-notion-text">{tool.name}</h3>
            {tool.active && (
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-2xs font-medium text-blue-700">
                Active
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-notion-text-tertiary">{providerLabel}</p>
        </div>
        {!tool.active && (
          <button
            onClick={onSetActive}
            className="rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
          >
            Set Active
          </button>
        )}
        <button
          onClick={onDelete}
          className="rounded-lg p-1.5 text-notion-text-tertiary transition-colors hover:bg-red-50 hover:text-red-500"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="space-y-3">
        {/* Command (full, including flags) */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
            Command
          </label>
          <input
            value={tool.command}
            onChange={(e) => onUpdate({ ...tool, command: e.target.value })}
            placeholder="e.g. claude --dangerously-skip-permissions"
            className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Env vars */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
            Environment Variables{' '}
            <span className="font-normal text-notion-text-tertiary">(for silent mode)</span>
          </label>
          <div className="relative flex items-center">
            <input
              type={showEnv ? 'text' : 'password'}
              value={tool.envVars}
              onChange={(e) => onUpdate({ ...tool, envVars: e.target.value })}
              placeholder="ANTHROPIC_API_KEY=sk-..."
              className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 pr-10 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <button
              type="button"
              onClick={() => setShowEnv((p) => !p)}
              className="absolute right-3 text-notion-text-tertiary hover:text-notion-text"
            >
              {showEnv ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div
          className={`mt-3 rounded-lg px-3 py-2.5 font-mono text-xs ${
            testResult.success
              ? 'border border-green-200 bg-green-50 text-green-700'
              : 'border border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {testResult.success ? '✓ ' : '✗ '}
          {testResult.error?.slice(0, 120)}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          onClick={handleTest}
          disabled={testing || !tool.command.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text transition-all hover:bg-notion-sidebar hover:shadow-sm disabled:opacity-50"
        >
          {testing ? (
            <Loader2 size={13} className="animate-spin text-notion-text-tertiary" />
          ) : (
            <Check size={13} className="text-notion-text-tertiary" />
          )}
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>
    </div>
  );
}

// ─── Editor Settings ─────────────────────────────────────────────────────────

function EditorSettings() {
  const [selectedEditor, setSelectedEditor] = useState<string>('code');
  const [customCommand, setCustomCommand] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    ipc
      .getSettings()
      .then((s) => {
        const cmd = s.editorCommand ?? 'code';
        setSelectedEditor(cmd);
        // If it's not one of the presets, set to custom
        const isPreset = EDITOR_OPTIONS.some((opt) => opt.command === cmd && opt.id !== 'custom');
        if (!isPreset) {
          setSelectedEditor('custom');
          setCustomCommand(cmd);
        }
      })
      .catch(() => {});
  }, []);

  const handleSelectEditor = async (editorId: string) => {
    const editor = EDITOR_OPTIONS.find((opt) => opt.id === editorId);
    if (!editor) return;

    setSelectedEditor(editorId);
    if (editorId !== 'custom') {
      await saveEditor(editor.command);
    }
  };

  const handleSaveCustom = async () => {
    if (!customCommand.trim()) return;
    await saveEditor(customCommand.trim());
  };

  const saveEditor = async (command: string) => {
    setSaving(true);
    try {
      await ipc.setEditor(command);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const root = await ipc.getStorageRoot();
      const result = await ipc.openInEditor(root);
      if (result.success) {
        setTestResult({ ok: true, msg: 'Editor opened successfully.' });
      } else {
        setTestResult({ ok: false, msg: result.error ?? 'Failed to open editor.' });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 4000);
    }
  };

  return (
    <div>
      <p className="mb-5 text-sm text-notion-text-secondary">
        Choose your preferred code editor for opening paper folders.
      </p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {EDITOR_OPTIONS.map((editor) => {
          const isSelected = selectedEditor === editor.id;
          return (
            <button
              key={editor.id}
              onClick={() => handleSelectEditor(editor.id)}
              className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-all ${
                isSelected
                  ? 'border-blue-300 bg-blue-50 shadow-sm'
                  : 'border-notion-border bg-white hover:border-notion-text-tertiary hover:shadow-sm'
              }`}
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-notion-sidebar">
                <editor.Icon />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-notion-text'}`}
                  >
                    {editor.name}
                  </span>
                  {isSelected && <Check size={14} className="text-blue-600" />}
                </div>
                {editor.command && (
                  <span className="text-xs text-notion-text-tertiary font-mono">
                    {editor.command}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom command input */}
      {selectedEditor === 'custom' && (
        <div className="mt-4 rounded-xl border border-notion-border bg-white p-5">
          <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
            Custom Editor Command
          </label>
          <div className="flex items-center gap-2">
            <input
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              placeholder="e.g. subl, idea, vim"
              className="flex-1 rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <button
              onClick={handleSaveCustom}
              disabled={saving || !customCommand.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2.5 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : saved ? (
                <Check size={14} />
              ) : null}
              {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="mt-2 text-xs text-notion-text-tertiary">
            Enter the command-line tool name for your preferred editor.
          </p>
        </div>
      )}

      {/* Test button */}
      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2 text-sm font-medium text-notion-text hover:border-notion-text-tertiary hover:shadow-sm disabled:opacity-50 transition-all"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Code2 size={14} />}
          {testing ? 'Testing…' : 'Test Editor'}
        </button>
        {testResult && (
          <span className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
            {testResult.ok ? <Check size={14} className="inline mr-1" /> : null}
            {testResult.msg}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Storage Settings ─────────────────────────────────────────────────────────

function StorageSettings() {
  const [papersDir, setPapersDir] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [scanStatus, setScanStatus] = useState<ImportStatus | null>(null);
  useEffect(() => {
    ipc
      .getSettings()
      .then((s) => {
        setPapersDir(s.papersDir);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const unsub = onIpc('ingest:status', (...args) => {
      const status = args[1] as ImportStatus;
      setScanStatus(status);
    });
    return unsub;
  }, []);

  const handleSelectFolder = async () => {
    const dir = await ipc.selectFolder();
    if (dir) setPapersDir(dir);
  };

  const handleSave = async () => {
    if (!papersDir.trim()) return;
    setSaving(true);
    try {
      await ipc.setPapersDir(papersDir.trim());
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleScan = () => {
    if (!papersDir.trim()) return;
    setScanStatus({
      active: true,
      total: 0,
      completed: 0,
      success: 0,
      failed: 0,
      phase: 'parsing_history',
      skipped: 0,
      message: 'Starting scan…',
      lastImportAt: null,
      lastImportCount: 0,
    });
    ipc.scanLocalPapersDir(papersDir.trim()).catch(() => undefined);
  };

  const isScanning = scanStatus?.active === true;

  return (
    <div>
      <p className="mb-5 text-sm text-notion-text-secondary">
        Choose where downloaded papers and notes are saved on your machine.
      </p>
      <div className="rounded-xl border border-notion-border bg-white p-5">
        <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
          Papers folder
        </label>
        <div className="flex items-center gap-2">
          <input
            value={papersDir}
            onChange={(e) => setPapersDir(e.target.value)}
            placeholder="e.g. /home/you/.local/share/vibe-research/papers"
            className="flex-1 rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
          <button
            onClick={handleSelectFolder}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-2.5 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
          >
            <FolderOpen size={14} />
            Browse
          </button>
        </div>
        <p className="mt-2 text-xs text-notion-text-tertiary">
          PDFs and reading notes will be stored in subfolders here.
        </p>
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={handleScan}
            disabled={isScanning || !papersDir.trim()}
            className="inline-flex items-center gap-2 rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-50"
          >
            <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
            {isScanning ? 'Scanning…' : 'Scan & Import Existing Papers'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !papersDir.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saved ? (
              <Check size={14} />
            ) : null}
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Scan progress */}
      {scanStatus && (
        <div
          className={`mt-4 rounded-xl border p-4 text-sm ${
            scanStatus.phase === 'failed'
              ? 'border-red-200 bg-red-50'
              : scanStatus.phase === 'completed'
                ? 'border-green-200 bg-green-50'
                : 'border-blue-200 bg-blue-50'
          }`}
        >
          <div className="flex items-center gap-2">
            {scanStatus.active ? (
              <Loader2 size={14} className="animate-spin text-blue-500" />
            ) : scanStatus.phase === 'completed' ? (
              <Check size={14} className="text-green-600" />
            ) : null}
            <span
              className={
                scanStatus.phase === 'failed'
                  ? 'text-red-700'
                  : scanStatus.phase === 'completed'
                    ? 'text-green-700'
                    : 'text-blue-700'
              }
            >
              {scanStatus.message}
            </span>
          </div>
          {scanStatus.total > 0 && (
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{
                    width: `${Math.round((scanStatus.completed / scanStatus.total) * 100)}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-notion-text-tertiary">
                {scanStatus.completed} / {scanStatus.total}
                {scanStatus.success > 0 && ` · ${scanStatus.success} imported`}
                {scanStatus.failed > 0 && ` · ${scanStatus.failed} failed`}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Models Settings ──────────────────────────────────────────────────────────

const MODEL_KIND_META: Record<
  ModelKind,
  { label: string; description: string; Icon: React.ElementType }
> = {
  agent: {
    label: 'Agent',
    description: 'CLI-based agent for code analysis and multi-step tasks.',
    Icon: Cpu,
  },
  lightweight: {
    label: 'Lightweight',
    description: 'Fast, low-cost model for tagging, summaries, and classification.',
    Icon: Zap,
  },
  chat: {
    label: 'Chat',
    description: 'Conversational model for the paper reader chat interface.',
    Icon: MessageSquare,
  },
};

// Agent is always CLI; lightweight and chat are always API
const KIND_BACKEND: Record<ModelKind, ModelBackend> = {
  agent: 'cli',
  lightweight: 'api',
  chat: 'api',
};

const API_PROVIDER_OPTIONS: Array<{
  id: 'anthropic' | 'openai' | 'gemini' | 'custom';
  label: string;
}> = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI (GPT)' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)' },
];

function makeModelId() {
  return Math.random().toString(36).slice(2, 10);
}

function AddModelModal({
  defaultKind,
  onAdd,
  onClose,
}: {
  defaultKind: ModelKind;
  onAdd: (config: Omit<ModelConfig, 'hasApiKey'> & { apiKey?: string }) => void;
  onClose: () => void;
}) {
  const backend = KIND_BACKEND[defaultKind];
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<'anthropic' | 'openai' | 'gemini' | 'custom'>('openai');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [command, setCommand] = useState('');
  const [envVars, setEnvVars] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleAdd = async () => {
    const displayName =
      name.trim() || (backend === 'api' ? `${provider}/${model}` : command.split(' ')[0]);
    if (!displayName) return;
    await onAdd({
      id: makeModelId(),
      name: displayName,
      kind: defaultKind,
      backend,
      ...(backend === 'api'
        ? {
            provider,
            model,
            apiKey: apiKey.trim() || undefined,
            baseURL: baseURL.trim() || undefined,
          }
        : {}),
      ...(backend === 'cli' ? { command: command.trim(), envVars: envVars.trim() } : {}),
    });
    onClose();
  };

  const isValid = backend === 'api' ? !!model.trim() : !!command.trim();

  const handleTest = async () => {
    if (backend !== 'api' || !model.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await ipc.testModelConnection({
        provider,
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
          className="w-full max-w-lg rounded-2xl border border-notion-border bg-white p-6 shadow-xl"
        >
          <h2 className="mb-1 text-base font-semibold text-notion-text">
            Add {MODEL_KIND_META[defaultKind].label} Model
          </h2>
          <p className="mb-4 text-xs text-notion-text-tertiary">
            {backend === 'cli' ? 'CLI subprocess' : 'API direct'}
          </p>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                Name <span className="font-normal text-notion-text-tertiary">(optional)</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  backend === 'api'
                    ? `e.g. ${provider}/${model || 'model-name'}`
                    : 'e.g. Claude Code'
                }
                className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {backend === 'api' ? (
              <>
                {/* Provider */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Provider
                  </label>
                  <div className="relative" data-provider-select>
                    <button
                      type="button"
                      onClick={() => setProviderOpen((o) => !o)}
                      className="flex w-full items-center justify-between rounded-lg border border-notion-border bg-white px-3 py-2.5 text-sm text-notion-text transition-colors hover:border-blue-300 focus:outline-none"
                    >
                      <span>{API_PROVIDER_OPTIONS.find((p) => p.id === provider)?.label}</span>
                      <ChevronDown
                        size={14}
                        className={`text-notion-text-tertiary transition-transform ${providerOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {providerOpen && (
                      <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-notion-border bg-white shadow-lg">
                        {API_PROVIDER_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setProvider(opt.id);
                              setModel('');
                              setProviderOpen(false);
                            }}
                            className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-notion-sidebar ${provider === opt.id ? 'bg-blue-50 text-blue-700' : 'text-notion-text'}`}
                          >
                            {opt.label}
                            {provider === opt.id && <Check size={13} className="text-blue-600" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Model */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Model ID
                  </label>
                  <ModelCombobox value={model} onChange={setModel} placeholder="选择或输入模型ID" />
                </div>

                {/* Base URL (optional override) */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Base URL{' '}
                    <span className="font-normal text-notion-text-tertiary">
                      (optional, for proxy/custom endpoint)
                    </span>
                  </label>
                  <input
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder={
                      provider === 'anthropic'
                        ? 'https://api.anthropic.com (default)'
                        : provider === 'openai'
                          ? 'https://api.openai.com/v1 (default)'
                          : provider === 'gemini'
                            ? 'https://generativelanguage.googleapis.com (default)'
                            : 'https://your-proxy.example.com/v1'
                    }
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    API Key{' '}
                    <span className="font-normal text-notion-text-tertiary">
                      (optional if set via env)
                    </span>
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 pr-10 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((p) => !p)}
                      className="absolute right-3 text-notion-text-tertiary hover:text-notion-text"
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* CLI Command */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Command
                  </label>
                  <input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="e.g. claude --dangerously-skip-permissions"
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                {/* Env Vars */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Environment Variables{' '}
                    <span className="font-normal text-notion-text-tertiary">(optional)</span>
                  </label>
                  <input
                    value={envVars}
                    onChange={(e) => setEnvVars(e.target.value)}
                    placeholder="ANTHROPIC_API_KEY=sk-..."
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
            >
              {testResult.success
                ? '✓ Connection successful!'
                : `✗ ${testResult.error || 'Connection failed'}`}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
            >
              Cancel
            </button>
            {backend === 'api' && (
              <button
                onClick={handleTest}
                disabled={testing || !model.trim()}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
              >
                {testing ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin" />
                    Testing...
                  </span>
                ) : (
                  'Test Connection'
                )}
              </button>
            )}
            <button
              onClick={handleAdd}
              disabled={!isValid}
              className="rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              Add
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Edit Model Modal ──────────────────────────────────────────────────────────

function EditModelModal({
  model,
  onSave,
  onClose,
}: {
  model: ModelConfig;
  onSave: (config: Omit<ModelConfig, 'hasApiKey'> & { apiKey?: string }) => void;
  onClose: () => void;
}) {
  const backend = model.backend;
  const [name, setName] = useState(model.name);
  const [provider, setProvider] = useState<'anthropic' | 'openai' | 'gemini' | 'custom'>(
    model.provider ?? 'openai',
  );
  const [modelName, setModelName] = useState(model.model ?? '');
  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState(model.baseURL ?? '');
  const [command, setCommand] = useState(model.command ?? '');
  const [envVars, setEnvVars] = useState(model.envVars ?? '');
  const [showKey, setShowKey] = useState(false);
  const [providerOpen, setProviderOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [loading, setLoading] = useState(true);

  // Load API key on mount
  useEffect(() => {
    if (backend === 'api') {
      ipc.getModelApiKey(model.id).then((key) => {
        setApiKey(key ?? '');
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, [model.id, backend]);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSave = async () => {
    const displayName =
      name.trim() || (backend === 'api' ? `${provider}/${modelName}` : command.split(' ')[0]);
    if (!displayName) return;
    await onSave({
      id: model.id,
      name: displayName,
      kind: model.kind,
      backend,
      ...(backend === 'api'
        ? {
            provider,
            model: modelName,
            apiKey: apiKey.trim() || undefined,
            baseURL: baseURL.trim() || undefined,
          }
        : {}),
      ...(backend === 'cli' ? { command: command.trim(), envVars: envVars.trim() } : {}),
    });
    onClose();
  };

  const isValid = backend === 'api' ? !!modelName.trim() : !!command.trim();

  const handleTest = async () => {
    if (backend !== 'api' || !modelName.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await ipc.testModelConnection({
        provider,
        model: modelName.trim(),
        apiKey: apiKey.trim() || undefined,
        baseURL: baseURL.trim() || undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-lg rounded-2xl border border-notion-border bg-white p-6 shadow-xl"
          >
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
          className="w-full max-w-lg rounded-2xl border border-notion-border bg-white p-6 shadow-xl"
        >
          <h2 className="mb-1 text-base font-semibold text-notion-text">
            Edit {MODEL_KIND_META[model.kind].label} Model
          </h2>
          <p className="mb-4 text-xs text-notion-text-tertiary">
            {backend === 'cli' ? 'CLI subprocess' : 'API direct'}
          </p>

          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                Name <span className="font-normal text-notion-text-tertiary">(optional)</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  backend === 'api'
                    ? `e.g. ${provider}/${modelName || 'model-name'}`
                    : 'e.g. Claude Code'
                }
                className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>

            {backend === 'api' ? (
              <>
                {/* Provider */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Provider
                  </label>
                  <div className="relative" data-provider-select>
                    <button
                      type="button"
                      onClick={() => setProviderOpen((o) => !o)}
                      className="flex w-full items-center justify-between rounded-lg border border-notion-border bg-white px-3 py-2.5 text-sm text-notion-text transition-colors hover:border-blue-300 focus:outline-none"
                    >
                      <span>{API_PROVIDER_OPTIONS.find((p) => p.id === provider)?.label}</span>
                      <ChevronDown
                        size={14}
                        className={`text-notion-text-tertiary transition-transform ${providerOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                    {providerOpen && (
                      <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-notion-border bg-white shadow-lg">
                        {API_PROVIDER_OPTIONS.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setProvider(opt.id);
                              setProviderOpen(false);
                            }}
                            className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors hover:bg-notion-sidebar ${provider === opt.id ? 'bg-blue-50 text-blue-700' : 'text-notion-text'}`}
                          >
                            {opt.label}
                            {provider === opt.id && <Check size={13} className="text-blue-600" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Model */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Model ID
                  </label>
                  <ModelCombobox
                    value={modelName}
                    onChange={setModelName}
                    placeholder="选择或输入模型ID"
                  />
                </div>

                {/* Base URL (optional override) */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Base URL{' '}
                    <span className="font-normal text-notion-text-tertiary">
                      (optional, for proxy/custom endpoint)
                    </span>
                  </label>
                  <input
                    value={baseURL}
                    onChange={(e) => setBaseURL(e.target.value)}
                    placeholder={
                      provider === 'anthropic'
                        ? 'https://api.anthropic.com (default)'
                        : provider === 'openai'
                          ? 'https://api.openai.com/v1 (default)'
                          : provider === 'gemini'
                            ? 'https://generativelanguage.googleapis.com (default)'
                            : 'https://your-proxy.example.com/v1'
                    }
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>

                {/* API Key */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    API Key{' '}
                    <span className="font-normal text-notion-text-tertiary">
                      (optional if set via env)
                    </span>
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 pr-10 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey((p) => !p)}
                      className="absolute right-3 text-notion-text-tertiary hover:text-notion-text"
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* CLI Command */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Command
                  </label>
                  <input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder="e.g. claude --dangerously-skip-permissions"
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                {/* Env Vars */}
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                    Environment Variables{' '}
                    <span className="font-normal text-notion-text-tertiary">(optional)</span>
                  </label>
                  <input
                    value={envVars}
                    onChange={(e) => setEnvVars(e.target.value)}
                    placeholder="ANTHROPIC_API_KEY=sk-..."
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </>
            )}
          </div>

          {/* Test result */}
          {testResult && (
            <div
              className={`mt-3 rounded-lg px-3 py-2 text-sm ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
            >
              {testResult.success
                ? '✓ Connection successful!'
                : `✗ ${testResult.error || 'Connection failed'}`}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
            >
              Cancel
            </button>
            {backend === 'api' && (
              <button
                onClick={handleTest}
                disabled={testing || !modelName.trim()}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
              >
                {testing ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin" />
                    Testing...
                  </span>
                ) : (
                  'Test Connection'
                )}
              </button>
            )}
            <button
              onClick={handleSave}
              disabled={!isValid}
              className="rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ModelCard({
  model,
  isActive,
  onSetActive,
  onEdit,
  onDelete,
}: {
  model: ModelConfig;
  isActive: boolean;
  onSetActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const subtitle =
    model.backend === 'api'
      ? `${API_PROVIDER_OPTIONS.find((p) => p.id === model.provider)?.label ?? model.provider} · ${model.model ?? '—'}`
      : (model.command ?? '—');

  const handleTest = async () => {
    if (model.backend !== 'api') return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await ipc.testSavedModelConnection(model.id);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        isActive ? 'border-blue-200 bg-blue-50/40 shadow-sm' : 'border-notion-border bg-white'
      }`}
    >
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-notion-text truncate">{model.name}</span>
            {isActive && (
              <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-2xs font-medium text-blue-700">
                Active
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-notion-text-tertiary">{subtitle}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {model.backend === 'api' && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
            >
              {testing ? (
                <span className="flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  Testing...
                </span>
              ) : (
                'Test'
              )}
            </button>
          )}
          {!isActive && (
            <button
              onClick={onSetActive}
              className="rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
            >
              Activate
            </button>
          )}
          <button
            onClick={onEdit}
            className="rounded-lg p-1.5 text-notion-text-tertiary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
            title="Edit"
          >
            <Pencil size={14} />
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg p-1.5 text-notion-text-tertiary transition-colors hover:bg-red-50 hover:text-red-500"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Test result */}
      {testResult && (
        <div
          className={`mt-3 rounded-lg px-3 py-2 text-xs ${
            testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {testResult.success
            ? '✓ Connection successful!'
            : `✗ ${testResult.error || 'Connection failed'}`}
        </div>
      )}
    </div>
  );
}
function ModelKindSection({
  kind,
  models,
  activeId,
  onSetActive,
  onEdit,
  onDelete,
  onAdd,
}: {
  kind: ModelKind;
  models: ModelConfig[];
  activeId: string | null;
  onSetActive: (id: string) => void;
  onEdit: (model: ModelConfig) => void;
  onDelete: (id: string) => void;
  onAdd: (kind: ModelKind) => void;
}) {
  const { label, description, Icon } = MODEL_KIND_META[kind];

  return (
    <div className="rounded-xl border border-notion-border bg-white">
      {/* Section header */}
      <div className="flex items-center justify-between border-b border-notion-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-notion-sidebar">
            <Icon size={16} className="text-notion-text-secondary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-notion-text">{label}</h3>
            <p className="text-xs text-notion-text-tertiary">{description}</p>
          </div>
        </div>
        <button
          onClick={() => onAdd(kind)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
        >
          <Plus size={12} />
          Add
        </button>
      </div>

      {/* Model list */}
      <div className="p-4">
        {models.length === 0 ? (
          <p className="py-3 text-center text-xs text-notion-text-tertiary">
            No models configured. Click Add to set one up.
          </p>
        ) : (
          <div className="space-y-2">
            {models.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                isActive={m.id === activeId}
                onSetActive={() => onSetActive(m.id)}
                onEdit={() => onEdit(m)}
                onDelete={() => onDelete(m.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ModelsSettings() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [activeIds, setActiveIds] = useState<Record<ModelKind, string | null>>({
    agent: null,
    lightweight: null,
    chat: null,
  });
  const [loading, setLoading] = useState(true);
  const [addingKind, setAddingKind] = useState<ModelKind | null>(null);
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [ms, ids] = await Promise.all([ipc.listModels(), ipc.getActiveModelIds()]);
      setModels(ms);
      setActiveIds(ids);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = async (config: Omit<ModelConfig, 'hasApiKey'> & { apiKey?: string }) => {
    try {
      setSaveError(null);
      await ipc.saveModel(config);
      const [ms, ids] = await Promise.all([ipc.listModels(), ipc.getActiveModelIds()]);
      setModels(ms);
      setActiveIds(ids);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSetActive = async (kind: ModelKind, id: string) => {
    await ipc.setActiveModel(kind, id);
    setActiveIds((prev) => ({ ...prev, [kind]: id }));
  };

  const handleDelete = async (id: string) => {
    await ipc.deleteModel(id);
    const [ms, ids] = await Promise.all([ipc.listModels(), ipc.getActiveModelIds()]);
    setModels(ms);
    setActiveIds(ids);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-notion-text-secondary">
        Configure models for each role. You can add multiple and activate one per role.
      </p>
      {saveError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
          Error: {saveError}
        </div>
      )}
      {(['agent', 'lightweight', 'chat'] as ModelKind[]).map((kind) => (
        <ModelKindSection
          key={kind}
          kind={kind}
          models={models.filter((m) => m.kind === kind)}
          activeId={activeIds[kind]}
          onSetActive={(id) => handleSetActive(kind, id)}
          onEdit={setEditingModel}
          onDelete={handleDelete}
          onAdd={setAddingKind}
        />
      ))}
      {addingKind && (
        <AddModelModal
          defaultKind={addingKind}
          onAdd={handleAdd}
          onClose={() => setAddingKind(null)}
        />
      )}
      {editingModel && (
        <EditModelModal
          model={editingModel}
          onSave={handleAdd}
          onClose={() => setEditingModel(null)}
        />
      )}

      {/* Usage section */}
      <div className="mt-8">
        <div className="mb-4 border-t border-notion-border pt-6">
          <h2 className="text-sm font-semibold text-notion-text">Token Usage</h2>
          <p className="mt-0.5 text-xs text-notion-text-tertiary">
            API call statistics across all models
          </p>
        </div>
        <UsageSettings />
      </div>
    </div>
  );
}

// ─── Usage Settings ──────────────────────────────────────────────────────────

function UsageSettings() {
  const [records, setRecords] = useState<TokenUsageRecord[]>([]);
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null);
  const [view, setView] = useState<'summary' | 'records'>('summary');

  useEffect(() => {
    ipc.getTokenUsageRecords().then((r) => setRecords(r));
    ipc.getTokenUsageSummary().then((s) => setSummary(s));
  }, []);

  const handleClear = async () => {
    if (confirm('Clear all token usage data?')) {
      await ipc.clearTokenUsage();
      setRecords([]);
      setSummary(null);
    }
  };

  // Group records by hour for line chart (nivo format)
  const lineChartData = useMemo(() => {
    const byHour: Record<string, Record<string, number>> = {};
    const modelSet = new Set<string>();

    for (const r of records) {
      const hour = r.timestamp.slice(0, 13); // YYYY-MM-DDTHH
      const modelKey = `${r.provider}/${r.model}`;
      modelSet.add(modelKey);

      if (!byHour[hour]) {
        byHour[hour] = {};
      }
      if (!byHour[hour][modelKey]) {
        byHour[hour][modelKey] = 0;
      }
      byHour[hour][modelKey] += r.totalTokens;
    }

    const sortedHours = Object.keys(byHour).sort().slice(-48); // last 48 hours

    return Array.from(modelSet)
      .slice(0, 6)
      .map((model) => ({
        id: model,
        data: sortedHours.map((hour) => ({
          x: hour,
          y: byHour[hour][model] || 0,
        })),
      }));
  }, [records]);

  const nivoColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  const formatNumber = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
  };

  const isEmpty = records.length === 0;

  return (
    <div className="space-y-5">
      {/* Summary stats */}
      {summary && !isEmpty ? (
        <div className="grid grid-cols-4 gap-3">
          {[
            {
              label: 'Total Tokens',
              value: formatNumber(summary.totalTokens),
              accent: 'text-blue-600',
            },
            { label: 'API Calls', value: String(summary.totalCalls), accent: 'text-emerald-600' },
            {
              label: 'Prompt',
              value: formatNumber(summary.totalPromptTokens),
              accent: 'text-amber-600',
            },
            {
              label: 'Completion',
              value: formatNumber(summary.totalCompletionTokens),
              accent: 'text-purple-600',
            },
          ].map(({ label, value, accent }) => (
            <div key={label} className="rounded-xl border border-notion-border bg-white px-4 py-3">
              <div className={`text-xl font-semibold tabular-nums ${accent}`}>{value}</div>
              <div className="mt-0.5 text-xs text-notion-text-tertiary">{label}</div>
            </div>
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-notion-border bg-notion-sidebar py-12 text-center">
          <BarChart3 size={32} className="mb-3 text-notion-text-tertiary opacity-40" />
          <p className="text-sm font-medium text-notion-text-secondary">No usage data yet</p>
          <p className="mt-1 text-xs text-notion-text-tertiary">
            Token usage will appear here after you make AI API calls.
          </p>
        </div>
      ) : null}

      {/* Line Chart */}
      {lineChartData.length > 0 && lineChartData[0].data.length > 0 && (
        <div className="rounded-xl border border-notion-border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-notion-text-tertiary">
              Token Usage · Last 48h
            </h3>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveLine
              data={lineChartData}
              margin={{ top: 10, right: 100, bottom: 44, left: 52 }}
              xScale={{ type: 'point' }}
              yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
              curve="monotoneX"
              axisTop={null}
              axisRight={null}
              axisBottom={{
                tickSize: 0,
                tickPadding: 8,
                tickRotation: -40,
                format: (v: string) => v.slice(11, 16),
                tickValues: 'every 4 hours',
              }}
              axisLeft={{
                tickSize: 0,
                tickPadding: 8,
                tickRotation: 0,
                format: (v: number) => formatNumber(v),
              }}
              theme={{
                axis: {
                  ticks: { text: { fontSize: 10, fill: '#9ca3af' } },
                },
                grid: { line: { stroke: '#f3f4f6', strokeWidth: 1 } },
              }}
              colors={nivoColors}
              lineWidth={2}
              pointSize={0}
              enableArea={true}
              areaOpacity={0.08}
              useMesh={true}
              animate={true}
              motionConfig="gentle"
              enableGridX={false}
              legends={[
                {
                  anchor: 'bottom-right',
                  direction: 'column',
                  justify: false,
                  translateX: 92,
                  translateY: 0,
                  itemsSpacing: 3,
                  itemDirection: 'left-to-right',
                  itemWidth: 80,
                  itemHeight: 16,
                  itemOpacity: 0.8,
                  symbolSize: 8,
                  symbolShape: 'circle',
                },
              ]}
              tooltip={({ point }) => (
                <div className="rounded-lg border border-notion-border bg-white px-3 py-2 shadow-md">
                  <div className="mb-1 text-xs font-semibold text-notion-text">
                    {point.seriesId}
                  </div>
                  <div className="text-xs text-notion-text-secondary">
                    {(point.data.x as string).slice(11, 16)}{' '}
                    <span className="font-semibold text-notion-text">
                      {formatNumber(point.data.y as number)}
                    </span>{' '}
                    tokens
                  </div>
                </div>
              )}
            />
          </div>
        </div>
      )}

      {/* By Model / Records tabs */}
      {!isEmpty && (
        <>
          <div className="flex items-center gap-1 rounded-lg border border-notion-border bg-notion-sidebar p-1">
            {(['summary', 'records'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  view === v
                    ? 'bg-white text-notion-text shadow-sm'
                    : 'text-notion-text-secondary hover:text-notion-text'
                }`}
              >
                {v === 'summary' ? 'By Model' : 'Records'}
              </button>
            ))}
          </div>

          {view === 'summary' && summary && (
            <div className="rounded-xl border border-notion-border bg-white">
              {Object.entries(summary.byModel).map(([model, data], i, arr) => {
                const maxTotal = Math.max(...Object.values(summary.byModel).map((d) => d.total));
                const pct = maxTotal > 0 ? (data.total / maxTotal) * 100 : 0;
                return (
                  <div
                    key={model}
                    className={`px-4 py-3 ${i < arr.length - 1 ? 'border-b border-notion-border' : ''}`}
                  >
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="font-mono text-xs text-notion-text">{model}</span>
                      <div className="flex items-center gap-3 text-xs text-notion-text-secondary">
                        <span>{data.calls} calls</span>
                        <span className="font-semibold text-notion-text">
                          {formatNumber(data.total)}
                        </span>
                      </div>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-notion-sidebar">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {view === 'records' && (
            <div className="rounded-xl border border-notion-border bg-white">
              <div className="max-h-80 overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-notion-border">
                      {['Time', 'Model', 'Prompt', 'Completion', 'Total'].map((h, i) => (
                        <th
                          key={h}
                          className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-notion-text-tertiary ${
                            i >= 2 ? 'text-right' : 'text-left'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {records
                      .slice()
                      .reverse()
                      .slice(0, 100)
                      .map((r, i) => (
                        <tr
                          key={i}
                          className="border-b border-notion-border last:border-0 hover:bg-notion-sidebar/50"
                        >
                          <td className="px-3 py-2 font-mono text-xs text-notion-text-tertiary">
                            {r.timestamp.slice(0, 16).replace('T', ' ')}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-notion-text">
                            {r.provider}/{r.model}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-notion-text-secondary">
                            {formatNumber(r.promptTokens)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums text-notion-text-secondary">
                            {formatNumber(r.completionTokens)}
                          </td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums font-semibold text-notion-text">
                            {formatNumber(r.totalTokens)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Clear button */}
      {!isEmpty && (
        <div className="flex justify-end">
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-notion-text-tertiary transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <Trash size={12} />
            Clear data
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Proxy Settings ──────────────────────────────────────────────────────────

function ProxySettings() {
  const [proxy, setProxy] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    ipc
      .getSettings()
      .then((s) => {
        setProxy(s.proxy ?? '');
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await ipc.setProxy(proxy.trim() || undefined);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="mb-5 text-sm text-notion-text-secondary">
        Configure HTTP or SOCKS proxy for network requests.
      </p>
      <div className="rounded-xl border border-notion-border bg-white p-5">
        <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
          HTTP/SOCKS Proxy <span className="font-normal text-notion-text-tertiary">(optional)</span>
        </label>
        <input
          value={proxy}
          onChange={(e) => setProxy(e.target.value)}
          placeholder="e.g. http://127.0.0.1:7890 or socks5://127.0.0.1:1080"
          className="w-full rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <p className="mt-2 text-xs text-notion-text-tertiary">
          Used for PDF downloads, CLI tools, and AI API calls.
        </p>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saved ? (
              <Check size={14} />
            ) : null}
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MaintenanceSettings() {
  const [fixingTitles, setFixingTitles] = useState(false);
  const [strippingPrefix, setStrippingPrefix] = useState(false);
  const [fixResult, setFixResult] = useState<{ fixed: number; failed: number } | null>(null);
  const [stripResult, setStripResult] = useState<{ updated: number } | null>(null);

  const handleFixUrlTitles = async () => {
    setFixingTitles(true);
    setFixResult(null);
    try {
      const result = await ipc.fixUrlTitles();
      setFixResult(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to fix titles');
    } finally {
      setFixingTitles(false);
    }
  };

  const handleStripArxivIdPrefix = async () => {
    setStrippingPrefix(true);
    setStripResult(null);
    try {
      const result = await ipc.stripArxivIdPrefix();
      setStripResult(result);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to strip prefixes');
    } finally {
      setStrippingPrefix(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-notion-border bg-white p-5">
        <h3 className="text-base font-semibold text-notion-text mb-2">Fix Paper Titles</h3>
        <p className="text-sm text-notion-text-secondary mb-4">
          Find papers whose title looks like a URL or raw arXiv ID, fetch the real title from
          arxiv.org, and update it.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleFixUrlTitles}
            disabled={fixingTitles}
            className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-40"
          >
            {fixingTitles ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Fix Titles
          </button>
          {fixResult && (
            <span className="text-sm text-notion-text-secondary">
              Fixed {fixResult.fixed} papers, {fixResult.failed} failed
            </span>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-notion-border bg-white p-5">
        <h3 className="text-base font-semibold text-notion-text mb-2">Strip ArXiv ID Prefix</h3>
        <p className="text-sm text-notion-text-secondary mb-4">
          Remove the [arxivId] prefix from all paper titles for cleaner display.
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={handleStripArxivIdPrefix}
            disabled={strippingPrefix}
            className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2 text-sm font-medium text-notion-text shadow-sm transition-all hover:bg-notion-sidebar disabled:opacity-40"
          >
            {strippingPrefix ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Strip Prefixes
          </button>
          {stripResult && (
            <span className="text-sm text-notion-text-secondary">
              Updated {stripResult.updated} papers
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('models');

  const tabs: Array<{ id: Tab; label: string; icon: React.ElementType }> = [
    { id: 'models', label: 'Models', icon: Cpu },
    { id: 'editor', label: 'Editor', icon: Code2 },
    { id: 'storage', label: 'Storage', icon: HardDrive },
    { id: 'proxy', label: 'Proxy', icon: Globe },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
  ];

  return (
    <>
      <div className="mb-6 flex items-center gap-3">
        <Settings size={22} className="text-notion-text-tertiary" />
        <h1 className="text-2xl font-bold tracking-tight text-notion-text">Settings</h1>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-notion-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors"
            >
              <span
                className={
                  isActive
                    ? 'text-notion-text'
                    : 'text-notion-text-secondary hover:text-notion-text'
                }
              >
                <Icon size={15} />
              </span>
              <span
                className={
                  isActive
                    ? 'text-notion-text'
                    : 'text-notion-text-secondary hover:text-notion-text'
                }
              >
                {tab.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="settingsTabIndicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-notion-text"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'models' && <ModelsSettings />}
        {activeTab === 'editor' && <EditorSettings />}
        {activeTab === 'storage' && <StorageSettings />}
        {activeTab === 'proxy' && <ProxySettings />}
        {activeTab === 'maintenance' && <MaintenanceSettings />}
      </div>
    </>
  );
}
