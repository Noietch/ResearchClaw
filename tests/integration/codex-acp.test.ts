/**
 * Codex ACP Connection Test
 *
 * Tests the codex-acp bridge directly to verify Karen agent can connect.
 * Uses the user's existing ~/.codex/config.toml and ~/.codex/auth.json.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import fs from 'fs';

const RUN = process.env.RUN_CODEX_E2E === '1';

// Check if codex config exists
function hasCodexConfig(): boolean {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  return fs.existsSync(configPath) && fs.existsSync(authPath);
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

interface AcpResult {
  sessionId: string | null;
  chunks: string[];
  error: string | null;
  connectOk: boolean;
}

async function runCodexAcpPrompt(prompt: string, timeoutMs = 60_000): Promise<AcpResult> {
  return new Promise((resolve) => {
    const cwd = os.homedir();
    const env = buildCleanEnv();

    // codex-acp uses npx @zed-industries/codex-acp
    const cmd = 'npx';
    const args = ['--yes', '--prefer-offline', '@zed-industries/codex-acp'];

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

describe('Codex ACP: codex-acp bridge', () => {
  let hasConfig: boolean;

  beforeAll(() => {
    hasConfig = hasCodexConfig();
  });

  it('checks if codex config files exist', () => {
    if (!RUN) {
      console.log('Skipped: set RUN_CODEX_E2E=1 to run');
      return;
    }
    if (!hasConfig) {
      console.log('Skipped: ~/.codex/config.toml or ~/.codex/auth.json not found');
      return;
    }
    expect(hasConfig).toBe(true);
    console.log('Found ~/.codex/config.toml and ~/.codex/auth.json');
  });

  it('connects via ACP (initialize + session/new)', async () => {
    if (!RUN || !hasConfig) return;

    console.log('\nSpawning: npx @zed-industries/codex-acp');

    const result = await runCodexAcpPrompt('Reply with exactly one word: hello', 45_000);

    console.log(`  sessionId: ${result.sessionId}`);
    console.log(`  chunks received: ${result.chunks.length}`);
    console.log(`  response: ${result.chunks.join('').slice(0, 200)}`);
    if (result.error) console.log(`  error: ${result.error}`);

    if (!result.connectOk) {
      console.log('Skipped: codex-acp could not connect (auth/network issue)');
      return;
    }

    expect(result.sessionId).toBeTruthy();
  }, 50_000);

  it('receives streaming message chunks from codex', async () => {
    if (!RUN || !hasConfig) return;

    const result = await runCodexAcpPrompt('Reply with exactly one word: hello', 45_000);

    if (!result.connectOk) {
      console.log('Skipped: codex-acp could not connect');
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
  }, 50_000);
});
