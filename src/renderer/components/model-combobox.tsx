import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export interface ModelOption {
  id: string;
  provider: string;
  description?: string;
}

// Comprehensive model list organized by provider
const MODEL_OPTIONS: ModelOption[] = [
  // OpenAI GPT-5 series
  { id: 'gpt-5.4', provider: 'openai', description: '最新旗舰模型' },
  { id: 'gpt-5.4-2026-03-05', provider: 'openai', description: '最新旗舰模型' },
  { id: 'gpt-5.2', provider: 'openai', description: '旗舰模型' },
  { id: 'gpt-5.2-2025-12-11', provider: 'openai', description: '旗舰模型' },
  { id: 'gpt-5.2-chat-latest', provider: 'openai', description: 'ChatGPT当前版本' },
  { id: 'gpt-5.2-pro', provider: 'openai', description: '多轮交互模型' },
  { id: 'gpt-5.1', provider: 'openai', description: '可配置推理能力' },
  { id: 'gpt-5.1-2025-11-13', provider: 'openai', description: '可配置推理能力' },
  { id: 'gpt-5.1-chat-latest', provider: 'openai', description: 'ChatGPT当前版本' },
  { id: 'gpt-5.1-codex', provider: 'openai', description: '编码优化' },
  { id: 'gpt-5-search-api', provider: 'openai', description: '搜索模型' },
  { id: 'gpt-5', provider: 'openai', description: '旗舰模型' },
  { id: 'gpt-5-codex', provider: 'openai', description: '编码优化' },
  { id: 'gpt-5-pro', provider: 'openai', description: '深度思考' },
  { id: 'gpt-5-mini', provider: 'openai', description: '快速经济版' },
  { id: 'gpt-5-nano', provider: 'openai', description: '最快最便宜' },
  { id: 'gpt-5-chat-latest', provider: 'openai', description: 'ChatGPT当前版本' },

  // OpenAI o-series
  { id: 'o3', provider: 'openai', description: '推理模型' },
  { id: 'o3-2025-04-16', provider: 'openai', description: '推理模型' },
  { id: 'o4-mini', provider: 'openai', description: '推理模型' },
  { id: 'o4-mini-2025-04-16', provider: 'openai', description: '推理模型' },
  { id: 'o3-mini', provider: 'openai', description: '推理模型' },
  { id: 'o1', provider: 'openai', description: '复杂推理' },

  // OpenAI GPT-4 series
  { id: 'gpt-4.1', provider: 'openai', description: '1M输入32k输出' },
  { id: 'gpt-4.1-2025-04-14', provider: 'openai', description: '1M输入32k输出' },
  { id: 'gpt-4.1-mini', provider: 'openai', description: '经济版' },
  { id: 'gpt-4.1-mini-2025-04-14', provider: 'openai', description: '经济版' },
  { id: 'gpt-4.1-nano', provider: 'openai', description: '最便宜' },
  { id: 'gpt-4.1-nano-2025-04-14', provider: 'openai', description: '最便宜' },
  { id: 'gpt-4o', provider: 'openai', description: '多模态' },
  { id: 'gpt-4o-2024-11-20', provider: 'openai', description: '多模态' },
  { id: 'gpt-4o-2024-08-06', provider: 'openai', description: '多模态' },
  { id: 'gpt-4o-2024-05-13', provider: 'openai', description: '多模态' },
  { id: 'gpt-4o-mini', provider: 'openai', description: '经济版多模态' },
  { id: 'gpt-4o-search-preview', provider: 'openai', description: '搜索模型' },
  { id: 'gpt-4o-mini-search-preview', provider: 'openai', description: '搜索模型' },
  { id: 'gpt-4-turbo', provider: 'openai', description: '128K输入' },
  { id: 'gpt-4-turbo-2024-04-09', provider: 'openai', description: '128K输入' },
  { id: 'gpt-4', provider: 'openai', description: '经典模型' },
  { id: 'gpt-4-0613', provider: 'openai', description: '经典模型' },
  { id: 'gpt-3.5-turbo', provider: 'openai', description: '经济快速' },
  { id: 'gpt-3.5-turbo-0125', provider: 'openai', description: '经济快速' },

  // OpenAI OSS
  { id: 'gpt-oss-20b', provider: 'openai', description: '开源模型' },
  { id: 'gpt-oss-120b', provider: 'openai', description: '开源模型' },

  // Anthropic Claude
  { id: 'claude-opus-4-6', provider: 'anthropic', description: '最强能力' },
  { id: 'claude-opus-4-6-thinking', provider: 'anthropic', description: '思考模式' },
  { id: 'claude-opus-4-5-20251101', provider: 'anthropic', description: 'Opus 4.5' },
  { id: 'claude-opus-4-5-20251101-thinking', provider: 'anthropic', description: '思考模式' },
  { id: 'claude-opus-4-20250514', provider: 'anthropic', description: 'Opus 4' },
  { id: 'claude-opus-4-20250514-thinking', provider: 'anthropic', description: '思考模式' },
  { id: 'claude-opus-4-1-20250805', provider: 'anthropic', description: 'Opus 4.1' },
  { id: 'claude-opus-4-1-20250805-thinking', provider: 'anthropic', description: '思考模式' },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', description: '均衡性价比' },
  { id: 'claude-sonnet-4-6-thinking', provider: 'anthropic', description: '思考模式' },
  { id: 'claude-sonnet-4-5-20250929', provider: 'anthropic', description: 'Sonnet 4.5' },
  { id: 'claude-sonnet-4-5-20250929-thinking', provider: 'anthropic', description: '思考模式' },
  { id: 'claude-sonnet-4-20250514', provider: 'anthropic', description: 'Sonnet 4' },
  { id: 'claude-sonnet-4-20250514-thinking', provider: 'anthropic', description: '思考模式' },
  { id: 'claude-3-7-sonnet-20250219', provider: 'anthropic', description: 'Sonnet 3.7' },
  { id: 'claude-3-5-sonnet-20241022', provider: 'anthropic', description: 'Sonnet 3.5' },
  { id: 'claude-3-5-sonnet-20240620', provider: 'anthropic', description: 'Sonnet 3.5' },
  { id: 'claude-3-5-haiku-20241022', provider: 'anthropic', description: '快速经济' },
  { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', description: 'Haiku 4.5' },
  { id: 'claude-haiku-4-5-20251001-thinking', provider: 'anthropic', description: '思考模式' },

  // Google Gemini
  { id: 'gemini-3-pro-preview', provider: 'gemini', description: 'Gemini 3 Pro' },
  { id: 'gemini-3-flash-preview', provider: 'gemini', description: 'Gemini 3 Flash' },
  { id: 'gemini-3-flash-preview-nothinking', provider: 'gemini', description: '无思考模式' },
  { id: 'gemini-3.1-pro-preview', provider: 'gemini', description: 'Gemini 3.1 Pro' },
  { id: 'gemini-2.5-pro', provider: 'gemini', description: '旗舰模型' },
  { id: 'gemini-2.5-flash', provider: 'gemini', description: '快速版' },
  { id: 'gemini-2.5-flash-nothinking', provider: 'gemini', description: '无思考模式' },
  { id: 'gemini-2.5-flash-lite', provider: 'gemini', description: '轻量版' },
  { id: 'gemini-2.5-flash-image-preview', provider: 'gemini', description: '生图模型' },
  { id: 'gemini-3-pro-image-preview', provider: 'gemini', description: '生图模型' },
  { id: 'gemini-3.1-flash-image-preview', provider: 'gemini', description: '生图模型' },

  // DeepSeek
  { id: 'deepseek-v3.2', provider: 'deepseek', description: '聊天模型' },
  { id: 'deepseek-v3.2-thinking', provider: 'deepseek', description: '思考模式' },
  { id: 'deepseek-v3-2-exp', provider: 'deepseek', description: '实验版' },
  { id: 'deepseek-v3.1-250821', provider: 'deepseek', description: '聊天模型' },
  { id: 'deepseek-v3.1-think-250821', provider: 'deepseek', description: '思考模式' },
  { id: 'deepseek-reasoner', provider: 'deepseek', description: 'R1推理' },
  { id: 'deepseek-r1', provider: 'deepseek', description: 'R1推理' },
  { id: 'deepseek-r1-250528', provider: 'deepseek', description: 'R1推理' },
  { id: 'deepseek-v3', provider: 'deepseek', description: '聊天模型' },
  { id: 'deepseek-chat', provider: 'deepseek', description: '聊天模型' },

  // Grok
  { id: 'grok-4', provider: 'grok', description: '基础模型' },
  { id: 'grok-4-fast', provider: 'grok', description: '快速版' },

  // Qwen
  { id: 'qwen3.5-plus', provider: 'qwen', description: 'Qwen模型' },
  { id: 'qwen3.5-397b-a17b', provider: 'qwen', description: '大模型' },
  { id: 'qwen3-max-2026-01-23', provider: 'qwen', description: '最大模型' },
  { id: 'qwen3-235b-a22b', provider: 'qwen', description: '开源模型' },
  { id: 'qwen3-235b-a22b-instruct-2507', provider: 'qwen', description: '开源模型' },
  { id: 'qwen3-coder-plus', provider: 'qwen', description: '编码模型' },
  { id: 'qwen3-coder-480b-a35b-instruct', provider: 'qwen', description: '编码模型' },

  // Kimi
  { id: 'kimi-k2.5', provider: 'kimi', description: 'Kimi模型' },
  { id: 'kimi-k2-0711-preview', provider: 'kimi', description: 'Kimi K2' },
  { id: 'kimi-k2-0905-preview', provider: 'kimi', description: 'Kimi K2' },
  { id: 'kimi-k2-thinking', provider: 'kimi', description: '思考模式' },
  { id: 'kimi-k2-thinking-turbo', provider: 'kimi', description: '思考加速' },

  // GLM
  { id: 'glm-4.7', provider: 'glm', description: 'GLM模型' },
  { id: 'glm-5', provider: 'glm', description: 'GLM 5' },

  // Minimax
  { id: 'minimax-m2.1', provider: 'minimax', description: 'Minimax模型' },
  { id: 'minimax-m2.5', provider: 'minimax', description: 'Minimax模型' },
];

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google',
  deepseek: 'DeepSeek',
  grok: 'Grok',
  qwen: 'Qwen',
  kimi: 'Kimi',
  glm: 'GLM',
  minimax: 'Minimax',
};

