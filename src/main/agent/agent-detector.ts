import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const execAsync = promisify(exec);

export interface DetectedAgent {
  backend: string;
  name: string;
  /** The CLI path used for ACP (may be a bridge like npx @zed-industries/claude-agent-acp) */
  cliPath: string;
  /** The native CLI path detected on the system (e.g. /usr/local/bin/claude) */
  nativeCliPath: string;
  acpArgs: string[];
  version?: string;
  configContent?: string;
  authContent?: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * Agent metadata for detection.
 *
 * ACP activation:
 * - Claude Code: native CLI doesn't support ACP; use npx @zed-industries/claude-agent-acp bridge
 * - Codex: native CLI doesn't support ACP; use npx @zed-industries/codex-acp bridge
 * - Gemini: gemini --acp (or bridge TBD)
 * - Qwen: qwen --acp
 * - Goose: goose acp (subcommand)
 *
 * When a native CLI is detected, `acpCliPath` overrides the cliPath for ACP mode,
 * while the original cliPath is kept for display.
 */
const AGENTS_TO_DETECT = [
  {
    backend: 'claude-code',
    name: 'Claude Code',
    cli: 'claude',
    acpCliPath: 'npx @zed-industries/claude-agent-acp',
    acpArgs: [] as string[],
    configFiles: [{ key: 'config' as const, path: '.claude/settings.json' }],
  },
  {
    backend: 'codex',
    name: 'Code X',
    cli: 'codex',
    acpCliPath: 'npx @zed-industries/codex-acp',
    acpArgs: [] as string[],
    configFiles: [
      { key: 'config' as const, path: '.codex/config.toml' },
      { key: 'auth' as const, path: '.codex/auth.json' },
    ],
  },
  {
    backend: 'gemini',
    name: 'Gemini CLI',
    cli: 'gemini',
    acpArgs: ['--acp'],
    configFiles: [
      { key: 'config' as const, path: '.gemini/settings.json' },
      { key: 'auth' as const, path: '.gemini/oauth_creds.json' },
    ],
  },
  {
    backend: 'qwen',
    name: 'Qwen Code',
    cli: 'qwen',
    acpArgs: ['--acp'],
    configFiles: [],
  },
  {
    backend: 'goose',
    name: 'Goose',
    cli: 'goose',
    acpArgs: ['acp'],
    configFiles: [],
  },
];

function readHomeFile(relativePath: string): string | undefined {
  const fullPath = join(homedir(), relativePath);
  if (existsSync(fullPath)) {
    try {
      return readFileSync(fullPath, 'utf-8');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseJsonSafe(content: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

/** Extract apiKey, baseUrl, defaultModel from Claude's ~/.claude/settings.json */
function extractClaudeConfig(configContent?: string): {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
} {
  if (!configContent) return {};
  const json = parseJsonSafe(configContent);
  if (!json) return {};
  const env = json.env as Record<string, string> | undefined;
  return {
    apiKey: env?.ANTHROPIC_AUTH_TOKEN || env?.ANTHROPIC_API_KEY,
    baseUrl: (env?.ANTHROPIC_BASE_URL as string)?.trim() || undefined,
    defaultModel: json.model as string | undefined,
  };
}

/** Extract apiKey, baseUrl, defaultModel from Codex's config.toml + auth.json */
function extractCodexConfig(
  configContent?: string,
  authContent?: string,
): { apiKey?: string; baseUrl?: string; defaultModel?: string } {
  const result: { apiKey?: string; baseUrl?: string; defaultModel?: string } = {};

  // auth.json: { "OPENAI_API_KEY": "sk-..." }
  if (authContent) {
    const authJson = parseJsonSafe(authContent);
    if (authJson) {
      result.apiKey = authJson.OPENAI_API_KEY as string | undefined;
    }
  }

  // config.toml: simple line-based parsing for model, base_url
  if (configContent) {
    // Extract top-level model
    const modelMatch = configContent.match(/^model\s*=\s*"([^"]+)"/m);
    if (modelMatch) result.defaultModel = modelMatch[1];

    // Extract base_url from the active model_provider section
    const providerMatch = configContent.match(/^model_provider\s*=\s*"([^"]+)"/m);
    if (providerMatch) {
      const providerName = providerMatch[1];
      // Find [model_providers.<name>] section and extract base_url
      const sectionRegex = new RegExp(
        `\\[model_providers\\.${providerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]([\\s\\S]*?)(?=\\n\\[|$)`,
      );
      const sectionMatch = configContent.match(sectionRegex);
      if (sectionMatch) {
        const urlMatch = sectionMatch[1].match(/base_url\s*=\s*"([^"]+)"/);
        if (urlMatch) result.baseUrl = urlMatch[1];
      }
    }
  }

  return result;
}

function extractAgentApiConfig(
  backend: string,
  configContent?: string,
  authContent?: string,
): { apiKey?: string; baseUrl?: string; defaultModel?: string } {
  switch (backend) {
    case 'claude-code':
      return extractClaudeConfig(configContent);
    case 'codex':
      return extractCodexConfig(configContent, authContent);
    default:
      return {};
  }
}

export async function detectAgents(): Promise<DetectedAgent[]> {
  const results = await Promise.allSettled(
    AGENTS_TO_DETECT.map(async (agent) => {
      const whichCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout } = await execAsync(`${whichCmd} ${agent.cli}`, { timeout: 1000 });
      const cliPath = stdout.trim().split('\n')[0];

      let configContent: string | undefined;
      let authContent: string | undefined;
      for (const cf of agent.configFiles) {
        const content = readHomeFile(cf.path);
        if (cf.key === 'config') configContent = content;
        else if (cf.key === 'auth') authContent = content;
      }

      const apiConfig = extractAgentApiConfig(agent.backend, configContent, authContent);

      // Use ACP bridge path if defined (e.g. npx @zed-industries/claude-agent-acp)
      const acpCliPath = 'acpCliPath' in agent ? (agent as any).acpCliPath : undefined;

      return {
        backend: agent.backend,
        name: agent.name,
        cliPath: acpCliPath || cliPath,
        nativeCliPath: cliPath,
        acpArgs: agent.acpArgs,
        configContent,
        authContent,
        ...apiConfig,
      };
    }),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<DetectedAgent> => r.status === 'fulfilled')
    .map((r) => r.value);
}
