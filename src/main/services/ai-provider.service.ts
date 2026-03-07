import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  generateText,
  streamText,
  type LanguageModel,
  type TextPart,
  type ImagePart,
  type FilePart,
} from 'ai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { spawnSync } from 'child_process';
import { getProxy, getProxyScope } from '../store/app-settings-store';
import { proxyFetch } from './proxy-fetch';

function isOfficialOpenAIBaseUrl(baseURL?: string): boolean {
  if (!baseURL) return true;
  try {
    const url = new URL(baseURL);
    return url.hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

function shouldUseOpenAIChatCompatibility(providerId: string, baseURL?: string): boolean {
  if (providerId === 'custom') return true;
  if (providerId === 'openai' && !isOfficialOpenAIBaseUrl(baseURL)) return true;
  return false;
}

function formatModelRequestError(
  err: unknown,
  context: {
    kind: ModelKind;
    provider?: string;
    model?: string;
    baseURL?: string;
  },
): Error {
  const provider = context.provider ?? 'unknown-provider';
  const model = context.model ?? 'unknown-model';
  const baseURL = context.baseURL ? ` @ ${context.baseURL}` : '';
  const prefix = `${context.kind} model request failed (${provider}/${model}${baseURL})`;

  if (err instanceof Error) {
    const cause = err.cause;
    if (cause && typeof cause === 'object') {
      const maybeStatus =
        'statusCode' in cause ? cause.statusCode : 'status' in cause ? cause.status : null;
      const maybeText =
        'responseBody' in cause ? cause.responseBody : 'body' in cause ? cause.body : null;
      if (typeof maybeStatus === 'number') {
        const suffix =
          typeof maybeText === 'string' && maybeText.trim()
            ? `: HTTP ${maybeStatus} ${maybeText.trim()}`
            : `: HTTP ${maybeStatus}`;
        return new Error(`${prefix}${suffix}`);
      }
    }

    const message = err.message?.trim() || String(err);
    return new Error(`${prefix}: ${message}`);
  }

  return new Error(`${prefix}: ${String(err)}`);
}

/** Get a custom fetch function with proxy support if configured */
function getProxyFetch(): typeof fetch | undefined {
  const scope = getProxyScope();
  const proxyUrl = getProxy();
  if (!proxyUrl || !scope.aiApi) return undefined;

  const agent = new HttpsProxyAgent(proxyUrl);

  return async (url, init) => {
    const method = (init?.method as string) ?? 'GET';
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers as HeadersInit);
      h.forEach((v, k) => { headers[k] = v; });
    }
    let body: Buffer | string | undefined;
    if (init?.body) {
      if (typeof init.body === 'string') body = init.body;
      else if (init.body instanceof ArrayBuffer) body = Buffer.from(init.body);
      else if (init.body instanceof Uint8Array) body = Buffer.from(init.body);
    }
    const res = await proxyFetch(url.toString(), { method, headers, body, agent, timeoutMs: 60_000 });
    return new Response(res.body, { status: res.status, headers });
  };
}

// Type alias for content parts (ai package doesn't export ContentPart directly)
type ContentPart = TextPart | ImagePart | FilePart;
import { getActiveProvider, getProviderById, type ProviderConfig } from '../store/provider-store';
import {
  getActiveModel,
  getModelWithKey,
  type ModelConfig,
  type ModelKind,
} from '../store/model-config-store';
import {
  buildNonInteractiveCliArgs,
  getShellPath,
  parseStructuredCliOutput,
} from './cli-runner.service';
import { recordTokenUsage } from '../store/token-usage-store';
import fs from 'fs/promises';
import path from 'path';

/**
 * Record token usage from a generateText result
 */
function recordUsage(
  result: { usage?: { inputTokens?: number; outputTokens?: number } },
  provider: string,
  model: string,
  kind: 'agent' | 'lightweight' | 'chat' | 'other' = 'other',
) {
  if (result.usage) {
    recordTokenUsage({
      timestamp: new Date().toISOString(),
      provider,
      model,
      promptTokens: result.usage.inputTokens ?? 0,
      completionTokens: result.usage.outputTokens ?? 0,
      totalTokens: (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0),
      kind,
    });
  }
}

