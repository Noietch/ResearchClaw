import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Key,
  Globe,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { ipc, type ProviderConfig } from '../hooks/use-ipc';
import appIcon from '../../../assets/icon.png';

const SETUP_DISMISSED_KEY = 'researchclaw-setup-dismissed';

export function isSetupDismissed(): boolean {
  return localStorage.getItem(SETUP_DISMISSED_KEY) === 'true';
}

export function markSetupDismissed(): void {
  localStorage.setItem(SETUP_DISMISSED_KEY, 'true');
}

interface SetupWizardModalProps {
  providers: ProviderConfig[];
  onComplete: () => void;
  onSkip: () => void;
}

type Step = 'welcome' | 'select-provider' | 'api-key';

const PROVIDER_INFO: Record<
  string,
  {
    name: string;
    description: string;
    placeholder: string;
    defaultBaseURL: string;
    defaultModel: string;
  }
> = {
  anthropic: {
    name: 'Anthropic',
    description: 'Claude models (Claude 3.5 Sonnet, Claude 3 Opus, etc.)',
    placeholder: 'sk-ant-...',
    defaultBaseURL: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
  },
  openai: {
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4, GPT-3.5 Turbo, etc.',
    placeholder: 'sk-...',
    defaultBaseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
  },
  gemini: {
    name: 'Google Gemini',
    description: 'Gemini Pro, Gemini Ultra, etc.',
    placeholder: 'AI...',
    defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
  },
  custom: {
    name: 'Custom (OpenAI-compatible)',
    description: 'Any OpenAI-compatible API endpoint',
    placeholder: 'your-api-key',
    defaultBaseURL: '',
    defaultModel: '',
  },
};

