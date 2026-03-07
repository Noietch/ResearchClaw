import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AgentToolKind, ModelConfig } from '../store/model-config-store';

export interface AgentConfigFileStatus {
  label: string;
  path: string;
  exists: boolean;
}

export interface AgentConfigStatus {
  tool: AgentToolKind;
  files: AgentConfigFileStatus[];
  missingRequired: boolean;
}

export interface AgentConfigContents {
  tool: AgentToolKind;
  configContent?: string;
  authContent?: string;
}

export function getSystemAgentConfigStatus(tool: AgentToolKind): AgentConfigStatus {
  const home = os.homedir();

  if (tool === 'claude-code') {
    const settingsPath = path.join(home, '.claude', 'settings.json');
    const exists = fs.existsSync(settingsPath);
    return {
      tool,
      files: [{ label: 'Claude settings', path: settingsPath, exists }],
      missingRequired: !exists,
    };
  }

  if (tool === 'codex') {
    const configPath = path.join(home, '.codex', 'config.toml');
    const authPath = path.join(home, '.codex', 'auth.json');
    const configExists = fs.existsSync(configPath);
    const authExists = fs.existsSync(authPath);
    return {
      tool,
      files: [
        { label: 'Codex config', path: configPath, exists: configExists },
        { label: 'Codex auth', path: authPath, exists: authExists },
      ],
      missingRequired: !configExists || !authExists,
    };
  }

  return { tool, files: [], missingRequired: false };
}

export function readIfExists(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function collectHomeDirFiles(
  relativeDir: string,
): Array<{ relativePath: string; content: string }> {
  const baseDir = path.join(os.homedir(), relativeDir);
  if (!fs.existsSync(baseDir)) return [];

  const files: Array<{ relativePath: string; content: string }> = [];

  const visit = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(os.homedir(), entryPath);
      files.push({ relativePath, content: readIfExists(entryPath) });
    }
  };

  visit(baseDir);
  return files;
}

function upsertHomeFile(
  files: Array<{ relativePath: string; content: string }>,
  relativePath: string,
  content: string,
) {
  const index = files.findIndex((file) => file.relativePath === relativePath);
  if (index >= 0) {
    files[index] = { relativePath, content };
    return;
  }
  files.push({ relativePath, content });
}

export function getMissingAgentConfigMessage(
  model: Pick<ModelConfig, 'agentTool' | 'configContent' | 'authContent'>,
): string | null {
  const tool = model.agentTool;
  if (!tool || tool === 'custom') return null;

  const status = getSystemAgentConfigStatus(tool);

  if (tool === 'claude-code') {
    const hasInlineSettings = !!model.configContent?.trim();
    const systemSettings = status.files[0];
    if (!hasInlineSettings && !systemSettings?.exists) {
      return `Claude Code needs either app-managed settings or ${systemSettings?.path ?? '~/.claude/settings.json'}.`;
    }
    return null;
  }

  if (tool === 'codex') {
    const systemConfig = status.files.find((file) => file.path.endsWith('config.toml'));
    const systemAuth = status.files.find((file) => file.path.endsWith('auth.json'));
    const missing: string[] = [];

    if (!model.configContent?.trim() && !systemConfig?.exists) {
      missing.push(systemConfig?.path ?? '~/.codex/config.toml');
    }
    if (!model.authContent?.trim() && !systemAuth?.exists) {
      missing.push(systemAuth?.path ?? '~/.codex/auth.json');
    }

    if (missing.length > 0) {
      return `Codex needs ${missing.join(' and ')} unless you paste the matching content into Settings.`;
    }
  }

  return null;
}

export function resolveAgentCliArgs(
  model: Pick<ModelConfig, 'agentTool' | 'configContent' | 'authContent'>,
): string[] {
  if (model.agentTool !== 'claude-code') return [];

  const inlineSettings = model.configContent?.trim();
  if (inlineSettings) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-claude-settings-'));
    const tempSettingsPath = path.join(tempDir, 'settings.json');
    fs.writeFileSync(tempSettingsPath, inlineSettings, 'utf8');
    return ['--settings', tempSettingsPath];
  }

  const status = getSystemAgentConfigStatus('claude-code');
  const systemSettings = status.files[0];
  if (systemSettings?.exists) {
    return ['--settings', systemSettings.path];
  }

  return [];
}

export function resolveAgentHomeFiles(
  model: Pick<ModelConfig, 'agentTool' | 'configContent' | 'authContent'>,
): Array<{ relativePath: string; content: string }> {
  const tool = model.agentTool;
  if (!tool || tool === 'custom') return [];

  if (tool === 'claude-code') {
    const inlineSettings = model.configContent?.trim();
    if (!inlineSettings) {
      return [];
    }

    const files = collectHomeDirFiles('.claude');
    upsertHomeFile(files, '.claude/settings.json', inlineSettings);
    return files;
  }

  if (tool === 'codex') {
    const inlineConfig = model.configContent?.trim();
    const inlineAuth = model.authContent?.trim();
    if (!inlineConfig && !inlineAuth) {
      return [];
    }

    const files = collectHomeDirFiles('.codex');
    if (inlineConfig) upsertHomeFile(files, '.codex/config.toml', inlineConfig);
    if (inlineAuth) upsertHomeFile(files, '.codex/auth.json', inlineAuth);
    return files;
  }

  return [];
}

export function getSystemAgentConfigContents(tool: AgentToolKind): AgentConfigContents {
  const status = getSystemAgentConfigStatus(tool);

  if (tool === 'claude-code') {
    const settings = status.files[0];
    return {
      tool,
      configContent: settings?.exists ? readIfExists(settings.path) : undefined,
    };
  }

  if (tool === 'codex') {
    const configFile = status.files.find((file) => file.path.endsWith('config.toml'));
    const authFile = status.files.find((file) => file.path.endsWith('auth.json'));
    return {
      tool,
      configContent: configFile?.exists ? readIfExists(configFile.path) : undefined,
      authContent: authFile?.exists ? readIfExists(authFile.path) : undefined,
    };
  }

  return { tool };
}
