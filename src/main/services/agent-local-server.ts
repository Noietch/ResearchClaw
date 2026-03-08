import http from 'http';
import { randomUUID } from 'crypto';
import type { AgentToolKind } from '@shared';
import { appendLog, getLogFilePath } from './app-log.service';
import {
  getMissingAgentConfigMessage,
  resolveAgentCliArgs,
  resolveAgentHomeFiles,
} from './agent-config.service';
import {
  classifyCliTestError,
  runCli,
  testCliCommand,
  type CliUsageSummary,
} from './cli-runner.service';

export const AGENT_SERVICE_HOST = '127.0.0.1';
export const AGENT_SERVICE_PORT = 43127;
export const AGENT_SERVICE_VERSION = '2026-03-07-claude-homefix';

interface StreamClient {
  res: http.ServerResponse;
}

export interface AgentRunRequest {
  tool: string;
  args: string[];
  sessionId?: string;
  cwd?: string;
  envVars?: string;
  useProxy?: boolean;
  homeFiles?: Array<{ relativePath: string; content: string }>;
  prependArgs?: string[];
}

export interface AgentTestRequest {
  command: string;
  extraArgs?: string;
  envVars?: string;
  agentTool?: AgentToolKind;
  configContent?: string;
  authContent?: string;
  debugFilePrefix?: string;
}

export interface AgentTestResponse {
  success: boolean;
  output?: string;
  error?: string;
  diagnostics?: unknown;
  logFile?: string;
}

const sessions = new Map<
  string,
  {
    proc: { kill: () => void };
    buffered: Array<{ event: string; data: unknown }>;
    clients: Set<StreamClient>;
    closed: boolean;
  }
>();

function parseEnvVarsString(envVars?: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  if (!envVars) return parsed;
  for (const pair of envVars.trim().split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq > 0) parsed[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return parsed;
}

function writeSse(res: http.ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function emitSessionEvent(sessionId: string, event: string, data: unknown) {
  const session = sessions.get(sessionId);
  if (!session) return;
  const payload = { event, data };
  if (session.clients.size === 0) {
    session.buffered.push(payload);
    return;
  }
  for (const client of session.clients) {
    writeSse(client.res, event, data);
  }
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function handleTest(input: AgentTestRequest): Promise<AgentTestResponse> {
  appendLog(
    'agent-service',
    'test:start',
    { input, logFile: getLogFilePath('agent.log') },
    'agent.log',
  );

  const missingConfigMessage = getMissingAgentConfigMessage(input);
  if (missingConfigMessage) {
    return { success: false, error: missingConfigMessage, logFile: getLogFilePath('agent.log') };
  }

  const result = await testCliCommand({
    command: input.command,
    extraArgs: input.extraArgs,
    envVars: input.envVars,
    homeFiles: resolveAgentHomeFiles(input),
    prependArgs: input.command.includes('--settings') ? [] : resolveAgentCliArgs(input),
    useLoginShell: true,
    debugFilePrefix:
      input.debugFilePrefix ||
      (input.agentTool === 'claude-code'
        ? 'claude-test'
        : input.agentTool === 'codex'
          ? 'codex-test'
          : 'agent-test'),
  });

  const response = result.success
    ? {
        success: true,
        output: result.output,
        diagnostics: result.diagnostics,
        logFile: getLogFilePath('agent.log'),
      }
    : {
        success: false,
        error: classifyCliTestError(
          input.command.trim().split(/\s+/)[0] || 'cli',
          result.error ?? 'CLI test failed',
        ),
        diagnostics: result.diagnostics,
        logFile: getLogFilePath('agent.log'),
      };

  appendLog('agent-service', 'test:result', { response }, 'agent.log');
  return response;
}

function handleRun(input: AgentRunRequest): { sessionId: string; started: boolean } {
  const sessionId = input.sessionId || randomUUID();
  const cmdParts = input.tool.trim().split(/\s+/);
  const command = cmdParts[0];
  const args = [...cmdParts.slice(1), ...(input.prependArgs ?? []), ...input.args];

  const existing = sessions.get(sessionId);
  if (existing) {
    existing.proc.kill();
    sessions.delete(sessionId);
  }

  const state = {
    buffered: [] as Array<{ event: string; data: unknown }>,
    clients: new Set<StreamClient>(),
    closed: false,
    proc: runCli(command, args, {
      cwd: input.cwd,
      env: parseEnvVarsString(input.envVars),
      useProxy: input.useProxy,
      homeFiles: input.homeFiles,
      useLoginShell: true,
      onOutput: (data) => emitSessionEvent(sessionId, 'output', { data }),
      onError: (data) => emitSessionEvent(sessionId, 'error', { data }),
      onUsage: (usage) => emitSessionEvent(sessionId, 'usage', { usage }),
      onDone: (code) => {
        emitSessionEvent(sessionId, 'done', { code });
        const session = sessions.get(sessionId);
        if (session) {
          session.closed = true;
          for (const client of session.clients) client.res.end();
        }
      },
    }),
  };

  sessions.set(sessionId, state);
  appendLog('agent-service', 'run:start', { sessionId, command, args }, 'agent.log');
  return { sessionId, started: true };
}

function handleKill(sessionId: string): { killed: boolean } {
  const session = sessions.get(sessionId);
  if (!session) return { killed: false };
  session.proc.kill();
  sessions.delete(sessionId);
  appendLog('agent-service', 'run:kill', { sessionId }, 'agent.log');
  return { killed: true };
}

export async function startAgentLocalHttpServer(
  host = AGENT_SERVICE_HOST,
  port = AGENT_SERVICE_PORT,
): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    try {
      const url = req.url ?? '/';
      if (req.method === 'GET' && url === '/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'agent-local',
          port,
          version: AGENT_SERVICE_VERSION,
        });
        return;
      }
      if (req.method === 'POST' && url === '/v1/test') {
        sendJson(res, 200, await handleTest((await readJson(req)) as AgentTestRequest));
        return;
      }
      if (req.method === 'POST' && url === '/v1/run') {
        sendJson(res, 200, handleRun((await readJson(req)) as AgentRunRequest));
        return;
      }
      if (req.method === 'GET' && url.startsWith('/v1/stream/')) {
        const sessionId = url.split('/').pop() ?? '';
        const session = sessions.get(sessionId);
        if (!session) {
          sendJson(res, 404, { error: 'Unknown session' });
          return;
        }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const client = { res };
        session.clients.add(client);
        for (const item of session.buffered) writeSse(res, item.event, item.data);
        session.buffered = [];
        req.on('close', () => {
          session.clients.delete(client);
        });
        return;
      }
      if (req.method === 'POST' && url.startsWith('/v1/kill/')) {
        const sessionId = url.split('/').pop() ?? '';
        sendJson(res, 200, handleKill(sessionId));
        return;
      }
      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appendLog('agent-service', 'request:error', { message }, 'agent.log');
      sendJson(res, 500, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  appendLog('agent-service', 'startup:ready', { baseUrl: `http://${host}:${port}` }, 'agent.log');
  return server;
}
