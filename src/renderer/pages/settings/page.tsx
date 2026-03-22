import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from 'i18next';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Fuse from 'fuse.js';
import {
  ipc,
  onIpc,
  type ImportStatus,
  type ModelConfig,
  type ModelKind,
  type ModelBackend,
  type CliTestDiagnostics,
  type ProviderKind,
  type CliConfig,
  type TokenUsageRecord,
  type TokenUsageSummary,
  type ProxyScope,
  type ProxyTestResult,
  type SemanticSearchSettings,
  type SemanticEmbeddingTestResult,
  type EmbeddingConfig,
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
  ChevronRight,
  RefreshCw,
  Code2,
  Cpu,
  Zap,
  Globe,
  BarChart3,
  Trash,
  Pencil,
  X,
  Bot,
  Server,
  Sparkles,
  Download,
  AlertTriangle,
  Search,
  LogIn,
} from 'lucide-react';
import { ResponsiveLine } from '@nivo/line';
import { ModelCombobox } from '../../components/model-combobox';
import { AgentSettings } from '../../components/settings/AgentSettings';
import {
  type SectionId,
  NAV_GROUPS,
  SECTION_META,
  filterNavGroups,
  getFilteredSectionIds,
  toggleCollapsed,
  isGroupExpanded,
} from './settings-nav';

// ─── Timeout Helper ───────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message ?? `Timed out after ${ms}ms`)), ms),
    ),
  ]);
}

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  return createPortal(
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
    </AnimatePresence>,
    document.body,
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
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
    output?: string;
    diagnostics?: CliTestDiagnostics;
    logFile?: string;
  } | null>(null);
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
          ? { success: true, error: undefined, output: res.output }
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

      <div className="mt-4 flex items-center justify-between gap-3">
        <AnimatePresence mode="wait">
          {testResult && (
            <motion.div
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ duration: 0.15 }}
              className={`flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
              }`}
            >
              {testResult.success ? (
                <Check size={13} className="shrink-0 text-green-600" strokeWidth={2.5} />
              ) : (
                <X size={13} className="shrink-0 text-red-500" strokeWidth={2.5} />
              )}
              <span className="font-mono truncate">
                {testResult.success
                  ? (testResult.output?.slice(0, 300) ?? 'Command found')
                  : (testResult.error?.slice(0, 300) ?? 'Failed')}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
        <button
          onClick={handleTest}
          disabled={testing || !tool.command.trim()}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-notion-border px-3.5 py-2 text-sm font-medium text-notion-text transition-all hover:bg-notion-sidebar hover:shadow-sm disabled:opacity-50"
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

// ─── Language Settings ────────────────────────────────────────────────────────

