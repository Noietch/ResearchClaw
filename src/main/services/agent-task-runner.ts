import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { AcpConnection } from '../agent/acp-connection';
import type {
  SessionUpdate,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from '../agent/acp-types';
import { YOLO_MODE_IDS } from '../agent/acp-types';
import { transformAcpUpdate, TodoMessage } from '../agent/acp-adapter';
import type { SshConnectConfig } from '@shared';

export type TaskStatus =
  | 'idle'
  | 'initializing'
  | 'running'
  | 'waiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TaskRunnerConfig {
  todoId: string;
  runId: string;
  backend: string;
  cliPath: string;
  acpArgs: string[];
  cwd: string;
  yoloMode: boolean;
  resumeSessionId?: string;
  extraEnv?: Record<string, string>;
  sshConfig?: SshConnectConfig; // If set, run agent remotely via SSH
}

interface PendingPermission {
  request: RequestPermissionRequest;
  resolve: (r: RequestPermissionResponse) => void;
}

export class AgentTaskRunner extends EventEmitter {
  private connection: AcpConnection;
  private config: TaskRunnerConfig;
  private status: TaskStatus = 'idle';
  private sessionId: string | null = null;
  private currentMsgId: string = '';
  private accumulatedText: string = '';
  // Key is a string ID (safe to pass over IPC); mapped from the Symbol in the event
  private pendingPermissions: Map<string, PendingPermission> = new Map();
  private symbolToKey: Map<symbol, string> = new Map();
  readonly messages: TodoMessage[] = [];

  constructor(config: TaskRunnerConfig) {
    super();
    this.config = config;
    this.connection = new AcpConnection();
    this.setupConnectionHandlers();
  }

  async start(prompt: string): Promise<void> {
    try {
      this.setStatus('initializing');

      // Different status message for local vs remote
      const statusMessage = this.config.sshConfig
        ? `Connecting to ${this.config.sshConfig.host}...`
        : 'Starting agent...';

      this.pushEvent('status', {
        todoId: this.config.todoId,
        status: 'initializing',
        message: statusMessage,
      });

      // Spawn locally or remotely based on config
      if (this.config.sshConfig) {
        await this.connection.spawnRemote(
          this.config.sshConfig,
          this.config.cliPath,
          this.config.acpArgs,
          this.config.cwd,
          this.config.extraEnv,
        );
      } else {
        await this.connection.spawn(
          this.config.cliPath,
          this.config.acpArgs,
          this.config.cwd,
          this.config.extraEnv,
        );
      }

      this.sessionId = await this.connection.createSession(
        this.config.cwd,
        this.config.resumeSessionId,
      );
      this.pushEvent('session', { todoId: this.config.todoId, sessionId: this.sessionId });

      if (this.config.yoloMode) {
        const modeId = this.getYoloModeId();
        if (modeId) {
          await this.connection.setSessionMode(this.sessionId, modeId);
        }
      }

      this.setStatus('running');
      this.currentMsgId = this.generateMsgId();
      this.pushEvent('status', {
        todoId: this.config.todoId,
        status: 'running',
        message: 'Agent is working...',
      });

      await this.connection.sendPrompt(this.sessionId, prompt);

      this.setStatus('completed');
      this.pushEvent('status', {
        todoId: this.config.todoId,
        status: 'completed',
        message: 'Task completed',
      });
    } catch (error) {
      if (this.status !== 'cancelled') {
        this.setStatus('failed');
        this.pushEvent('error', { todoId: this.config.todoId, message: (error as Error).message });
      }
      throw error;
    }
  }

  stop(): void {
    this.setStatus('cancelled');
    this.pushEvent('status', {
      todoId: this.config.todoId,
      status: 'cancelled',
      message: 'Task cancelled by user',
    });
    this.connection.kill();
  }

  async sendMessage(text: string): Promise<void> {
    console.log(
      '[AgentTaskRunner] sendMessage, sessionId=',
      this.sessionId,
      'status=',
      this.status,
    );
    if (!this.sessionId) throw new Error('No active session');
    if (this.status !== 'completed') throw new Error('Runner not in completed state');

    try {
      this.setStatus('running');
      this.currentMsgId = this.generateMsgId();
      this.accumulatedText = '';
      this.pushEvent('status', {
        todoId: this.config.todoId,
        status: 'running',
        message: 'Agent is responding...',
      });

      console.log('[AgentTaskRunner] calling connection.sendPrompt...');
      await this.connection.sendPrompt(this.sessionId, text);
      console.log('[AgentTaskRunner] connection.sendPrompt done');

      this.setStatus('completed');
      this.pushEvent('status', { todoId: this.config.todoId, status: 'completed' });
    } catch (error) {
      console.error('[AgentTaskRunner] sendMessage error:', error);
      const s = this.status as TaskStatus;
      if (s !== 'cancelled') {
        this.setStatus('failed');
        this.pushEvent('error', { todoId: this.config.todoId, message: (error as Error).message });
      }
      throw error;
    }
  }