export function getLanguageModel(config: ProviderConfig & { apiKey?: string }): LanguageModel {
  const { id, apiKey, baseURL, model } = config;
  const proxyFetch = getProxyFetch();

  switch (id) {
    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
        baseURL,
        ...(proxyFetch ? { fetch: proxyFetch } : {}),
      });
      return provider(model);
    }
    case 'openai': {
      const provider = createOpenAI({
        apiKey: apiKey ?? process.env.OPENAI_API_KEY,
        baseURL,
        ...(proxyFetch ? { fetch: proxyFetch } : {}),
      });
      return shouldUseOpenAIChatCompatibility(id, baseURL) ? provider.chat(model) : provider(model);
    }
    case 'gemini': {
      const provider = createGoogleGenerativeAI({
        apiKey: apiKey ?? process.env.GOOGLE_API_KEY,
        baseURL,
        ...(proxyFetch ? { fetch: proxyFetch } : {}),
      });
      return provider(model);
    }
    case 'custom': {
      const provider = createOpenAI({
        apiKey: apiKey ?? '',
        baseURL,
        ...(proxyFetch ? { fetch: proxyFetch } : {}),
      });
      return provider.chat(model);
    }
    default:
      throw new Error(`Unknown provider: ${id}`);
  }
}

export async function fileToDataUrl(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
  };

  const mimeType = mimeTypes[ext] ?? 'application/octet-stream';
  const base64 = buffer.toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

export function providerSupportsFiles(providerId: string): boolean {
  return ['anthropic', 'openai', 'gemini'].includes(providerId);
}

async function buildContentParts(
  text: string,
  files: Array<{ path: string; type?: 'pdf' | 'image' }>,
): Promise<ContentPart[]> {
  const parts: ContentPart[] = [{ type: 'text', text }];

  for (const file of files) {
    const dataUrl = await fileToDataUrl(file.path);
    const ext = path.extname(file.path).toLowerCase();

    if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext) || file.type === 'image') {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          type: 'image',
          image: Buffer.from(match[2], 'base64'),
          mimeType: match[1],
        } as ImagePart);
      }
    } else {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        parts.push({
          type: 'file',
          data: Buffer.from(match[2], 'base64'),
          mimeType: match[1],
        } as unknown as FilePart);
      }
    }
  }

  return parts;
}

export async function generateWithActiveProvider(
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const config = getActiveProvider();

  if (!config) {
    return generateWithFallback(systemPrompt, userPrompt);
  }

  const model = getLanguageModel(config);
  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 4096,
    abortSignal: AbortSignal.timeout(120_000),
  });

  recordUsage(result, config.id, config.model, 'other');
  return result.text;
}

export async function generateWithFiles(
  systemPrompt: string,
  userPrompt: string,
  files: Array<{ path: string; type?: 'pdf' | 'image' }>,
): Promise<string> {
  const config = getActiveProvider();
  if (!config) {
    throw new Error('No AI provider configured. Please set up a provider in Settings.');
  }

  if (!providerSupportsFiles(config.id)) {
    throw new Error(`Provider ${config.id} does not support file uploads.`);
  }

  const model = getLanguageModel(config);
  const contentParts = await buildContentParts(userPrompt, files);

  const result = await generateText({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: contentParts }],
    maxOutputTokens: 4096,
  });

  recordUsage(result, config.id, config.model, 'other');
  return result.text;
}

export async function generateWithProvider(
  providerId: string,
  systemPrompt: string,
  userPrompt: string,
  files?: Array<{ path: string; type?: 'pdf' | 'image' }>,
): Promise<string> {
  const config = getProviderById(providerId);

  if (!config || !config.enabled) {
    throw new Error(`Provider ${providerId} is not configured or enabled.`);
  }

  const model = getLanguageModel(config);

  if (files && files.length > 0) {
    if (!providerSupportsFiles(config.id)) {
      throw new Error(`Provider ${config.id} does not support file uploads.`);
    }
    const contentParts = await buildContentParts(userPrompt, files);
    const result = await generateText({
      model,
      system: systemPrompt,
      messages: [{ role: 'user', content: contentParts }],
      maxOutputTokens: 4096,
    });
    recordUsage(result, config.id, config.model, 'other');
    return result.text;
  }

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    maxOutputTokens: 4096,
  });

  recordUsage(result, config.id, config.model, 'other');
  return result.text;
}

async function generateWithFallback(systemPrompt: string, userPrompt: string): Promise<string> {
  const anthropicKey = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
  if (anthropicKey) {
    const provider = createAnthropic({ apiKey: anthropicKey });
    const modelName = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6';
    const model = provider(modelName);
    const result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: 4096,
    });
    recordUsage(result, 'anthropic', modelName, 'other');
    return result.text;
  }

  throw new Error('No AI provider configured. Please set up a provider in Settings.');
}

