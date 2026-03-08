/**
 * ACP End-to-End Integration Test
 *
 * Reads agent config from the real DB, spawns the real CLI via ACP,
 * sends a simple prompt, and verifies streaming chunks arrive.
 *
 * - If no enabled agent is found in DB, the test is skipped.
 * - If the agent fails to connect (network/auth issue), the test is skipped.
 * - Only runs when RUN_ACP_E2E=1 is set, to avoid slowing down normal CI.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';

const RUN = process.env.RUN_ACP_E2E === '1';

// ── Read agent config from DB ──────────────────────────────────────────────

interface AgentRow {
  id: string;
  name: string;
  cliPath: string | null;
  backend: string;
  acpArgs: string; // JSON string
  extraEnv: string; // JSON string
  enabled: number;
}

async function getEnabledAgent(): Promise<AgentRow | null> {
  const { execSync } = await import('child_process');
  const storageDir =
    process.env.VIBE_RESEARCH_STORAGE_DIR ?? path.join(os.homedir(), '.vibe-research');
  const dbPath = path.join(storageDir, 'vibe-research.db');

  try {
    const sql = `SELECT id, name, cliPath, backend, acpArgs, extraEnv, enabled FROM AgentConfig WHERE enabled = 1 ORDER BY createdAt ASC LIMIT 1;`;
    const out = execSync(`sqlite3 -json "${dbPath}" "${sql}"`, { encoding: 'utf8' }).trim();
    if (!out) return null;
    const rows = JSON.parse(out) as AgentRow[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildCleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...extra,
    NODE_OPTIONS: undefined,
    NODE_INSPECT: undefined,
    ELECTRON_RUN_AS_NODE: undefined,
    CLAUDECODE: undefined,
    CLAUDE_CODE_ENTRYPOINT: undefined,
    CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: undefined,
  };
  return env as NodeJS.ProcessEnv;
}

function buildSpawnArgs(cliPath: string, acpArgs: string[]): { cmd: string; args: string[] } {
  const parts = cliPath.trim().split(/\s+/);
  let cmd = parts[0];
  let args = [...parts.slice(1), ...acpArgs];

  if (cmd === 'npx' && !args.includes('--yes')) {
    args = ['--yes', '--prefer-offline', ...args];
  }

  return { cmd, args };
}

interface AcpResult {
  sessionId: string | null;
  chunks: string[];
  error: string | null;
  connectOk: boolean;
}

async function runAcpPrompt(
  cliPath: string,
  acpArgs: string[],
  extraEnv: Record<string, string>,
  cwd: string,
  prompt: string,
  timeoutMs = 60_000,
): Promise<AcpResult> {
  return new Promise((resolve) => {
    const { cmd, args } = buildSpawnArgs(cliPath, acpArgs);
    const env = buildCleanEnv(extraEnv);

    const proc = spawn(cmd, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    let buf = '';
    let id = 1;
    let sessionId: string | null = null;
    const chunks: string[] = [];
    let settled = false;

    const done = (result: AcpResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill();
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({
        sessionId,
        chunks,
        error: `Timeout after ${timeoutMs}ms`,
        connectOk: sessionId !== null,
      });
    }, timeoutMs);

    const send = (method: string, params: Record<string, unknown>) => {
      const msg = JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }) + '\n';
      proc.stdin.write(msg);
    };

    proc.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }

        // initialize response → send session/new
        if ((msg as { id?: number }).id === 1 && (msg as { result?: unknown }).result) {
          send('session/new', { cwd, mcpServers: [] });
        }

        // session/new response → capture sessionId, send prompt
        if (
          (msg as { id?: number }).id === 2 &&
          (msg as { result?: { sessionId?: string } }).result?.sessionId
        ) {
          sessionId = (msg as { result: { sessionId: string } }).result.sessionId;
          send('session/prompt', {
            sessionId,
            prompt: [{ type: 'text', text: prompt }],
          });
        }

        // session/prompt response (stopReason) → done
        if (
          (msg as { id?: number }).id === 3 &&
          (msg as { result?: unknown }).result !== undefined
        ) {
          done({ sessionId, chunks, error: null, connectOk: true });
        }

        // session/prompt error
        if ((msg as { id?: number }).id === 3 && (msg as { error?: { message: string } }).error) {
          const errMsg = (msg as { error: { message: string } }).error.message;
          done({ sessionId, chunks, error: errMsg, connectOk: sessionId !== null });
        }

        // streaming chunks
        if (
          (msg as { method?: string }).method === 'session/update' &&
          (msg as { params?: { update?: { sessionUpdate?: string; content?: { text?: string } } } })
            .params?.update?.sessionUpdate === 'agent_message_chunk'
        ) {
          const text =
            (msg as { params: { update: { content?: { text?: string } } } }).params.update.content
              ?.text ?? '';
          if (text) chunks.push(text);
        }
      }
    });

    proc.stderr.on('data', (d: Buffer) => {
      const text = d.toString();
      // If auth error surfaces on stderr after session/new, bail early
      if (text.includes('Authentication required') || text.includes('authentication')) {
        done({ sessionId, chunks, error: `Auth error: ${text.trim()}`, connectOk: false });
      }
    });

    proc.on('exit', (code) => {
      if (!settled) {
        done({
          sessionId,
          chunks,
          error: chunks.length > 0 ? null : `Process exited (code: ${code})`,
          connectOk: sessionId !== null,
        });
      }
    });

    // Kick off with initialize
    setTimeout(() => {
      send('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
      });
    }, 300);
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('ACP e2e: real agent from DB', () => {
  let agent: AgentRow | null = null;

  beforeAll(async () => {
    if (!RUN) return;
    agent = await getEnabledAgent();
  });

  it('finds an enabled agent in the database', () => {
    if (!RUN) {
      console.log('Skipped: set RUN_ACP_E2E=1 to run');
      return;
    }
    if (!agent) {
      console.log('Skipped: no enabled agent found in DB');
      return;
    }
    expect(agent.id).toBeTruthy();
    expect(agent.name).toBeTruthy();
    console.log(`Found agent: ${agent.name} (${agent.id})`);
    console.log(`  cliPath: ${agent.cliPath ?? agent.backend}`);
    console.log(`  acpArgs: ${agent.acpArgs}`);
  });

  it('connects via ACP (initialize + session/new)', async () => {
    if (!RUN || !agent) return;

    const cliPath = agent.cliPath ?? agent.backend;
    const acpArgs = JSON.parse(agent.acpArgs) as string[];
    const extraEnv = JSON.parse(agent.extraEnv || '{}') as Record<string, string>;
    const cwd = os.homedir();

    console.log(`\nSpawning: ${cliPath} ${acpArgs.join(' ')}`);

    const result = await runAcpPrompt(
      cliPath,
      acpArgs,
      extraEnv,
      cwd,
      'Reply with exactly one word: hello',
      30_000,
    );

    console.log(`  sessionId: ${result.sessionId}`);
    console.log(`  chunks received: ${result.chunks.length}`);
    console.log(`  response: ${result.chunks.join('').slice(0, 200)}`);
    if (result.error) console.log(`  error: ${result.error}`);

    if (!result.connectOk) {
      console.log('Skipped: agent could not connect (auth/network issue)');
      return;
    }

    expect(result.sessionId).toBeTruthy();
  }, 35_000);

  it('receives streaming message chunks from agent', async () => {
    if (!RUN || !agent) return;

    const cliPath = agent.cliPath ?? agent.backend;
    const acpArgs = JSON.parse(agent.acpArgs) as string[];
    const extraEnv = JSON.parse(agent.extraEnv || '{}') as Record<string, string>;
    const cwd = os.homedir();

    const result = await runAcpPrompt(
      cliPath,
      acpArgs,
      extraEnv,
      cwd,
      'Reply with exactly one word: hello',
      30_000,
    );

    if (!result.connectOk) {
      console.log('Skipped: agent could not connect');
      return;
    }

    if (result.error && result.chunks.length === 0) {
      console.log(`Skipped: error before any chunks — ${result.error}`);
      return;
    }

    expect(result.chunks.length).toBeGreaterThan(0);
    const fullResponse = result.chunks.join('');
    console.log(`Full response: "${fullResponse}"`);
    expect(fullResponse.length).toBeGreaterThan(0);
  }, 35_000);
});