  isAlive(): boolean {
    return this.status === 'completed' || this.status === 'running';
  }

  pushUserMessage(runId: string, msgId: string, text: string): void {
    const message = {
      id: crypto.randomUUID(),
      msgId,
      type: 'text',
      role: 'user',
      content: { text },
      status: null,
      toolCallId: null,
      toolName: null,
      createdAt: new Date().toISOString(),
    };
    this.pushEvent('stream', {
      todoId: this.config.todoId,
      runId,
      message,
    });
  }

  confirm(requestId: string, optionId: string): void {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return;
    this.connection.respondToPermission(pending.resolve, optionId);
    this.pendingPermissions.delete(requestId);
    if (this.pendingPermissions.size === 0) {
      this.setStatus('running');
    }
  }

  getStatus(): TaskStatus {
    return this.status;
  }
  getSessionId(): string | null {
    return this.sessionId;
  }

  private setupConnectionHandlers(): void {
    this.connection.on('session:update', (_sessionId: string, update: SessionUpdate) => {
      this.handleStreamUpdate(update);
    });

    this.connection.on(
      'session:permission',
      (
        sym: symbol,
        _sessionId: string,
        request: RequestPermissionRequest,
        resolve: (r: RequestPermissionResponse) => void,
      ) => {
        const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.symbolToKey.set(sym, requestId);
        this.handlePermissionRequest(requestId, request, resolve);
      },
    );

    this.connection.on('session:finished', (_sessionId: string) => {
      this.setStatus('completed');
      this.pushEvent('status', { todoId: this.config.todoId, status: 'completed' });
    });

    this.connection.on('exit', (code: number | null, _signal: string | null) => {
      if (this.status === 'running' || this.status === 'waiting_permission') {
        this.setStatus('failed');
        this.pushEvent('error', {
          todoId: this.config.todoId,
          message: `Agent process exited unexpectedly (code: ${code})`,
        });
      }
    });

    this.connection.on('stderr', (text: string) => {
      // Filter known noisy codex-acp warnings that are harmless
      if (text.includes('No onPostToolUseHook found for tool use ID:')) return;
      this.pushEvent('stderr', {
        todoId: this.config.todoId,
        runId: this.config.runId,
        text,
      });
    });
  }

  private handleStreamUpdate(update: SessionUpdate): void {
    if (update.sessionUpdate === 'available_commands_update') {
      this.pushEvent('commands', {
        todoId: this.config.todoId,
        commands: update.availableCommands ?? [],
      });
      return;
    }

    if (
      update.sessionUpdate === 'agent_message_chunk' &&
      this.accumulatedText === '' &&
      update.content.type === 'text' &&
      update.content.text
    ) {
      this.currentMsgId = this.generateMsgId();
    }
    if (
      update.sessionUpdate === 'agent_message_chunk' &&
      update.content.type === 'text' &&
      update.content.text
    ) {
      this.accumulatedText += update.content.text;
    }

    const message = transformAcpUpdate(update, this.currentMsgId);
    if (!message) return;

    this.messages.push(message);
    this.pushEvent('stream', {
      todoId: this.config.todoId,
      runId: this.config.runId,
      message,
    });
  }

  private handlePermissionRequest(
    requestId: string,
    request: RequestPermissionRequest,
    resolve: (r: RequestPermissionResponse) => void,
  ): void {
    if (this.config.yoloMode && request.options.length > 0) {
      setTimeout(() => {
        this.connection.respondToPermission(resolve, request.options[0].optionId);
      }, 50);
      this.pushEvent('permission-auto-approved', {
        todoId: this.config.todoId,
        runId: this.config.runId,
        request,
        approvedOption: request.options[0],
      });
      return;
    }

    this.pendingPermissions.set(requestId, { request, resolve });
    this.setStatus('waiting_permission');
    this.pushEvent('permission-request', {
      todoId: this.config.todoId,
      runId: this.config.runId,
      requestId,
      request,
    });
  }

  private getYoloModeId(): string | null {
    return YOLO_MODE_IDS[this.config.backend as keyof typeof YOLO_MODE_IDS] || null;
  }

  private setStatus(status: TaskStatus): void {
    this.status = status;
    this.emit('status-change', status);
  }

  private pushEvent(event: string, data: unknown): void {
    this.emit(event, data);
    const channel = `agent-todo:${event}`;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, data);
    }
  }

  private generateMsgId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