export function getLanguageModelFromConfig(
  config: ModelConfig & { apiKey?: string },
): LanguageModel {
  const { provider, model, baseURL, apiKey } = config;
  const proxyFetch = getProxyFetch();

  if (!model) {
    throw new Error('Model ID is required in model config');
  }

  switch (provider) {
    case 'anthropic': {
      const p = createAnthropic({
        apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
        baseURL,
        ...(proxyFetch ? { fetch: proxyFetch } : {}),
      });
      return p(model);
    }
    case 'openai': {
      const p = createOpenAI({
        apiKey: apiKey ?? process.env.OPENAI_API_KEY,
        baseURL,
        ...(proxyFetch ? { fetch: proxyFetch } : {}),
      });
      return shouldUseOpenAIChatCompatibility(provider ?? 'openai', baseURL)
        ? p.chat(model)
        : p(model);
    }
    case 'gemini': {
      const p = createGoogleGenerativeAI({
        apiKey: apiKey ?? process.env.GOOGLE_API_KEY,
        baseURL,
        ...(proxyFetch ? { fetch: proxyFetch } : {}),
      });
      return p(model);
    }
    case 'custom': {
      const p = createOpenAI({
        apiKey: apiKey ?? '',
        baseURL,
        ...(proxyFetch ? { fetch: proxyFetch } : {}),
      });
      return p.chat(model);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Generate text using CLI backend
 */
async function generateWithCli(
  command: string,
  envVars: string | undefined,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  if (!command) {
    throw new Error('CLI command is required for CLI backend');
  }

  const env: Record<string, string | undefined> = { ...process.env, PATH: getShellPath() };
  delete env.CLAUDECODE; // Avoid nested session errors

  // Decrypt and inject env vars if provided
  if (envVars) {
    for (const pair of envVars.trim().split(/\s+/)) {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        env[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
    }
  }

  // Combine system and user prompts for CLI
  const fullPrompt = systemPrompt ? `System: ${systemPrompt}\n\nUser: ${userPrompt}` : userPrompt;

  // Parse command into binary and args (handle "claude --dangerously-skip-permissions" etc.)
  const cmdParts = command.trim().split(/\s+/);
  const binary = cmdParts[0];
  const cmdArgs =
    binary === 'codex'
      ? [...cmdParts.slice(1), 'exec', fullPrompt]
      : [...cmdParts.slice(1), '-p', fullPrompt];

  try {
    // Use spawnSync with array args to avoid command injection
    const result = spawnSync(binary, cmdArgs, {
      env,
      timeout: 60000, // 60 second timeout for AI generation
      encoding: 'utf-8',
      maxBuffer: 1024 * 1024, // 1MB buffer for long responses
    });

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0 && result.stderr) {
      throw new Error(`CLI exited with code ${result.status}: ${result.stderr}`);
    }

    const parsed = parseStructuredCliOutput(binary, result.stdout.trim());
    if (parsed.usage) {
      recordTokenUsage({
        timestamp: new Date().toISOString(),
        provider: binary,
        model: parsed.usage.model ?? command,
        promptTokens: parsed.usage.promptTokens,
        completionTokens: parsed.usage.completionTokens,
        totalTokens: parsed.usage.totalTokens,
        kind: 'agent',
      });
    }

    return parsed.text.trim() || result.stdout.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`CLI execution failed: ${msg}`);
  }
}

export async function generateWithModelKind(
  kind: ModelKind,
  systemPrompt: string,
  userPrompt: string,
  options: { strictSelection?: boolean } = {},
): Promise<string> {
  const modelConfig = getActiveModel(kind);

  if (modelConfig) {
    // API backend
    if (modelConfig.backend === 'api') {
      const configWithKey = getModelWithKey(modelConfig.id);
      if (configWithKey && configWithKey.apiKey) {
        const model = getLanguageModelFromConfig(configWithKey);
        try {
          const result = await generateText({
            model,
            system: systemPrompt,
            prompt: userPrompt,
            maxOutputTokens: kind === 'lightweight' ? 1024 : 4096,
            abortSignal: AbortSignal.timeout(120_000),
          });
          recordUsage(
            result,
            configWithKey.provider ?? 'unknown',
            configWithKey.model ?? 'unknown',
            kind,
          );
          return result.text;
        } catch (err) {
          throw formatModelRequestError(err, {
            kind,
            provider: configWithKey.provider,
            model: configWithKey.model,
            baseURL: configWithKey.baseURL,
          });
        }
      }

      throw new Error(
        `No API key configured for the selected ${kind} model. Please check Settings > Models.`,
      );
    }

    // CLI backend
    if (modelConfig.backend === 'cli' && modelConfig.command) {
      return generateWithCli(modelConfig.command, modelConfig.envVars, systemPrompt, userPrompt);
    }
  }

  if (options.strictSelection) {
    throw new Error(`No usable ${kind} model selected. Please check Settings > Models.`);
  }

  // Fallback to active provider
  return generateWithActiveProvider(systemPrompt, userPrompt);
}

export async function streamGenerateWithModelKind(
  kind: ModelKind,
  systemPrompt: string,
  userPrompt: string,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  options: { strictSelection?: boolean } = {},
): Promise<string> {
  const modelConfig = getActiveModel(kind);

  if (modelConfig?.backend === 'api') {
    const configWithKey = getModelWithKey(modelConfig.id);
    if (configWithKey?.apiKey) {
      const model = getLanguageModelFromConfig(configWithKey);
      try {
        const { textStream } = streamText({
          model,
          system: systemPrompt,
          prompt: userPrompt,
          maxTokens: kind === 'lightweight' ? 1024 : 4096,
          abortSignal: signal,
        });

        let fullText = '';
        for await (const chunk of textStream) {
          fullText += chunk;
          onChunk(chunk);
        }
        return fullText;
      } catch (err) {
        throw formatModelRequestError(err, {
          kind,
          provider: configWithKey.provider,
          model: configWithKey.model,
          baseURL: configWithKey.baseURL,
        });
      }
    }

    throw new Error(
      `No API key configured for the selected ${kind} model. Please check Settings > Models.`,
    );
  }

  if (options.strictSelection) {
    throw new Error(`No usable ${kind} model selected. Please check Settings > Models.`);
  }

  const text = await generateWithModelKind(kind, systemPrompt, userPrompt, options);
  if (text) {
    onChunk(text);
  }
  return text;
}

export function getSelectedModelInfo(kind: ModelKind): {
  id: string;
  backend: 'api' | 'cli';
  provider?: string;
  model?: string;
  baseURL?: string;
  hasApiKey: boolean;
} | null {
  const modelConfig = getActiveModel(kind);
  if (!modelConfig) return null;

  const configWithKey = getModelWithKey(modelConfig.id);
  return {
    id: modelConfig.id,
    backend: modelConfig.backend,
    provider: modelConfig.provider,
    model: modelConfig.model,
    baseURL: modelConfig.baseURL,
    hasApiKey: !!configWithKey?.apiKey,
  };
}

export { streamText, getActiveProvider };

/**
 * Test API connection for a given provider config
 */
export async function testApiConnection(params: {
  provider: 'anthropic' | 'openai' | 'gemini' | 'custom';
  model: string;
  apiKey?: string;
  baseURL?: string;
}): Promise<{ success: boolean; error?: string }> {
  const { provider, model, apiKey, baseURL } = params;
  const proxyFetch = getProxyFetch();

  if (!model) {
    return { success: false, error: 'Model ID is required' };
  }

  try {
    let languageModel: LanguageModel;

    switch (provider) {
      case 'anthropic': {
        const p = createAnthropic({
          apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY,
          baseURL,
          ...(proxyFetch ? { fetch: proxyFetch } : {}),
        });
        languageModel = p(model);
        break;
      }
      case 'openai': {
        const p = createOpenAI({
          apiKey: apiKey ?? process.env.OPENAI_API_KEY,
          baseURL,
          ...(proxyFetch ? { fetch: proxyFetch } : {}),
        });
        languageModel = shouldUseOpenAIChatCompatibility(provider, baseURL)
          ? p.chat(model)
          : p(model);
        break;
      }
      case 'gemini': {
        const p = createGoogleGenerativeAI({
          apiKey: apiKey ?? process.env.GOOGLE_API_KEY,
          baseURL,
          ...(proxyFetch ? { fetch: proxyFetch } : {}),
        });
        languageModel = p(model);
        break;
      }
      case 'custom': {
        if (!baseURL) {
          return { success: false, error: 'Base URL is required for custom provider' };
        }
        const p = createOpenAI({
          apiKey: apiKey ?? '',
          baseURL,
          ...(proxyFetch ? { fetch: proxyFetch } : {}),
        });
        languageModel = p.chat(model);
        break;
      }
      default:
        return { success: false, error: `Unknown provider: ${provider}` };
    }

    // Send a minimal test request
    const result = await generateText({
      model: languageModel,
      prompt: 'Say "ok" and nothing else.',
      maxOutputTokens: 5,
    });

    // Record test usage
    recordUsage(result, provider, model, 'other');

    // If we get any response, the connection is valid
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