function LanguageSettings() {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [currentLang, setCurrentLang] = useState<'en' | 'zh'>(
    () => (i18n.language as 'en' | 'zh') ?? 'en',
  );

  const handleChange = async (lang: 'en' | 'zh') => {
    if (lang === currentLang) return;
    setSaving(true);
    try {
      await ipc.setLanguage(lang);
      localStorage.setItem('researchclaw-language', lang);
      await i18n.changeLanguage(lang);
      setCurrentLang(lang);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="mb-5 text-sm text-notion-text-secondary">
        {t('settings.language.description')}
      </p>

      <div className="rounded-lg border border-notion-border bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-notion-text">{t('settings.language.title')}</h3>
          </div>
          <div className="flex items-center rounded-lg border border-notion-border bg-notion-sidebar p-0.5">
            <button
              onClick={() => handleChange('en')}
              disabled={saving}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                currentLang === 'en'
                  ? 'bg-white text-notion-text shadow-sm'
                  : 'text-notion-text-tertiary hover:text-notion-text-secondary'
              }`}
            >
              {t('settings.language.en')}
            </button>
            <button
              onClick={() => handleChange('zh')}
              disabled={saving}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                currentLang === 'zh'
                  ? 'bg-white text-notion-text shadow-sm'
                  : 'text-notion-text-tertiary hover:text-notion-text-secondary'
              }`}
            >
              {t('settings.language.zh')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Overleaf Settings ──────────────────────────────────────────────────────────

function OverleafSettings() {
  const { t } = useTranslation();
  const [cookie, setCookie] = useState('');
  const [hasCookie, setHasCookie] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showCookie, setShowCookie] = useState(false);

  useEffect(() => {
    ipc.getOverleafSession().then(({ hasCookie: has, masked }) => {
      setHasCookie(has);
      if (masked) setCookie(masked);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await ipc.setOverleafSession(cookie);
      setHasCookie(true);
      setTestResult(null);
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { valid } = await ipc.testOverleafSession();
      setTestResult({
        ok: valid,
        msg: valid ? t('settings.overleaf.testSuccess') : t('settings.overleaf.testFailed'),
      });
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await ipc.setOverleafSession('');
      setCookie('');
      setHasCookie(false);
      setTestResult(null);
    } finally {
      setSaving(false);
    }
  };

  const handleAutoDetect = async () => {
    setAutoDetecting(true);
    setTestResult(null);
    try {
      const result = await ipc.openOverleafLoginWindow();
      if (result.success && result.autoDetected) {
        // Refresh session state
        const { hasCookie: has, masked } = await ipc.getOverleafSession();
        setHasCookie(has);
        if (masked) setCookie(masked);
        setTestResult({ ok: true, msg: t('settings.overleaf.autoDetectSuccess') });
      } else {
        setTestResult({ ok: false, msg: t('settings.overleaf.autoDetectFailed') });
      }
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setAutoDetecting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  return (
    <div>
      <p className="mb-5 text-sm text-notion-text-secondary">
        {t('settings.overleaf.description')}
      </p>

      <div className="rounded-xl border border-notion-border bg-white p-5">
        <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
          {t('settings.overleaf.sessionCookie')}
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showCookie ? 'text' : 'password'}
              value={cookie}
              onChange={(e) => setCookie(e.target.value)}
              placeholder={t('settings.overleaf.cookiePlaceholder')}
              className="w-full rounded-lg border border-notion-border bg-notion-sidebar px-3 py-2.5 pr-10 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <button
              onClick={() => setShowCookie(!showCookie)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary hover:text-notion-text"
            >
              {showCookie ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <button
            onClick={handleSave}
            disabled={saving || !cookie.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2.5 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            {t('common.save')}
          </button>
        </div>
        <p className="mt-2 text-xs text-notion-text-tertiary">
          {t('settings.overleaf.cookieHelp')}
        </p>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={handleAutoDetect}
            disabled={autoDetecting}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-accent px-3 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
          >
            {autoDetecting ? <Loader2 size={14} className="animate-spin" /> : <LogIn size={14} />}
            {autoDetecting ? t('settings.overleaf.detecting') : t('settings.overleaf.autoDetect')}
          </button>
          <button
            onClick={handleTest}
            disabled={testing || !hasCookie}
            className="inline-flex items-center gap-2 rounded-lg border border-notion-border bg-white px-3 py-2 text-sm text-notion-text transition-colors hover:bg-notion-sidebar-hover disabled:opacity-50"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
            {testing ? t('common.testing') : t('common.test')}
          </button>
          {hasCookie && (
            <button
              onClick={handleClear}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              {t('common.clear')}
            </button>
          )}
          {testResult && (
            <span className={testResult.ok ? 'text-sm text-green-600' : 'text-sm text-red-600'}>
              {testResult.msg}
            </span>
          )}
        </div>
      </div>

      <details className="mt-4 rounded-lg border border-notion-border bg-white/70">
        <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-notion-text-secondary">
          {t('settings.overleaf.howToGetCookie')}
        </summary>
        <div className="border-t border-notion-border px-4 py-3 text-xs text-notion-text-secondary">
          <ol className="list-decimal list-inside space-y-1.5">
            <li>{t('settings.overleaf.step1')}</li>
            <li>{t('settings.overleaf.step2')}</li>
            <li>{t('settings.overleaf.step3')}</li>
            <li>{t('settings.overleaf.step4')}</li>
          </ol>
        </div>
      </details>
    </div>
  );
}

// ─── Developer Settings ─────────────────────────────────────────────────────────

function DeveloperSettings() {
  const { t } = useTranslation();
  const [devMode, setDevMode] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    ipc
      .getDevMode()
      .then((result) => setDevMode(result.enabled))
      .catch(() => {});
  }, []);

  const handleToggle = async () => {
    setLoading(true);
    try {
      const newValue = !devMode;
      await ipc.setDevMode(newValue);
      setDevMode(newValue);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="mb-5 text-sm text-notion-text-secondary">{t('settings.dev.description')}</p>

      <div className="rounded-lg border border-notion-border bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-notion-text">{t('settings.dev.title')}</h3>
            <p className="mt-0.5 text-xs text-notion-text-tertiary">
              {t('settings.dev.toggleLabel')}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={loading}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              devMode ? 'bg-notion-accent' : 'bg-notion-border'
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                devMode ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Editor Settings ─────────────────────────────────────────────────────────

function EditorSettings() {
  const { t } = useTranslation();
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
        setTestResult({ ok: true, msg: t('settings.editor.testSuccess') });
      } else {
        setTestResult({ ok: false, msg: t('settings.editor.testFailed') });
      }
    } catch {
      setTestResult({ ok: false, msg: t('settings.editor.testFailed') });
    } finally {
      setTesting(false);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  return (
    <div>
      <p className="mb-5 text-sm text-notion-text-secondary">{t('settings.editor.description')}</p>

      <div className="grid grid-cols-3 gap-2">
        {EDITOR_OPTIONS.map((editor) => {
          const isSelected = selectedEditor === editor.id;
          return (
            <button
              key={editor.id}
              onClick={() => handleSelectEditor(editor.id)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                isSelected
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-notion-border bg-white hover:border-notion-text-tertiary hover:bg-notion-sidebar/40'
              }`}
            >
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-notion-sidebar">
                <editor.Icon />
              </div>
              <div className="min-w-0 flex-1">
                <span
                  className={`truncate text-sm font-medium ${isSelected ? 'text-blue-700' : 'text-notion-text'}`}
                >
                  {editor.name}
                </span>
              </div>
              {isSelected && <Check size={13} className="shrink-0 text-blue-600" />}
            </button>
          );
        })}
      </div>

      {/* Custom command input */}
      {selectedEditor === 'custom' && (
        <div className="mt-4 rounded-xl border border-notion-border bg-white p-5">
          <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
            {t('settings.editor.customCommand')}
          </label>
          <div className="flex items-center gap-2">
            <input
              value={customCommand}
              onChange={(e) => setCustomCommand(e.target.value)}
              placeholder={t('settings.editor.customPlaceholder')}
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
              {saved ? t('common.saved') : saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
          <p className="mt-2 text-xs text-notion-text-tertiary">
            {t('settings.editor.description')}
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
          {testing ? t('common.testing') : t('common.test')}
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
  const [storageDir, setStorageDir] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingDir, setPendingDir] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipc
      .getStorageRoot()
      .then(setStorageDir)
      .catch(() => {});
  }, []);

  const handleSelectFolder = async () => {
    const dir = await ipc.selectFolder();
    if (dir) setStorageDir(dir);
  };

  const handleSave = () => {
    const trimmed = storageDir.trim();
    if (!trimmed) return;
    setPendingDir(trimmed);
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    setConfirmOpen(false);
    setSaving(true);
    setError(null);
    try {
      await ipc.setStorageDir(pendingDir);
      // App will relaunch — no further UI update needed
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div>
      <p className="mb-5 text-sm text-notion-text-secondary">
        Choose the root folder where all app data (database, papers, config) is stored. Changing
        this will migrate all data and restart the app.
      </p>
      <div className="rounded-xl border border-notion-border bg-white p-5">
        <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
          Storage folder
        </label>
        <div className="flex items-center gap-2">
          <input
            value={storageDir}
            onChange={(e) => setStorageDir(e.target.value)}
            placeholder="e.g. /home/you/.local/share/researchclaw"
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
          All app data (papers, notes, database, config files) will be stored here. The app will
          restart after migration.
        </p>
        {error && <p className="mt-2 text-xs text-notion-red">{error}</p>}
        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || !storageDir.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {saving ? 'Migrating…' : 'Save & Restart'}
          </button>
        </div>
      </div>

      {/* Confirm migration dialog */}
      <AnimatePresence>
        {confirmOpen && (
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
              className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            >
              <h3 className="mb-2 text-base font-semibold text-notion-text">Migrate storage?</h3>
              <p className="mb-1 text-sm text-notion-text-secondary">
                All data (database, papers, config files) will be copied to:
              </p>
              <p className="mb-4 break-all rounded-lg bg-notion-sidebar px-3 py-2 font-mono text-xs text-notion-text">
                {pendingDir}
              </p>
              <p className="mb-5 text-sm text-notion-text-secondary">
                The app will restart after migration. Old files will not be deleted.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary hover:bg-notion-sidebar"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  className="rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white hover:opacity-80"
                >
                  Migrate & Restart
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
    description: 'CLI-based model for agent tasks. Configured in Agent Settings.',
    Icon: Bot,
  },
  lightweight: {
    label: 'Lightweight',
    description: 'Fast, low-cost model for tagging, summaries, and classification.',
    Icon: Zap,
  },
};

// lightweight is always API; agent uses CLI (managed in AgentSettings)
const KIND_BACKEND: Record<ModelKind, ModelBackend> = {
  agent: 'cli',
  lightweight: 'api',
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

function CliDiagnosticsPanel({
  diagnostics,
  logFile,
}: {
  diagnostics?: CliTestDiagnostics;
  logFile?: string;
}) {
  if (!diagnostics) return null;

  const blocks = [
    diagnostics.structuredOutput
      ? { label: 'Structured output', value: diagnostics.structuredOutput }
      : null,
    diagnostics.stdout ? { label: 'Raw stdout / JSONL', value: diagnostics.stdout } : null,
    diagnostics.stderr ? { label: 'Raw stderr', value: diagnostics.stderr } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <details className="mt-2 rounded-lg border border-notion-border bg-white/70">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-notion-text-secondary">
        Show CLI diagnostics
      </summary>
      <div className="space-y-2 border-t border-notion-border px-3 py-3">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          Diagnostics preview in the frontend is still under development. Please use the saved log
          and stdout/stderr files as the source of truth for now.
        </div>
        <div className="text-[11px] text-notion-text-tertiary">
          <span className="font-medium text-notion-text-secondary">Command:</span>{' '}
          {diagnostics.command} {diagnostics.args.join(' ')}
          {diagnostics.timedOut
            ? ' · timed out'
            : diagnostics.exitCode !== undefined
              ? ` · exit ${String(diagnostics.exitCode)}`
              : ''}
        </div>
        {blocks.map((block) => (
          <div key={block.label}>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-notion-text-tertiary">
              {block.label}
            </div>
            <pre className="max-h-56 overflow-auto rounded-md bg-notion-sidebar px-3 py-2 text-[11px] leading-5 text-notion-text whitespace-pre-wrap break-words">
              {block.value}
            </pre>
          </div>
        ))}
        {logFile && (
          <div className="text-[11px] text-notion-text-tertiary">
            <span className="font-medium text-notion-text-secondary">Log file:</span> {logFile}
          </div>
        )}
        {diagnostics.stdoutFile && (
          <div className="text-[11px] text-notion-text-tertiary">
            <span className="font-medium text-notion-text-secondary">Stdout file:</span>{' '}
            {diagnostics.stdoutFile}
          </div>
        )}
        {diagnostics.stderrFile && (
          <div className="text-[11px] text-notion-text-tertiary">
            <span className="font-medium text-notion-text-secondary">Stderr file:</span>{' '}
            {diagnostics.stderrFile}
          </div>
        )}
        {diagnostics.structuredOutputFile && (
          <div className="text-[11px] text-notion-text-tertiary">
            <span className="font-medium text-notion-text-secondary">Structured file:</span>{' '}
            {diagnostics.structuredOutputFile}
          </div>
        )}
      </div>
    </details>
  );
}

function makeModelId() {
  return Math.random().toString(36).slice(2, 10);
}

function AddModelModal({
  defaultKind,
  onAdd,
  onClose,
}: {
  defaultKind: ModelKind;
  onAdd: (
    config: Omit<ModelConfig, 'hasApiKey'> & { apiKey?: string },
    activateKind?: ModelKind,
  ) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
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
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
    output?: string;
    latencyMs?: number;
    diagnostics?: CliTestDiagnostics;
    logFile?: string;
  } | null>(null);
  const testDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    await onAdd(
      {
        id: makeModelId(),
        name: displayName,
        backend,
        ...(backend === 'api'
          ? {
              provider,
              model,
              apiKey: apiKey.trim() || undefined,
              baseURL: baseURL.trim() || undefined,
            }
          : {}),
        ...(backend === 'cli'
          ? {
              command: command.trim(),
              envVars: envVars.trim(),
            }
          : {}),
      },
      defaultKind,
    );
    onClose();
  };

  const isValid = backend === 'api' ? !!model.trim() : !!command.trim();

  const handleTest = async () => {
    if (backend === 'api') {
      if (!model.trim()) return;
    } else if (!command.trim()) {
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const result = await withTimeout(
        backend === 'api'
          ? ipc.testModelConnection({
              provider,
              model: model.trim(),
              apiKey: apiKey.trim() || undefined,
              baseURL: baseURL.trim() || undefined,
            })
          : ipc.testAgentCli({
              command: command.trim(),
              envVars: envVars.trim() || undefined,
            }),
        5000,
        'Test timed out after 5 seconds',
      );
      setTestResult(result);
      if (result.success) {
        if (testDismissTimer.current) clearTimeout(testDismissTimer.current);
        testDismissTimer.current = setTimeout(() => setTestResult(null), 3000);
      }
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  return createPortal(
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
          className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-notion-border bg-white shadow-xl"
        >
          <div className="shrink-0 px-6 pt-6">
            <h2 className="mb-1 text-base font-semibold text-notion-text">
              Add {MODEL_KIND_META[defaultKind].label} Model
            </h2>
            <p className="mb-4 text-xs text-notion-text-tertiary">
              {backend === 'cli' ? 'CLI subprocess' : 'API direct · saved once, reusable'}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6">
            <div className="space-y-4 pb-4">
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
                    <ModelCombobox
                      value={model}
                      onChange={setModel}
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
          </div>

          {/* Test result */}
          {testResult && (
            <div className="shrink-0 px-6">
              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
                    testResult.success
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-red-200 bg-red-50 text-red-600'
                  }`}
                >
                  {testResult.success ? (
                    <Check size={15} className="mt-px shrink-0 text-green-600" strokeWidth={2.5} />
                  ) : (
                    <X size={15} className="mt-px shrink-0 text-red-500" strokeWidth={2.5} />
                  )}
                  <span className="leading-snug">
                    {testResult.success
                      ? testResult.output ||
                        (testResult.latencyMs
                          ? t('settings.models.connectedWithLatency', { ms: testResult.latencyMs })
                          : t('settings.models.connected'))
                      : testResult.error || t('settings.models.connectionFailed')}
                  </span>
                </motion.div>
              </AnimatePresence>
              <CliDiagnosticsPanel
                diagnostics={testResult.diagnostics}
                logFile={testResult.logFile}
              />
            </div>
          )}

          <div className="shrink-0 flex justify-end gap-2 border-t border-notion-border px-6 py-4">
            <button
              onClick={onClose}
              className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
            >
              Cancel
            </button>
            {(backend === 'api' || backend === 'cli') && (
              <button
                onClick={handleTest}
                disabled={testing || (backend === 'api' ? !model.trim() : !command.trim())}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
              >
                {testing ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin" />
                    {t('settings.models.testing')}
                  </span>
                ) : (
                  t('settings.models.testConnection')
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
    </AnimatePresence>,
    document.body,
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
  const { t } = useTranslation();
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
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
    output?: string;
    latencyMs?: number;
    diagnostics?: CliTestDiagnostics;
    logFile?: string;
  } | null>(null);
  const testDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      backend,
      ...(backend === 'api'
        ? {
            provider,
            model: modelName,
            apiKey: apiKey.trim() || undefined,
            baseURL: baseURL.trim() || undefined,
          }
        : {}),
      ...(backend === 'cli'
        ? {
            command: command.trim(),
            envVars: envVars.trim(),
          }
        : {}),
    });
    onClose();
  };

  const isValid = backend === 'api' ? !!modelName.trim() : !!command.trim();

  const handleTest = async () => {
    if (backend === 'api') {
      if (!modelName.trim()) return;
    } else if (!command.trim()) {
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const result = await withTimeout(
        backend === 'api'
          ? ipc.testModelConnection({
              provider,
              model: modelName.trim(),
              apiKey: apiKey.trim() || undefined,
              baseURL: baseURL.trim() || undefined,
            })
          : ipc.testAgentCli({
              command: command.trim(),
              envVars: envVars.trim() || undefined,
            }),
        5000,
        'Test timed out after 5 seconds',
      );
      setTestResult(result);
      if (result.success) {
        if (testDismissTimer.current) clearTimeout(testDismissTimer.current);
        testDismissTimer.current = setTimeout(() => setTestResult(null), 3000);
      }
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return createPortal(
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
      </AnimatePresence>,
      document.body,
    );
  }

  return createPortal(
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
          className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-notion-border bg-white shadow-xl"
        >
          <div className="shrink-0 px-6 pt-6">
            <h2 className="mb-1 text-base font-semibold text-notion-text">Edit Model</h2>
            <p className="mb-4 text-xs text-notion-text-tertiary">
              {backend === 'cli'
                ? 'CLI subprocess'
                : 'API direct · changes apply anywhere this model is selected'}
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6">
            <div className="space-y-4 pb-4">
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
          </div>

          {/* Test result */}
          {testResult && (
            <div className="shrink-0 px-6">
              <AnimatePresence>
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.15 }}
                  className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
                    testResult.success
                      ? 'border-green-200 bg-green-50 text-green-700'
                      : 'border-red-200 bg-red-50 text-red-600'
                  }`}
                >
                  {testResult.success ? (
                    <Check size={15} className="mt-px shrink-0 text-green-600" strokeWidth={2.5} />
                  ) : (
                    <X size={15} className="mt-px shrink-0 text-red-500" strokeWidth={2.5} />
                  )}
                  <span className="leading-snug">
                    {testResult.success
                      ? testResult.output ||
                        (testResult.latencyMs
                          ? t('settings.models.connectedWithLatency', { ms: testResult.latencyMs })
                          : t('settings.models.connected'))
                      : testResult.error || t('settings.models.connectionFailed')}
                  </span>
                </motion.div>
              </AnimatePresence>
              <CliDiagnosticsPanel
                diagnostics={testResult.diagnostics}
                logFile={testResult.logFile}
              />
            </div>
          )}

          <div className="shrink-0 flex justify-end gap-2 border-t border-notion-border px-6 py-4">
            <button
              onClick={onClose}
              className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
            >
              Cancel
            </button>
            {(backend === 'api' || backend === 'cli') && (
              <button
                onClick={handleTest}
                disabled={testing || (backend === 'api' ? !modelName.trim() : !command.trim())}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
              >
                {testing ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 size={14} className="animate-spin" />
                    {t('settings.models.testing')}
                  </span>
                ) : (
                  t('settings.models.testConnection')
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
    </AnimatePresence>,
    document.body,
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
  const { t } = useTranslation();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    error?: string;
    output?: string;
    latencyMs?: number;
    diagnostics?: CliTestDiagnostics;
    logFile?: string;
  } | null>(null);
  const testDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subtitle =
    model.backend === 'api'
      ? `${API_PROVIDER_OPTIONS.find((p) => p.id === model.provider)?.label ?? model.provider} · ${model.model ?? '—'}`
      : (model.command ?? '—');

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await ipc.testSavedModelConnection(model.id);
      console.log('[agent-test-result]', model.id, result);
      setTestResult(result);
      if (result.success) {
        if (testDismissTimer.current) clearTimeout(testDismissTimer.current);
        testDismissTimer.current = setTimeout(() => setTestResult(null), 3000);
      }
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
                {t('settings.models.active')}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-notion-text-tertiary">{subtitle}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {(model.backend === 'api' || model.backend === 'cli') && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
            >
              {testing ? (
                <span className="flex items-center gap-1">
                  <Loader2 size={12} className="animate-spin" />
                  {t('settings.models.testing')}
                </span>
              ) : (
                t('settings.models.test')
              )}
            </button>
          )}
          {!isActive && (
            <button
              onClick={onSetActive}
              className="rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
            >
              {t('settings.models.activate')}
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
        <div>
          <AnimatePresence>
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className={`mt-3 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${
                testResult.success
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : 'border-red-200 bg-red-50 text-red-600'
              }`}
            >
              {testResult.success ? (
                <Check size={13} className="shrink-0 text-green-600" strokeWidth={2.5} />
              ) : (
                <X size={13} className="shrink-0 text-red-500" strokeWidth={2.5} />
              )}
              <span className="leading-snug">
                {testResult.success
                  ? testResult.output ||
                    (testResult.latencyMs
                      ? t('settings.models.connectedWithLatency', { ms: testResult.latencyMs })
                      : t('settings.models.connected'))
                  : testResult.error || t('settings.models.connectionFailed')}
              </span>
            </motion.div>
          </AnimatePresence>
          <CliDiagnosticsPanel diagnostics={testResult.diagnostics} logFile={testResult.logFile} />
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

function getModelsForKind(models: ModelConfig[], kind: ModelKind): ModelConfig[] {
  return models.filter((model) => model.backend === KIND_BACKEND[kind]);
}

function ModelsSettings() {
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [activeIds, setActiveIds] = useState<Record<ModelKind, string | null>>({
    agent: null,
    lightweight: null,
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

  const handleAdd = async (
    config: Omit<ModelConfig, 'hasApiKey'> & { apiKey?: string },
    activateKind?: ModelKind,
  ) => {
    try {
      setSaveError(null);
      await ipc.saveModel(config);
      if (activateKind && !activeIds[activateKind]) {
        await ipc.setActiveModel(activateKind, config.id);
      }
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
        Configure models for each role. API models are saved once and can be reused.
      </p>
      {saveError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
          Error: {saveError}
        </div>
      )}
      {(['lightweight'] as ModelKind[]).map((kind) => (
        <ModelKindSection
          key={kind}
          kind={kind}
          models={getModelsForKind(models, kind)}
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

      {/* Semantic section */}
      <div className="mt-4">
        <EmbeddingSection />
      </div>

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
  const [refreshing, setRefreshing] = useState(false);

  const loadUsage = useMemo(
    () =>
      async (showSpinner = false) => {
        if (showSpinner) setRefreshing(true);
        try {
          const [nextRecords, nextSummary] = await Promise.all([
            ipc.getTokenUsageRecords(),
            ipc.getTokenUsageSummary(),
          ]);
          setRecords(nextRecords);
          setSummary(nextSummary);
        } finally {
          if (showSpinner) setRefreshing(false);
        }
      },
    [],
  );

  useEffect(() => {
    loadUsage();

    const interval = window.setInterval(() => {
      loadUsage();
    }, 5000);

    const handleFocus = () => {
      loadUsage();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [loadUsage]);

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

  const formatUsageLabel = (provider: string, model: string) => {
    const normalizedProvider = provider.toLowerCase();
    if (normalizedProvider === 'codex') {
      return model && model !== 'codex' ? `Codex · ${model}` : 'Codex';
    }
    if (normalizedProvider === 'claude') {
      return model && model !== 'claude' ? `Claude Code · ${model}` : 'Claude Code';
    }
    return `${provider}/${model}`;
  };

  const agentSummary = summary?.byKind.agent;

  const agentByProvider = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of records) {
      if (r.kind !== 'agent') continue;
      const key = formatUsageLabel(r.provider, r.model);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([key, calls]) => ({ key, calls }))
      .sort((a, b) => b.calls - a.calls);
  }, [records]);

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
              accent: 'text-blue-600',
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
            Token usage will appear here after you make AI API calls or run an Agent.
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

      {!isEmpty && (
        <>
          <div className="flex items-center gap-1 rounded-lg border border-notion-border bg-notion-sidebar p-1">
            {(['summary', 'records'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors ${
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
              <div className="border-b border-notion-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-notion-text-tertiary">
                Token Usage by Model
              </div>
              {Object.entries(summary.byModel)
                .sort(([, left], [, right]) => right.total - left.total)
                .map(([model, data], i, arr) => {
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
                            {formatUsageLabel(r.provider, r.model)}
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

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      fill="#4285F4"
    />
    <path
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      fill="#34A853"
    />
    <path
      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
      fill="#FBBC05"
    />
    <path
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      fill="#EA4335"
    />
  </svg>
);

const GitHubIcon = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-5 w-5"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const YouTubeIcon = () => (
  <svg viewBox="0 0 24 24" className="h-5 w-5" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
      fill="#FF0000"
    />
  </svg>
);

const SITE_ICONS: Record<string, React.ElementType> = {
  Google: GoogleIcon,
  GitHub: GitHubIcon,
  YouTube: YouTubeIcon,
};

const PROXY_SCOPE_OPTIONS = [
  {
    key: 'pdfDownload' as keyof ProxyScope,
    labelKey: 'settings.proxy.scopePdfDownloads' as const,
    descKey: 'settings.proxy.scopePdfDownloadsDesc' as const,
    Icon: HardDrive,
  },
  {
    key: 'aiApi' as keyof ProxyScope,
    labelKey: 'settings.proxy.scopeAiApi' as const,
    descKey: 'settings.proxy.scopeAiApiDesc' as const,
    Icon: Cpu,
  },
  {
    key: 'cliTools' as keyof ProxyScope,
    labelKey: 'settings.proxy.scopeAgents' as const,
    descKey: 'settings.proxy.scopeAgentsDesc' as const,
    Icon: Bot,
  },
] as const;

const PROXY_SCHEMES = ['http', 'https', 'socks5'] as const;
type ProxyScheme = (typeof PROXY_SCHEMES)[number];

function parseProxyUrl(url: string): { scheme: ProxyScheme; host: string; port: string } {
  try {
    const u = new URL(url);
    const scheme = (PROXY_SCHEMES as readonly string[]).includes(u.protocol.replace(':', ''))
      ? (u.protocol.replace(':', '') as ProxyScheme)
      : 'http';
    return { scheme, host: u.hostname, port: u.port };
  } catch {
    return { scheme: 'http', host: '', port: '' };
  }
}

function buildProxyUrl(scheme: ProxyScheme, host: string, port: string): string {
  if (!host.trim()) return '';
  return `${scheme}://${host.trim()}${port.trim() ? `:${port.trim()}` : ''}`;
}

function ProxySettings() {
  const { t } = useTranslation();
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [scheme, setScheme] = useState<ProxyScheme>('http');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('7890');
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [proxyScope, setProxyScope] = useState<ProxyScope>({
    pdfDownload: true,
    aiApi: true,
    cliTools: true,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResults, setTestResults] = useState<ProxyTestResult[] | null>(null);

  useEffect(() => {
    Promise.all([ipc.getSettings(), ipc.getProxyEnabled()])
      .then(([s, proxyEnabledResult]) => {
        if (s.proxy) {
          const parsed = parseProxyUrl(s.proxy);
          setScheme(parsed.scheme);
          setHost(parsed.host);
          setPort(parsed.port);
        }
        // Use saved enabled state (backward compatible: if no saved state but proxy exists, default to enabled)
        setProxyEnabled(proxyEnabledResult.enabled);
        if (s.proxyScope) {
          setProxyScope(s.proxyScope as ProxyScope);
        }
      })
      .catch(() => {});
  }, []);

  const proxy = buildProxyUrl(scheme, host, port);

  useEffect(() => {
    if (!schemeOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-scheme-select]')) setSchemeOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [schemeOpen]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await ipc.setProxy(proxy ? proxy : undefined);
      await ipc.setProxyEnabled(proxyEnabled);
      await ipc.setProxyScope(proxyScope);
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
    setTestResults(null);
    try {
      // Pass '' (empty string) when proxy is disabled → forces direct connection test
      // Pass undefined → would fall back to saved store value (not what we want here)
      const result = await ipc.testProxy(proxyEnabled && proxy ? proxy : '');
      setTestResults(result.results);
    } catch {
      // silent
    } finally {
      setTesting(false);
    }
  };

  const toggleScope = async (key: keyof ProxyScope) => {
    const newScope = { ...proxyScope, [key]: !proxyScope[key] };
    setProxyScope(newScope);
    // Auto-save when toggling scope
    try {
      await ipc.setProxyScope(newScope);
    } catch {
      // silent
    }
  };

  return (
    <div className="space-y-4">
      {/* Proxy URL */}
      <div
        className={`rounded-xl border p-5 transition-colors ${proxyEnabled ? 'border-blue-200 bg-blue-50/60' : 'border-notion-border bg-white'}`}
      >
        <div className="mb-3 flex items-center justify-between">
          <label className="text-xs font-medium text-notion-text-secondary">
            {t('settings.proxy.httpSocksProxy')}
          </label>
          {/* Pill toggle */}
          <button
            type="button"
            onClick={async () => {
              const newValue = !proxyEnabled;
              setProxyEnabled(newValue);
              // Auto-save when toggling
              try {
                await ipc.setProxyEnabled(newValue);
              } catch {
                // silent
              }
            }}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${proxyEnabled ? 'bg-blue-500' : 'bg-notion-border'}`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${proxyEnabled ? 'translate-x-4' : 'translate-x-0.5'}`}
            />
          </button>
        </div>
        <div
          className={`flex items-stretch gap-2 transition-opacity ${proxyEnabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}
        >
          <div className="flex flex-1 items-stretch rounded-lg border border-notion-border bg-notion-sidebar focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
            {/* Scheme selector */}
            <div className="relative shrink-0" data-scheme-select>
              <button
                type="button"
                onClick={() => setSchemeOpen((o) => !o)}
                className="flex h-full items-center gap-1 rounded-l-lg border-r border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
              >
                {scheme}
                <ChevronDown
                  size={12}
                  className={`transition-transform ${schemeOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {schemeOpen && (
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[90px] overflow-hidden rounded-lg border border-notion-border bg-white shadow-lg">
                  {PROXY_SCHEMES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setScheme(s);
                        setSchemeOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 font-mono text-sm transition-colors hover:bg-notion-sidebar ${scheme === s ? 'bg-blue-50 text-blue-700' : 'text-notion-text'}`}
                    >
                      {s}
                      {scheme === s && <Check size={12} className="text-blue-600" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Host */}
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="127.0.0.1"
              className="min-w-0 flex-1 bg-transparent px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none"
            />
            {/* Port */}
            <div className="flex items-center border-l border-notion-border">
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                placeholder="7890"
                maxLength={5}
                className="w-16 rounded-r-lg bg-transparent px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none"
              />
            </div>
          </div>
          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saved ? (
              <Check size={14} />
            ) : null}
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {proxy && <p className="mt-1.5 font-mono text-2xs text-notion-text-tertiary">{proxy}</p>}
        <AnimatePresence>
          {saved && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="mt-2 flex items-center gap-1.5 text-xs font-medium text-green-600"
            >
              <Check size={13} strokeWidth={2.5} />
              Proxy settings saved successfully
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Proxy Scope */}
      <div className="rounded-xl border border-notion-border bg-white p-5">
        <p className="mb-3 text-xs font-medium text-notion-text-secondary">
          {t('settings.proxy.applyProxyTo')}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {PROXY_SCOPE_OPTIONS.map(({ key, labelKey, descKey, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleScope(key)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
                proxyScope[key]
                  ? 'border-blue-200 bg-blue-50/60'
                  : 'border-notion-border bg-white hover:border-notion-text-tertiary hover:bg-notion-sidebar/40'
              }`}
            >
              <Icon
                size={14}
                className={`shrink-0 ${proxyScope[key] ? 'text-blue-600' : 'text-notion-text-secondary'}`}
              />
              <span
                className={`min-w-0 flex-1 truncate text-sm font-medium ${proxyScope[key] ? 'text-blue-700' : 'text-notion-text'}`}
              >
                {t(labelKey)}
              </span>
              <div
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  proxyScope[key] ? 'border-blue-500 bg-blue-500' : 'border-notion-border bg-white'
                }`}
              >
                {proxyScope[key] && <Check size={9} className="text-white" strokeWidth={3} />}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Test site cards — always visible */}
      <div className="rounded-xl border border-notion-border bg-white p-5">
        <p className="mb-3 text-xs font-medium text-notion-text-secondary">
          {t('settings.proxy.connectivityCheck')}
        </p>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(SITE_ICONS).map(([name, SiteIcon]) => {
            const result = testResults?.find((r) => r.name === name);
            const isPending = !result && !testing;
            const isLoading = testing && !result;
            return (
              <div
                key={name}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-all ${
                  result
                    ? result.success
                      ? 'border-green-200 bg-green-50'
                      : 'border-red-200 bg-red-50'
                    : 'border-notion-border bg-notion-sidebar/40'
                }`}
              >
                <div
                  className={`flex h-5 w-5 shrink-0 items-center justify-center ${isPending ? 'opacity-50' : ''}`}
                >
                  <SiteIcon />
                </div>
                <span
                  className={`min-w-0 flex-1 truncate text-sm font-medium ${isPending ? 'text-notion-text-tertiary' : 'text-notion-text'}`}
                >
                  {name}
                </span>
                <div className="flex shrink-0 items-center">
                  {isLoading ? (
                    <Loader2 size={12} className="animate-spin text-notion-text-tertiary" />
                  ) : result ? (
                    result.success ? (
                      <div className="flex items-center gap-1">
                        <Check size={12} className="text-green-600" strokeWidth={2.5} />
                        <span className="text-xs text-green-700">
                          {result.latency ? `${result.latency}ms` : 'OK'}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <X size={12} className="text-red-500" strokeWidth={2.5} />
                        <span
                          className="max-w-[60px] truncate text-xs text-red-600"
                          title={result.error}
                        >
                          {result.error ?? 'Failed'}
                        </span>
                      </div>
                    )
                  ) : (
                    <span className="text-2xs text-notion-text-tertiary">—</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <button
          onClick={handleTest}
          disabled={testing}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-notion-border bg-white px-4 py-2 text-sm font-medium text-notion-text shadow-sm transition-all hover:border-notion-text-tertiary hover:shadow disabled:cursor-not-allowed disabled:opacity-40"
        >
          {testing ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />}
          {testing ? t('settings.proxy.testing') : t('settings.proxy.testConnection')}
        </button>
      </div>
    </div>
  );
}

// ─── Embedding Config UI ─────────────────────────────────────────────────────

function AddEmbeddingModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: EmbeddingConfig;
  onSave: (config: EmbeddingConfig) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [embeddingModel, setEmbeddingModel] = useState(
    initial?.embeddingModel ?? 'text-embedding-3-small',
  );
  const [apiBase, setApiBase] = useState(initial?.embeddingApiBase ?? '');
  const [apiKey, setApiKey] = useState(initial?.embeddingApiKey ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const config: EmbeddingConfig = {
        id: initial?.id ?? Math.random().toString(36).slice(2, 10),
        name: name.trim(),
        provider: 'openai-compatible',
        embeddingModel: embeddingModel.trim() || 'text-embedding-3-small',
        embeddingApiBase: apiBase.trim() || undefined,
        embeddingApiKey: apiKey.trim() || undefined,
      };
      await ipc.saveEmbeddingConfig(config);
      onSave(config);
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.15 }}
        className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-notion-text">
            {initial ? 'Edit Embedding Config' : 'Add Embedding Config'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-notion-text-tertiary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
              Name
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. OpenAI Embeddings"
              className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 text-sm text-notion-text outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Base URL */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
              Base URL
            </label>
            <input
              value={apiBase}
              onChange={(e) => setApiBase(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm text-notion-text outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-[11px] text-notion-text-tertiary">
              Leave empty to use OpenAI's official API
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm text-notion-text outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {/* Model */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
              Model
            </label>
            <input
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              placeholder="text-embedding-3-small"
              className="w-full rounded-lg border border-notion-border bg-white px-3 py-2 font-mono text-sm text-notion-text outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <p className="mt-1 text-[11px] text-notion-text-tertiary">
              Supported: text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-notion-border px-4 py-2 text-sm font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {initial ? 'Save Changes' : 'Add Config'}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function EmbeddingCard({
  config,
  isActive,
  onSetActive,
  onEdit,
  onDelete,
  readOnly = false,
}: {
  config: EmbeddingConfig;
  isActive: boolean;
  onSetActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
  readOnly?: boolean;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SemanticEmbeddingTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const testSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const subtitle = `OpenAI-compatible · ${config.embeddingModel}`;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    if (testSuccessTimerRef.current) clearTimeout(testSuccessTimerRef.current);
    try {
      const result = await withTimeout(
        ipc.testSemanticEmbedding({
          embeddingProvider: config.provider,
          embeddingModel: config.embeddingModel,
          embeddingApiBase: config.embeddingApiBase,
          embeddingApiKey: config.embeddingApiKey,
        }),
        30_000,
        'Embedding test timed out after 30 seconds',
      );
      setTestResult(result);
      testSuccessTimerRef.current = setTimeout(() => setTestResult(null), 3000);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Embedding test failed');
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
            <span className="text-sm font-semibold text-notion-text truncate">{config.name}</span>
            {isActive && (
              <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                Active
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-notion-text-tertiary">{subtitle}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
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
          {!isActive && (
            <button
              onClick={onSetActive}
              className="rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
            >
              Activate
            </button>
          )}
          {!readOnly && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Test result */}
      {(testResult || testError) && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className={`mt-3 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-xs ${
              testError
                ? 'border-red-200 bg-red-50 text-red-600'
                : 'border-green-200 bg-green-50 text-green-700'
            }`}
          >
            {testError ? (
              <>
                <X size={13} className="shrink-0 text-red-500" strokeWidth={2.5} />
                <span className="leading-snug">{testError}</span>
              </>
            ) : testResult ? (
              <>
                <Check size={13} className="shrink-0 text-green-600" strokeWidth={2.5} />
                <span className="leading-snug">
                  <span className="font-medium">OK</span> — {testResult.model},{' '}
                  {testResult.dimensions}d, {testResult.elapsedMs}ms
                </span>
              </>
            ) : null}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}

function SemanticSection() {
  const [settings, setSettings] = useState<SemanticSearchSettings>({
    enabled: true,
    autoProcess: true,
    autoEnrich: true,
    embeddingModel: 'text-embedding-3-small',
    embeddingProvider: 'openai-compatible',
    recommendationExploration: 0.35,
  });

  useEffect(() => {
    void ipc
      .getSemanticSearchSettings()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  const save = (updated: SemanticSearchSettings) => {
    void ipc.setSemanticSearchSettings(updated).catch(() => undefined);
  };

  const toggleEnabled = () => {
    const updated = { ...settings, enabled: !settings.enabled };
    setSettings(updated);
    save(updated);
  };

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-notion-text-secondary">
            Embedding-based search and recommendations
          </p>
        </div>
        <button
          type="button"
          onClick={toggleEnabled}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${settings.enabled ? 'bg-blue-500' : 'bg-notion-border'}`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-6' : 'translate-x-1'}`}
          />
        </button>
      </div>
    </div>
  );
}

function EmbeddingSection() {
  const { t } = useTranslation();
  const [configs, setConfigs] = useState<EmbeddingConfig[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addingConfig, setAddingConfig] = useState(false);
  const [editingConfig, setEditingConfig] = useState<EmbeddingConfig | null>(null);
  const [rebuildStatus, setRebuildStatus] = useState<{
    active: boolean;
    total: number;
    completed: number;
    failed: number;
    currentPaperTitle?: string;
  } | null>(null);
  const reload = () => {
    void ipc.listEmbeddingConfigs().then(({ configs: c, activeId: a }) => {
      setConfigs(c);
      setActiveId(a);
    });
  };

  useEffect(() => {
    reload();
    // Fetch initial rebuild status
    void ipc.getEmbeddingRebuildStatus().then((s) => {
      // Only show status if a batch is actively running
      if (s.active) setRebuildStatus(s);
    });
    // Listen for rebuild progress
    const unsub = onIpc('embedding:rebuildStatus', (_event: unknown, payload: unknown) => {
      const status = payload as {
        active: boolean;
        total: number;
        completed: number;
        failed: number;
        currentPaperTitle?: string;
      };
      setRebuildStatus(status);
    });
    return () => {
      unsub();
    };
  }, []);

  const handleSetActive = async (id: string) => {
    await ipc.setActiveEmbeddingConfig(id);
    reload();
  };

  const handleDelete = async (id: string) => {
    await ipc.deleteEmbeddingConfig(id);
    reload();
  };

  const handleSaved = () => {
    setAddingConfig(false);
    setEditingConfig(null);
    reload();
  };

  const [dimensionMatchInfo, setDimensionMatchInfo] = useState<{
    match: boolean;
    dim: number;
  } | null>(null);
  const [showPaperPicker, setShowPaperPicker] = useState(false);
  const [allPapers, setAllPapers] = useState<
    { id: string; title: string; indexedAt?: string | null }[]
  >([]);
  const [selectedPaperIds, setSelectedPaperIds] = useState<Set<string>>(new Set());

  const [rebuildLoading, setRebuildLoading] = useState(false);
  const handleRebuildAll = async (force = false) => {
    if (rebuildLoading || isRebuilding) return;
    setRebuildLoading(true);
    setDimensionMatchInfo(null);
    try {
      const result = await ipc.rebuildAllEmbeddings({ force });
      if (result.dimensionMatch && result.currentDimension) {
        setDimensionMatchInfo({ match: true, dim: result.currentDimension });
      }
    } finally {
      setRebuildLoading(false);
    }
  };

  const handleCancelRebuild = async () => {
    await ipc.cancelEmbeddingRebuild();
  };

  const handleOpenPaperPicker = async () => {
    try {
      const papers = await ipc.listPapers();
      setAllPapers(papers.map((p) => ({ id: p.id, title: p.title, indexedAt: p.indexedAt })));
      setSelectedPaperIds(new Set());
      setShowPaperPicker(true);
    } catch (err) {
      console.error('[EmbeddingSection] Failed to load papers:', err);
    }
  };

  const handleRebuildSelected = async () => {
    if (selectedPaperIds.size === 0) return;
    setShowPaperPicker(false);
    await ipc.rebuildSelectedEmbeddings([...selectedPaperIds]);
  };

  const togglePaper = (id: string) => {
    setSelectedPaperIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedPaperIds.size === allPapers.length) {
      setSelectedPaperIds(new Set());
    } else {
      setSelectedPaperIds(new Set(allPapers.map((p) => p.id)));
    }
  };

  const isRebuilding = rebuildStatus?.active ?? false;
  const rebuildProgress =
    rebuildStatus && rebuildStatus.total > 0
      ? Math.round(((rebuildStatus.completed + rebuildStatus.failed) / rebuildStatus.total) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {/* Embedding configs card */}
      <div className="rounded-xl border border-notion-border bg-white">
        <div className="flex items-center justify-between border-b border-notion-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-notion-sidebar">
              <Cpu size={16} className="text-notion-text-secondary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-notion-text">Embedding Models</h3>
              <p className="text-xs text-notion-text-tertiary">
                Vector embedding configs for semantic search
              </p>
            </div>
          </div>
          <button
            onClick={() => setAddingConfig(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
          >
            <Plus size={12} />
            Add
          </button>
        </div>

        <div className="space-y-2 p-4">
          {configs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-notion-border bg-notion-sidebar/30 p-6 text-center">
              <p className="text-sm text-notion-text-secondary">
                No embedding models configured yet.
              </p>
              <p className="mt-1 text-xs text-notion-text-tertiary">
                Add an OpenAI-compatible embedding config to enable semantic search.
              </p>
            </div>
          ) : (
            configs.map((c) => (
              <EmbeddingCard
                key={c.id}
                config={c}
                isActive={c.id === activeId}
                onSetActive={() => handleSetActive(c.id)}
                onEdit={() => setEditingConfig(c)}
                onDelete={() => handleDelete(c.id)}
              />
            ))
          )}
        </div>

        {/* Rebuild all index */}
        {activeId && (
          <div className="border-t border-notion-border px-5 py-4">
            {isRebuilding ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-notion-text-secondary">
                    <Loader2 size={12} className="animate-spin" />
                    <span>
                      {t('settings.embedding.rebuilding')} (
                      {rebuildStatus!.completed + rebuildStatus!.failed}/{rebuildStatus!.total})
                    </span>
                  </div>
                  <button
                    onClick={handleCancelRebuild}
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-notion-text-tertiary transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <X size={10} />
                    {t('settings.embedding.cancelRebuild')}
                  </button>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-notion-sidebar">
                  <div
                    className="h-full rounded-full bg-notion-accent transition-all duration-300"
                    style={{ width: `${rebuildProgress}%` }}
                  />
                </div>
                {rebuildStatus!.currentPaperTitle && (
                  <p className="truncate text-xs text-notion-text-tertiary">
                    {rebuildStatus!.currentPaperTitle}
                  </p>
                )}
                {rebuildStatus!.failed > 0 && (
                  <p className="text-xs text-red-500">
                    {rebuildStatus!.failed} {t('settings.embedding.rebuildFailed')}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-notion-text-secondary">
                    {t('settings.embedding.rebuildDescription')}
                  </p>
                  {rebuildStatus && !rebuildStatus.active && rebuildStatus.total > 0 && (
                    <p
                      className={`mt-1 text-xs ${rebuildStatus.failed > 0 ? 'text-orange-500' : 'text-green-600'}`}
                    >
                      {t('settings.embedding.rebuildDone', {
                        completed: rebuildStatus.completed,
                        total: rebuildStatus.total,
                      })}
                      {rebuildStatus.failed > 0 &&
                        ` (${rebuildStatus.failed} ${t('settings.embedding.rebuildFailed')})`}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleOpenPaperPicker}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                  >
                    {t('settings.embedding.rebuildSelected')}
                  </button>
                  <button
                    onClick={() => handleRebuildAll(false)}
                    disabled={rebuildLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text disabled:opacity-50"
                  >
                    {rebuildLoading ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <RefreshCw size={12} />
                    )}
                    {t('settings.embedding.rebuildAll')}
                  </button>
                </div>
                {dimensionMatchInfo && (
                  <div className="flex items-center justify-between rounded-lg bg-notion-sidebar/50 px-3 py-2">
                    <p className="text-xs text-notion-text-secondary">
                      {t('settings.embedding.dimensionMatch', {
                        dim: dimensionMatchInfo.dim,
                      })}
                    </p>
                    <button
                      onClick={() => handleRebuildAll(true)}
                      className="text-xs font-medium text-notion-accent hover:underline"
                    >
                      {t('settings.embedding.forceRebuild')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {addingConfig && (
        <AddEmbeddingModal onSave={handleSaved} onClose={() => setAddingConfig(false)} />
      )}
      {editingConfig && (
        <AddEmbeddingModal
          initial={editingConfig}
          onSave={handleSaved}
          onClose={() => setEditingConfig(null)}
        />
      )}

      {/* Paper picker modal for selective rebuild */}
      {showPaperPicker &&
        createPortal(
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowPaperPicker(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.15 }}
              className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-xl bg-white p-6 shadow-xl"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-notion-text">
                  {t('settings.embedding.selectPapers')}
                </h2>
                <button
                  onClick={() => setShowPaperPicker(false)}
                  className="rounded-lg p-1.5 text-notion-text-tertiary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="mb-3 flex items-center justify-between">
                <button
                  onClick={toggleAll}
                  className="text-xs font-medium text-notion-accent hover:underline"
                >
                  {selectedPaperIds.size === allPapers.length
                    ? t('settings.embedding.deselectAll')
                    : t('settings.embedding.selectAll')}
                </button>
                <span className="text-xs text-notion-text-tertiary">
                  {selectedPaperIds.size}/{allPapers.length}
                </span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-1">
                  {allPapers.map((paper) => (
                    <label
                      key={paper.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-notion-sidebar"
                    >
                      <input
                        type="checkbox"
                        checked={selectedPaperIds.has(paper.id)}
                        onChange={() => togglePaper(paper.id)}
                        className="h-3.5 w-3.5 rounded border-notion-border text-notion-accent focus:ring-notion-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-notion-text">{paper.title}</p>
                      </div>
                      {paper.indexedAt && (
                        <span className="shrink-0 rounded bg-notion-tag-blue px-1.5 py-0.5 text-[10px] text-notion-accent">
                          indexed
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setShowPaperPicker(false)}
                  className="rounded-lg border border-notion-border px-4 py-2 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar"
                >
                  {t('settings.embedding.cancelRebuild')}
                </button>
                <button
                  onClick={handleRebuildSelected}
                  disabled={selectedPaperIds.size === 0}
                  className="rounded-lg bg-notion-accent px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-notion-accent/90 disabled:opacity-50"
                >
                  {t('settings.embedding.rebuildCount', { count: selectedPaperIds.size })}
                </button>
              </div>
            </motion.div>
          </motion.div>,
          document.body,
        )}
    </div>
  );
}

// ─── Settings Page ────────────────────────────────────────────────────────────
// NAV_GROUPS, SECTION_META, SectionId and helper functions are imported from ./settings-nav

const GROUP_ICONS: Record<string, React.ElementType> = {
  general: Settings,
  models: Cpu,
  agents: Bot,
  storage: HardDrive,
};

// Flat list of all searchable items for Fuse.js
type SearchableItem = {
  id: SectionId;
  label: string;
  group: string;
  keywords: string[];
};

const SEARCH_INDEX: SearchableItem[] = NAV_GROUPS.flatMap((g) =>
  g.items.map((item) => ({
    id: item.id,
    label: item.label,
    group: g.label,
    keywords: item.keywords,
  })),
);

const fuse = new Fuse(SEARCH_INDEX, {
  keys: [
    { name: 'label', weight: 0.6 },
    { name: 'keywords', weight: 0.4 },
  ],
  threshold: 0.4,
  includeScore: true,
  minMatchCharLength: 1,
});

function renderSection(id: SectionId) {
  switch (id) {
    case 'general.language':
      return <LanguageSettings />;
    case 'general.proxy':
      return <ProxySettings />;
    case 'general.editor':
      return <EditorSettings />;
    case 'general.semantic':
      return <SemanticSection />;
    case 'general.overleaf':
      return <OverleafSettings />;
    case 'general.dev':
      return <DeveloperSettings />;
    case 'models':
      return <ModelsSettings />;
    case 'agents':
      return <AgentSettings />;
    case 'storage':
      return <StorageSettings />;
  }
}

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SectionId>('general.proxy');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);

  // Fuse.js search results
  const searchResults = useMemo<SearchableItem[]>(() => {
    const q = search.trim();
    if (!q) return [];
    return fuse.search(q).map((r) => r.item);
  }, [search]);

  const isSearching = search.trim().length > 0;

  // Auto-select first result when search changes
  useEffect(() => {
    if (isSearching && searchResults.length > 0) {
      setActiveSection(searchResults[0].id);
    }
  }, [searchResults, isSearching]);

  const handleToggleGroup = (groupId: string) => {
    setCollapsed((prev) => toggleCollapsed(prev, groupId));
  };

  const meta = SECTION_META[activeSection];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top search bar — full width */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex flex-1 items-center gap-2.5 border-b border-notion-border pb-4">
          <Settings size={18} className="shrink-0 text-notion-text-tertiary" />
          <h1 className="text-lg font-semibold text-notion-text">{t('settings.title')}</h1>
          <div className="mx-3 h-4 w-px bg-notion-border" />
          <Search size={14} className="shrink-0 text-notion-text-tertiary" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('settings.searchPlaceholder')}
            className="min-w-0 flex-1 bg-transparent text-sm text-notion-text placeholder-notion-text-tertiary outline-none"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="shrink-0 rounded p-0.5 text-notion-text-tertiary transition-colors hover:text-notion-text"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="flex min-h-0 flex-1 gap-8 overflow-hidden">
        {/* Left nav — plain, no card */}
        <aside className="w-44 shrink-0 overflow-y-auto">
          <nav className="space-y-0.5">
            {NAV_GROUPS.map((group) => {
              const expanded = isGroupExpanded(group.id, collapsed, isSearching);
              const Icon = GROUP_ICONS[group.id] ?? Settings;
              return (
                <div key={group.id}>
                  {/* Group header */}
                  <button
                    onClick={() => handleToggleGroup(group.id)}
                    className="flex w-full items-center gap-1.5 px-1 py-1.5 text-left"
                  >
                    <ChevronRight
                      size={11}
                      className={`shrink-0 text-notion-text-tertiary transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
                    />
                    <Icon size={12} className="shrink-0 text-notion-text-tertiary" />
                    <span className="text-[11px] font-semibold uppercase tracking-widest text-notion-text-tertiary">
                      {(t as any)(`settings.nav.${group.id}`)}
                    </span>
                  </button>

                  {/* Items */}
                  {expanded &&
                    group.items.map((item) => {
                      const isActive = !isSearching && activeSection === item.id;
                      const isSearchMatch =
                        isSearching && searchResults.some((r) => r.id === item.id);
                      const isHighlighted =
                        isSearching && activeSection === item.id && isSearchMatch;
                      return (
                        <button
                          key={item.id}
                          onClick={() => setActiveSection(item.id)}
                          className={`flex w-full items-center rounded px-2 py-1.5 pl-5 text-left text-sm transition-colors duration-100 ${
                            isActive || isHighlighted
                              ? 'font-semibold text-notion-text'
                              : isSearchMatch
                                ? 'text-notion-text'
                                : 'text-notion-text-secondary'
                          } hover:text-notion-text`}
                        >
                          {(t as any)(`settings.nav.${item.id.replace('.', '_')}`)}
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* Right content */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          {isSearching ? (
            /* Search results: stack all matching sections */
            searchResults.length === 0 ? (
              <div className="py-16 text-center text-sm text-notion-text-tertiary">
                {t('settings.noResults', { query: search })}
              </div>
            ) : (
              <div className="space-y-10">
                {searchResults.map((result) => (
                  <section key={result.id} id={`section-${result.id}`}>
                    <div className="mb-4 flex items-baseline gap-2">
                      <h2 className="text-sm font-semibold text-notion-text">
                        {(t as any)(`settings.${result.id.replace(/\./g, '_')}.title`)}
                      </h2>
                      <span className="text-xs text-notion-text-tertiary">
                        {(t as any)(`settings.nav.${result.group}`)}
                      </span>
                    </div>
                    {renderSection(result.id)}
                  </section>
                ))}
              </div>
            )
          ) : (
            /* Normal mode: single active section */
            <section>
              <div className="mb-5">
                <h2 className="text-sm font-semibold text-notion-text">
                  {(t as any)(`settings.${activeSection.replace(/\./g, '_')}.title`)}
                </h2>
                <p className="mt-0.5 text-xs text-notion-text-tertiary">
                  {(t as any)(`settings.${activeSection.replace(/\./g, '_')}.description`)}
                </p>
              </div>
              {renderSection(activeSection)}
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
