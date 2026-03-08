import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * Encode a cwd path the same way Claude Code does when naming project directories.
 * e.g. "/Users/foo/bar" → "-Users-foo-bar"
 */
function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * Read a Claude Code session JSONL file and sum up all token usage
 * across every assistant message turn.
 *
 * Returns null if the file cannot be found or read.
 */
export async function readSessionStats(
  sessionId: string,
  cwd: string,
): Promise<SessionTokenUsage | null> {
  const claudeDir = path.join(os.homedir(), '.claude');
  const encoded = encodeProjectPath(cwd);

  // Search in the cwd-specific project dir first, then fall back to scanning
  // all project dirs (in case cwd differs from what Claude recorded).
  const candidateDirs = [path.join(claudeDir, 'projects', encoded)];

  // Also scan all project dirs for the session file
  try {
    const projectsDir = path.join(claudeDir, 'projects');
    const entries = await fs.readdir(projectsDir);
    for (const entry of entries) {
      const full = path.join(projectsDir, entry);
      if (!candidateDirs.includes(full)) {
        candidateDirs.push(full);
      }
    }
  } catch {
    // ignore
  }

  let jsonlPath: string | null = null;
  for (const dir of candidateDirs) {
    const candidate = path.join(dir, `${sessionId}.jsonl`);
    try {
      await fs.access(candidate);
      jsonlPath = candidate;
      break;
    } catch {
      // not found here, try next
    }
  }

  if (!jsonlPath) return null;

  try {
    const content = await fs.readFile(jsonlPath, 'utf-8');
    const lines = content.split('\n');

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.type !== 'assistant') continue;

        const message = obj.message as Record<string, unknown> | undefined;
        if (!message) continue;

        const usage = message.usage as Record<string, unknown> | undefined;
        if (!usage) continue;

        inputTokens += (usage.input_tokens as number) || 0;
        outputTokens += (usage.output_tokens as number) || 0;
        cacheReadTokens += (usage.cache_read_input_tokens as number) || 0;
        cacheCreationTokens += (usage.cache_creation_input_tokens as number) || 0;
      } catch {
        // skip malformed lines
      }
    }

    if (
      inputTokens === 0 &&
      outputTokens === 0 &&
      cacheReadTokens === 0 &&
      cacheCreationTokens === 0
    ) {
      return null;
    }

    return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
  } catch {
    return null;
  }
}
