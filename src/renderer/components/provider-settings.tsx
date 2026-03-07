import { useEffect, useState, useRef } from 'react';
import { ipc, type ProviderConfig } from '../hooks/use-ipc';
import { Check, Loader2, Eye, EyeOff, ChevronDown } from 'lucide-react';

const PROVIDER_MODELS: Record<string, string[]> = {
  anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  custom: [],
};

interface ProviderFormState {
  id: string;
  name: string;
  model: string;
  apiKey: string;
  baseURL: string;
  enabled: boolean;
}

/** Clean custom dropdown replacing native <select> */
function ModelSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-notion-border bg-white px-3 py-2.5 text-sm text-notion-text transition-colors hover:border-blue-300 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        <span className="font-mono text-sm">{value || 'Select model…'}</span>
        <ChevronDown
          size={14}
          className={`text-notion-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-notion-border bg-white shadow-lg">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-mono transition-colors hover:bg-notion-sidebar ${
                value === opt ? 'bg-blue-50 text-blue-700' : 'text-notion-text'
              }`}
            >
              {opt}
              {value === opt && <Check size={13} className="text-blue-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProviderSettings() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [forms, setForms] = useState<Record<string, ProviderFormState>>({});

  useEffect(() => {
    async function load() {
      try {
        const [provs, active] = await Promise.all([ipc.listProviders(), ipc.getActiveProvider()]);
        setProviders(provs);
        setActiveId(active);
        const initialForms: Record<string, ProviderFormState> = {};
        for (const p of provs) {
          initialForms[p.id] = {
            id: p.id,
            name: p.name,
            model: p.model,
            apiKey: '',
            baseURL: p.baseURL ?? '',
            enabled: p.enabled,
          };
        }
        setForms(initialForms);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const updateForm = (id: string, field: keyof ProviderFormState, value: string | boolean) => {
    setForms((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  };

  const handleSave = async (id: string) => {
    const form = forms[id];
    if (!form) return;
    setSaving(id);
    try {
      await ipc.saveProvider({
        id: form.id,
        name: form.name,
        model: form.model,
        apiKey: form.apiKey || undefined,
        baseURL: form.baseURL || undefined,
        enabled: form.enabled,
      });
      setSaved(id);
      setTimeout(() => setSaved(null), 2000);
      const provs = await ipc.listProviders();
      setProviders(provs);
    } catch {
      // silent
    } finally {
      setSaving(null);
    }
  };

  const handleSetActive = async (id: string) => {
    await ipc.setActiveProvider(id);
    setActiveId(id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin text-notion-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {providers.map((provider) => {
        const form = forms[provider.id];
        if (!form) return null;
        const models = PROVIDER_MODELS[provider.id] ?? [];
        const isActive = activeId === provider.id;

        return (
          <div
            key={provider.id}
            className={`rounded-xl border p-5 transition-all ${
              isActive
                ? 'border-blue-200 bg-blue-50/40 shadow-sm'
                : 'border-notion-border bg-white hover:border-notion-border/80'
            }`}
          >
            {/* Header */}
            <div className="mb-4 flex items-center gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-notion-text">{provider.name}</h3>
                  {isActive && (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-2xs font-medium text-blue-700">
                      Active
                    </span>
                  )}
                </div>
                {provider.hasApiKey && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-green-600">
                    <Check size={11} /> API key configured
                  </p>
                )}
              </div>
              {/* Toggle */}
              <button
                onClick={() => updateForm(provider.id, 'enabled', !form.enabled)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                  form.enabled ? 'bg-blue-500' : 'bg-notion-border'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                    form.enabled ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
              {form.enabled && !isActive && (
                <button
                  onClick={() => handleSetActive(provider.id)}
                  className="rounded-lg border border-notion-border px-3 py-1.5 text-xs font-medium text-notion-text-secondary transition-colors hover:bg-notion-sidebar hover:text-notion-text"
                >
                  Set Active
                </button>
              )}
            </div>

            <div className="space-y-3">
              {/* Model */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                  Model
                </label>
                {models.length > 0 ? (
                  <ModelSelect
                    value={form.model}
                    options={models}
                    onChange={(v) => updateForm(provider.id, 'model', v)}
                  />
                ) : (
                  <input
                    value={form.model}
                    onChange={(e) => updateForm(provider.id, 'model', e.target.value)}
                    placeholder="model-name"
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                )}
              </div>

              {/* Base URL */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                  Base URL{' '}
                  <span className="font-normal text-notion-text-tertiary">
                    (optional, for proxy)
                  </span>
                </label>
                <input
                  value={form.baseURL}
                  onChange={(e) => updateForm(provider.id, 'baseURL', e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              {/* API Key */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-notion-text-secondary">
                  API Key
                </label>
                <div className="relative flex items-center">
                  <input
                    type={showKey[provider.id] ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(e) => updateForm(provider.id, 'apiKey', e.target.value)}
                    placeholder={
                      provider.hasApiKey ? '••••••••••••• (leave blank to keep)' : 'Enter API key…'
                    }
                    className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 pr-10 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setShowKey((prev) => ({ ...prev, [provider.id]: !prev[provider.id] }))
                    }
                    className="absolute right-3 text-notion-text-tertiary hover:text-notion-text"
                  >
                    {showKey[provider.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-3">
              {saved === provider.id && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <Check size={12} /> Saved
                </span>
              )}
              <button
                onClick={() => handleSave(provider.id)}
                disabled={saving === provider.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-notion-text px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
              >
                {saving === provider.id && <Loader2 size={13} className="animate-spin" />}
                Save
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