export function SetupWizardModal({ providers, onComplete, onSkip }: SetupWizardModalProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [saving, setSaving] = useState(false);

  const selectedProvider = providers.find((p) => p.id === selectedProviderId);
  const providerInfo = selectedProviderId ? PROVIDER_INFO[selectedProviderId] : null;

  const handleSkip = useCallback(() => {
    markSetupDismissed();
    onSkip();
  }, [onSkip]);

  const handleSelectProvider = useCallback((id: string) => {
    setSelectedProviderId(id);
    setApiKey('');
    setModelName('');
    setBaseURL('');
    setShowAdvanced(id === 'custom');
    setTestResult(null);
  }, []);

  const getEffectiveBaseURL = useCallback(() => {
    const trimmed = baseURL.trim();
    if (trimmed) return trimmed;
    return selectedProvider?.baseURL || undefined;
  }, [baseURL, selectedProvider]);

  const getEffectiveModel = useCallback(() => {
    const trimmed = modelName.trim();
    if (trimmed) return trimmed;
    return selectedProvider?.model || providerInfo?.defaultModel || '';
  }, [modelName, selectedProvider, providerInfo]);

  const handleTest = useCallback(async () => {
    if (!selectedProvider || !apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      await ipc.saveProvider({
        id: selectedProvider.id,
        name: selectedProvider.name,
        model: getEffectiveModel(),
        baseURL: getEffectiveBaseURL(),
        enabled: true,
        apiKey: apiKey.trim(),
      });
      await ipc.setActiveProvider(selectedProvider.id);
      setTestResult('success');
    } catch {
      setTestResult('error');
    } finally {
      setTesting(false);
    }
  }, [selectedProvider, apiKey, getEffectiveBaseURL, getEffectiveModel]);

  const handleComplete = useCallback(async () => {
    if (!selectedProvider) return;
    setSaving(true);
    try {
      if (testResult !== 'success') {
        await ipc.saveProvider({
          id: selectedProvider.id,
          name: selectedProvider.name,
          model: getEffectiveModel(),
          baseURL: getEffectiveBaseURL(),
          enabled: true,
          apiKey: apiKey.trim(),
        });
        await ipc.setActiveProvider(selectedProvider.id);
      }
      markSetupDismissed();
      onComplete();
    } catch {
      // Already saved during test
    } finally {
      setSaving(false);
    }
  }, [selectedProvider, apiKey, testResult, onComplete, getEffectiveBaseURL, getEffectiveModel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') handleSkip();
    },
    [handleSkip],
  );

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
      onKeyDown={handleKeyDown}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.15 }}
        className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-xl"
      >
        {/* Close button */}
        <button
          onClick={handleSkip}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-notion-text-tertiary hover:bg-notion-sidebar-hover hover:text-notion-text transition-colors"
        >
          <X size={16} />
        </button>

        <AnimatePresence mode="wait">
          {step === 'welcome' && (
            <motion.div
              key="welcome"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
            >
              <div className="mb-6 text-center">
                <img src={appIcon} alt="ResearchClaw" className="mx-auto mb-4 h-14 w-14" />
                <h2 className="text-xl font-bold tracking-tight text-notion-text">
                  Welcome to ResearchClaw
                </h2>
                <p className="mt-2 text-sm text-notion-text-secondary leading-relaxed">
                  To enable AI-powered features like paper analysis, smart tagging, and research
                  recommendations, please configure your AI provider.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setStep('select-provider')}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-notion-text px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-80"
                >
                  Configure AI Provider
                  <ChevronRight size={16} />
                </button>
                <button
                  onClick={handleSkip}
                  className="w-full rounded-lg px-4 py-2.5 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar-hover hover:text-notion-text"
                >
                  Skip for now
                </button>
              </div>
            </motion.div>
          )}

          {step === 'select-provider' && (
            <motion.div
              key="select-provider"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
            >
              <h2 className="mb-1 text-lg font-bold tracking-tight text-notion-text">
                Choose a Provider
              </h2>
              <p className="mb-4 text-sm text-notion-text-secondary">
                Select the AI provider you want to use.
              </p>

              <div className="flex flex-col gap-2">
                {providers
                  .filter((p) => PROVIDER_INFO[p.id])
                  .map((provider) => {
                    const info = PROVIDER_INFO[provider.id];
                    const isSelected = selectedProviderId === provider.id;
                    return (
                      <button
                        key={provider.id}
                        onClick={() => handleSelectProvider(provider.id)}
                        className={`group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors duration-150 ${
                          isSelected
                            ? 'border-blue-200 bg-blue-50'
                            : 'border-notion-border hover:border-blue-200 hover:bg-blue-50/40'
                        }`}
                      >
                        <div className="flex-1">
                          <div className="text-sm font-medium text-notion-text">{info.name}</div>
                          <div className="mt-0.5 text-xs text-notion-text-tertiary">
                            {info.description}
                          </div>
                        </div>
                        {isSelected && (
                          <CheckCircle2
                            size={18}
                            className="flex-shrink-0 self-center text-blue-600"
                          />
                        )}
                      </button>
                    );
                  })}
              </div>

              <div className="mt-4 flex items-center justify-between">
                <button
                  onClick={() => setStep('welcome')}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar-hover hover:text-notion-text"
                >
                  <ChevronLeft size={16} />
                  Back
                </button>
                <button
                  onClick={() => setStep('api-key')}
                  disabled={!selectedProviderId}
                  className="flex items-center gap-1 rounded-lg bg-notion-text px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {step === 'api-key' && providerInfo && (
            <motion.div
              key="api-key"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.15 }}
            >
              <h2 className="mb-1 text-lg font-bold tracking-tight text-notion-text">
                Enter API Key
              </h2>
              <p className="mb-4 text-sm text-notion-text-secondary">
                Enter your {providerInfo.name} API key. It will be stored securely on your device.
              </p>

              <div className="mb-4 flex flex-col gap-3">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text">
                    API Key
                  </label>
                  <div className="relative">
                    <Key
                      size={14}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary"
                    />
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setTestResult(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === 'Enter' && apiKey.trim()) handleTest();
                      }}
                      placeholder={providerInfo.placeholder}
                      className="w-full rounded-lg border border-notion-border bg-white py-2 pl-9 pr-3 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:border-notion-accent/50 focus:outline-none focus:ring-1 focus:ring-notion-accent/30 transition-colors"
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-medium text-notion-text">Model</label>
                  <input
                    type="text"
                    value={modelName}
                    onChange={(e) => {
                      setModelName(e.target.value);
                      setTestResult(null);
                    }}
                    placeholder={providerInfo.defaultModel || 'model-name'}
                    className="w-full rounded-lg border border-notion-border bg-white py-2 px-3 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:border-notion-accent/50 focus:outline-none focus:ring-1 focus:ring-notion-accent/30 transition-colors"
                  />
                  {providerInfo.defaultModel && (
                    <p className="mt-1 text-[11px] text-notion-text-tertiary">
                      Default: {providerInfo.defaultModel}
                    </p>
                  )}
                </div>

                {/* Advanced: Base URL */}
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1 text-xs text-notion-text-tertiary hover:text-notion-text-secondary transition-colors"
                >
                  {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {selectedProviderId === 'custom' ? 'Base URL' : 'Custom Base URL (optional)'}
                </button>

                {showAdvanced && (
                  <div className="mt-1.5">
                    <div className="relative">
                      <Globe
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-notion-text-tertiary"
                      />
                      <input
                        type="text"
                        value={baseURL}
                        onChange={(e) => {
                          setBaseURL(e.target.value);
                          setTestResult(null);
                        }}
                        placeholder={
                          providerInfo.defaultBaseURL || 'https://your-api-endpoint.com/v1'
                        }
                        className="w-full rounded-lg border border-notion-border bg-white py-2 pl-9 pr-3 text-sm text-notion-text placeholder:text-notion-text-tertiary focus:border-notion-accent/50 focus:outline-none focus:ring-1 focus:ring-notion-accent/30 transition-colors"
                      />
                    </div>
                    {selectedProviderId !== 'custom' && (
                      <p className="mt-1 text-[11px] text-notion-text-tertiary">
                        Leave empty to use the official endpoint
                      </p>
                    )}
                  </div>
                )}

                {testResult && (
                  <div
                    className={`mt-2 flex items-center gap-1.5 text-xs ${
                      testResult === 'success' ? 'text-green-600' : 'text-red-500'
                    }`}
                  >
                    {testResult === 'success' ? (
                      <>
                        <CheckCircle2 size={13} />
                        Provider configured successfully!
                      </>
                    ) : (
                      <>
                        <AlertCircle size={13} />
                        Failed to save. Please check your API key.
                      </>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    setStep('select-provider');
                    setTestResult(null);
                  }}
                  className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar-hover hover:text-notion-text"
                >
                  <ChevronLeft size={16} />
                  Back
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleTest}
                    disabled={!apiKey.trim() || testing}
                    className="flex items-center gap-1.5 rounded-lg border border-notion-border px-3 py-1.5 text-sm text-notion-text-secondary transition-colors hover:bg-notion-sidebar-hover hover:text-notion-text disabled:opacity-50"
                  >
                    {testing && <Loader2 size={13} className="animate-spin" />}
                    Test & Save
                  </button>
                  <button
                    onClick={handleComplete}
                    disabled={!apiKey.trim() || saving}
                    className="flex items-center gap-1 rounded-lg bg-notion-text px-4 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-50"
                  >
                    {saving && <Loader2 size={13} className="animate-spin" />}
                    Finish
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