export function ModelCombobox({
  value,
  onChange,
  placeholder = '选择或输入模型ID',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter models based on search
  const filteredModels = useMemo(() => {
    if (!search.trim()) return MODEL_OPTIONS;
    const q = search.toLowerCase();
    return MODEL_OPTIONS.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q) ||
        m.description?.toLowerCase().includes(q),
    );
  }, [search]);

  // Group filtered models by provider
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelOption[]> = {};
    for (const model of filteredModels) {
      if (!groups[model.provider]) {
        groups[model.provider] = [];
      }
      groups[model.provider].push(model);
    }
    return groups;
  }, [filteredModels]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Scroll selected into view
  useEffect(() => {
    if (isOpen && value && listRef.current) {
      const selected = listRef.current.querySelector(`[data-model="${value}"]`);
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [isOpen, value]);

  const handleSelect = (modelId: string) => {
    onChange(modelId);
    setIsOpen(false);
    setSearch('');
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setSearch(newValue);
    if (!isOpen) setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'ArrowDown' && isOpen) {
      e.preventDefault();
      const first = listRef.current?.querySelector('[data-model]');
      if (first) (first as HTMLElement).focus();
    }
  };

  const clearInput = () => {
    onChange('');
    setSearch('');
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full rounded-lg border border-notion-border bg-white px-3 py-2.5 pr-10 font-mono text-sm text-notion-text placeholder-notion-text-tertiary outline-none transition-colors focus:border-notion-accent focus:ring-2 focus:ring-notion-accent/20"
        />
        <div className="absolute right-2 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={clearInput}
              className="rounded p-0.5 text-notion-text-tertiary hover:text-notion-text"
            >
              <X size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="rounded p-0.5 text-notion-text-tertiary hover:text-notion-text"
          >
            <ChevronDown
              size={14}
              className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 max-h-80 w-full overflow-hidden rounded-lg border border-notion-border bg-white shadow-lg">
          {/* Model list */}
          <div ref={listRef} className="max-h-64 overflow-y-auto">
            {Object.entries(groupedModels).map(([provider, models]) => (
              <div key={provider}>
                <div className="sticky top-0 bg-notion-sidebar px-3 py-1.5 text-xs font-medium text-notion-text-secondary">
                  {PROVIDER_LABELS[provider] || provider}
                </div>
                {models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    data-model={model.id}
                    onClick={() => handleSelect(model.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors ${
                      value === model.id
                        ? 'bg-notion-accent-light text-notion-accent'
                        : 'text-notion-text hover:bg-notion-sidebar'
                    }`}
                  >
                    <span className="flex-1 truncate font-mono text-xs">{model.id}</span>
                    {model.description && (
                      <span className="text-xs text-notion-text-tertiary">{model.description}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
            {filteredModels.length === 0 && (
              <div className="px-3 py-4 text-center text-sm text-notion-text-tertiary">
                未找到匹配模型，按回车使用自定义ID
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
