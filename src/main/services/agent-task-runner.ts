import { EventEmitter } from 'events';
import { BrowserWindow } from 'electron';
import { AcpConnection } from '../agent/acp-connection';
import { AcpSessionUpdate, AcpPermissionRequest } from '../agent/acp-types';
import { transformAcpUpdate, TodoMessage } from '../agent/acp-adapter';

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
}

export class AgentTaskRunner extends EventEmitter {
  private connection: AcpConnection;
  private config: TaskRunnerConfig;
  private status: TaskStatus = 'idle';
  private sessionId: string | null = null;
  private currentMsgId: string = '';
  private accumulatedText: string = '';
  private pendingPermissions: Map<number, AcpPermissionRequest> = new Map();
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
      this.pushEvent('status', {
        todoId: this.config.todoId,
        status: 'initializing',
        message: 'Starting agent...',
      });

      await this.connection.spawn(
        this.config.cliPath,
        this.config.acpArgs,
        this.config.cwd,
        this.config.extraEnv,
      );

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
      this.setStatus('failed');
      this.pushEvent('error', { todoId: this.config.todoId, message: (error as Error).message });
      throw error;
    }
  }

  stop(): void {
    this.connection.kill();
    this.setStatus('cancelled');
    this.pushEvent('status', {
      todoId: this.config.todoId,
      status: 'cancelled',
      message: 'Task cancelled by user',
    });
  }

  confirm(requestId: number, optionId: string): void {
    this.connection.respondToPermission(requestId, optionId);
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
    this.connection.on('session:update', (_sessionId: string, update: AcpSessionUpdate) => {
      this.handleStreamUpdate(update);
    });

    this.connection.on(
      'session:permission',
      (requestId: number, _sessionId: string, request: AcpPermissionRequest) => {
        this.handlePermissionRequest(requestId, request);
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
  }

  private handleStreamUpdate(update: AcpSessionUpdate): void {
    if (
      update.sessionUpdate === 'agent_message_chunk' &&
      this.accumulatedText === '' &&
      update.content?.text
    ) {
      this.currentMsgId = this.generateMsgId();
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.text) {
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

  private handlePermissionRequest(requestId: number, request: AcpPermissionRequest): void {
    if (this.config.yoloMode && request.options.length > 0) {
      setTimeout(() => {
        this.connection.respondToPermission(requestId, request.options[0].optionId);
      }, 50);
      this.pushEvent('permission-auto-approved', {
        todoId: this.config.todoId,
        runId: this.config.runId,
        request,
        approvedOption: request.options[0],
      });
      return;
    }

    this.pendingPermissions.set(requestId, request);
    this.setStatus('waiting_permission');
    this.pushEvent('permission-request', {
      todoId: this.config.todoId,
      runId: this.config.runId,
      requestId,
      request,
    });
  }

  private getYoloModeId(): string | null {
    switch (this.config.backend) {
      case 'claude':
        return 'bypassPermissions';
      case 'codex':
        return null;
      case 'gemini':
        return 'yolo';
      default:
        return null;
    }
  }

  private setStatus(status: TaskStatus): void {
    this.status = status;
    this.emit('status-change', status);
  }

  private pushEvent(event: string, data: unknown): void {
    const channel = `agent-todo:${event}`;
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, data);
    }
  }

  private generateMsgId(): string {
    return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
