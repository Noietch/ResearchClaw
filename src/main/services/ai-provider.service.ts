import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  generateText,
  streamText,
  type LanguageModelV1,
  type TextPart,
  type ImagePart,
  type FilePart,
} from 'ai';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Agent } from 'node:http';
import { spawnSync } from 'child_process';
import { getProxy } from '../store/app-settings-store';

/** Get a custom fetch function with proxy support if configured */
function getProxyFetch(): typeof fetch | undefined {
  const proxyUrl = getProxy();
  if (!proxyUrl) return undefined;

  const agent = new HttpsProxyAgent(proxyUrl) as unknown as Agent;
  const originalFetch = globalThis.fetch;

  return async (url, init) => {
    return originalFetch(url, { ...init, agent } as RequestInit);
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
import { getDecryptedEnvVars } from '../store/cli-tools-store';
import { getShellPath } from './cli-runner.service';
import { recordTokenUsage } from '../store/token-usage-store';
import fs from 'fs/promises';
import path from 'path';

/**
 * Record token usage from a generateText result
 */
function recordUsage(
  result: { usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } },
  provider: string,
  model: string,
  kind: 'agent' | 'lightweight' | 'chat' | 'other' = 'other',
) {
  if (result.usage) {
    recordTokenUsage({
      timestamp: new Date().toISOString(),
      provider,
      model,
      promptTokens: result.usage.promptTokens ?? 0,
      completionTokens: result.usage.completionTokens ?? 0,
      totalTokens: result.usage.totalTokens ?? 0,
      kind,
    });
  }
}

export function getLanguageModel(config: ProviderConfig & { apiKey?: string }): LanguageModelV1 {
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
      return provider(model);
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
      return provider(model);
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
    maxTokens: 4096,
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
    maxTokens: 4096,
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
      maxTokens: 4096,
    });
    recordUsage(result, config.id, config.model, 'other');
    return result.text;
  }

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: 4096,
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
      maxTokens: 4096,
    });
    recordUsage(result, 'anthropic', modelName, 'other');
    return result.text;
  }

  throw new Error('No AI provider configured. Please set up a provider in Settings.');
}

export function getLanguageModelFromConfig(
  config: ModelConfig & { apiKey?: string },
): LanguageModelV1 {
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
      return p(model);
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
      return p(model);
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
  envVarsId: string | undefined,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  if (!command) {
    throw new Error('CLI command is required for CLI backend');
  }

  const env: Record<string, string | undefined> = { ...process.env, PATH: getShellPath() };
  delete env.CLAUDECODE; // Avoid nested session errors

  // Decrypt and inject env vars if provided
  if (envVarsId) {
    const decryptedEnv = getDecryptedEnvVars(envVarsId);
    if (decryptedEnv) {
      for (const pair of decryptedEnv.trim().split(/\s+/)) {
        const eq = pair.indexOf('=');
        if (eq > 0) {
          env[pair.slice(0, eq)] = pair.slice(eq + 1);
        }
      }
    }
  }

  // Combine system and user prompts for CLI
  const fullPrompt = systemPrompt ? `System: ${systemPrompt}\n\nUser: ${userPrompt}` : userPrompt;

  // Parse command into binary and args (handle "claude --dangerously-skip-permissions" etc.)
  const cmdParts = command.trim().split(/\s+/);
  const binary = cmdParts[0];
  const cmdArgs = [...cmdParts.slice(1), '-p', fullPrompt];

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

    return result.stdout.trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`CLI execution failed: ${msg}`);
  }
}

export async function generateWithModelKind(
  kind: ModelKind,
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const modelConfig = getActiveModel(kind);

  if (modelConfig) {
    // API backend
    if (modelConfig.backend === 'api') {
      const configWithKey = getModelWithKey(modelConfig.id);
      if (configWithKey && configWithKey.apiKey) {
        const model = getLanguageModelFromConfig(configWithKey);
        const result = await generateText({
          model,
          system: systemPrompt,
          prompt: userPrompt,
          maxTokens: kind === 'lightweight' ? 1024 : 4096,
        });
        recordUsage(
          result,
          configWithKey.provider ?? 'unknown',
          configWithKey.model ?? 'unknown',
          kind,
        );
        return result.text;
      }
    }

    // CLI backend
    if (modelConfig.backend === 'cli' && modelConfig.command) {
      return generateWithCli(
        modelConfig.command,
        modelConfig.id, // use model id to lookup encrypted env vars
        systemPrompt,
        userPrompt,
      );
    }
  }

  // Fallback to active provider
  return generateWithActiveProvider(systemPrompt, userPrompt);
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
    let languageModel: LanguageModelV1;

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
        languageModel = p(model);
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
        languageModel = p(model);
        break;
      }
      default:
        return { success: false, error: `Unknown provider: ${provider}` };
    }

    // Send a minimal test request
    const result = await generateText({
      model: languageModel,
      prompt: 'Say "ok" and nothing else.',
      maxTokens: 5,
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
