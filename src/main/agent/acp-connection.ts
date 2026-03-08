import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { AcpSessionUpdate, AcpPermissionRequest } from './acp-types';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export class AcpConnection extends EventEmitter {
  private child: ChildProcess | null = null;
  private buffer = '';
  private nextRequestId = 1;
  private pendingRequests = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeoutId: NodeJS.Timeout;
      method: string;
    }
  >();

  async spawn(
    cliPath: string,
    args: string[],
    cwd: string,
    env?: Record<string, string>,
  ): Promise<void> {
    const cleanEnv: Record<string, string | undefined> = {
      ...process.env,
      ...env,
      NODE_OPTIONS: undefined,
      NODE_INSPECT: undefined,
      ELECTRON_RUN_AS_NODE: undefined,
    };

    this.child = spawn(cliPath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv as NodeJS.ProcessEnv,
      detached: process.platform !== 'win32',
    });

    this.child.stdout!.on('data', (data: Buffer) => this.handleStdout(data));
    this.child.stderr!.on('data', (_data: Buffer) => {
      // stderr 通常是日志，忽略
    });
    this.child.on('exit', (code, signal) => {
      this.rejectAllPending(new Error(`Process exited (code: ${code})`));
      this.emit('exit', code, signal);
    });

    await this.sendRequest('initialize', {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
  }

  async createSession(cwd: string, resumeSessionId?: string): Promise<string> {
    const params: Record<string, unknown> = { cwd, mcpServers: [] };

    if (resumeSessionId) {
      params._meta = {
        claudeCode: { options: { resume: resumeSessionId } },
      };
      params.resumeSessionId = resumeSessionId;
    }

    const result = (await this.sendRequest('session/new', params)) as {
      sessionId: string;
    };

    return result.sessionId;
  }

  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    await this.sendRequest('session/set_mode', { sessionId, modeId });
  }

  async sendPrompt(sessionId: string, prompt: string): Promise<void> {
    await this.sendRequest(
      'session/prompt',
      {
        sessionId,
        prompt: [{ type: 'text', text: prompt }],
      },
      300_000,
    );
  }

  respondToPermission(requestId: number, optionId: string): void {
    this.sendResponse(requestId, {
      outcome: { outcome: 'selected', optionId },
    });
  }

  kill(): void {
    if (this.child && !this.child.killed) {
      if (this.child.pid && process.platform !== 'win32') {
        try {
          process.kill(-this.child.pid, 'SIGTERM');
        } catch {
          this.child.kill('SIGTERM');
        }
      } else {
        this.child.kill('SIGTERM');
      }
      setTimeout(() => {
        if (this.child && !this.child.killed) {
          this.child.kill('SIGKILL');
        }
      }, 3000);
    }
  }

  private handleStdout(data: Buffer): void {
    this.buffer += data.toString();
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch {
        // 非 JSON 输出，忽略
      }
    }
  }

  private handleMessage(msg: JsonRpcResponse | JsonRpcNotification | JsonRpcRequest): void {
    if ('id' in msg && msg.id != null) {
      if ('method' in msg) {
        this.handleAgentRequest(msg as JsonRpcRequest);
      } else {
        this.handleResponse(msg as JsonRpcResponse);
      }
    } else {
      this.handleNotification(msg as JsonRpcNotification);
    }
  }

  private handleResponse(msg: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(msg.id);

    if (msg.error) {
      pending.reject(new Error(`${pending.method}: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleNotification(msg: JsonRpcNotification): void {
    if (msg.method === 'session/update') {
      const params = msg.params as { sessionId: string; update: AcpSessionUpdate };
      this.emit('session:update', params.sessionId, params.update);
    } else if (msg.method === 'session/finished') {
      const params = msg.params as { sessionId: string };
      this.emit('session:finished', params.sessionId);
    }
  }

  private handleAgentRequest(msg: JsonRpcRequest): void {
    if (msg.method === 'session/request_permission') {
      const params = msg.params as { sessionId: string } & AcpPermissionRequest;
      this.emit('session:permission', msg.id, params.sessionId, params);
    } else if (msg.method === 'fs/read_text_file') {
      this.handleFsRead(msg);
    } else if (msg.method === 'fs/write_text_file') {
      this.handleFsWrite(msg);
    }
  }

  private async handleFsRead(msg: JsonRpcRequest): Promise<void> {
    try {
      const { path: filePath } = msg.params as { path: string };
      const fs = await import('node:fs/promises');
      const content = await fs.readFile(filePath, 'utf-8');
      this.sendResponse(msg.id, { content });
    } catch (error) {
      this.sendErrorResponse(msg.id, -1, (error as Error).message);
    }
  }

  private async handleFsWrite(msg: JsonRpcRequest): Promise<void> {
    try {
      const { path: filePath, content } = msg.params as { path: string; content: string };
      const fs = await import('node:fs/promises');
      await fs.writeFile(filePath, content, 'utf-8');
      this.sendResponse(msg.id, null);
    } catch (error) {
      this.sendErrorResponse(msg.id, -1, (error as Error).message);
    }
  }

  private sendRequest(
    method: string,
    params?: Record<string, unknown>,
    timeout = 60_000,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextRequestId++;
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method} (${timeout}ms)`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timeoutId, method });

      const message: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      this.writeMessage(message);
    });
  }

  private sendResponse(id: number, result: unknown): void {
    this.writeMessage({ jsonrpc: '2.0', id, result });
  }

  private sendErrorResponse(id: number, code: number, message: string): void {
    this.writeMessage({ jsonrpc: '2.0', id, error: { code, message } });
  }

  private writeMessage(message: unknown): void {
    if (!this.child?.stdin?.writable) return;
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
