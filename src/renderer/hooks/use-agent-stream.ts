import { useState, useEffect } from 'react';
import { onIpc } from './use-ipc';

interface Message {
  id: string;
  msgId: string;
  type: string;
  role: string;
  content: unknown;
  status?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  createdAt: string;
}

interface PermissionRequest {
  requestId: number;
  request: {
    options: Array<{ optionId: string; name: string; kind: string }>;
    toolCall: {
      toolCallId: string;
      title: string;
      kind: string;
      rawInput?: Record<string, unknown>;
    };
  };
}

export interface SlashCommand {
  name: string;
  description: string;
  input?: { hint?: string } | null;
}

export function useAgentStream(todoId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string>('idle');
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [canChat, setCanChat] = useState(false);
  const [stderrLines, setStderrLines] = useState<string[]>([]);
  const [availableCommands, setAvailableCommands] = useState<SlashCommand[]>([]);

  useEffect(() => {
    // Reset on todoId change
    setMessages([]);
    setStatus('idle');
    setPermissionRequest(null);
    setCanChat(false);
    setStderrLines([]);
    setAvailableCommands([]);

    const offStream = onIpc('agent-todo:stream', (_event: unknown, data: unknown) => {
      const { todoId: eventTodoId, message } = data as { todoId: string; message: Message };
      if (eventTodoId !== todoId) return;

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.msgId === message.msgId);
        if (idx >= 0 && (message.type === 'text' || message.type === 'thought')) {
          // Accumulate text for both 'text' and 'thought' message types
          const updated = [...prev];
          const existing = updated[idx];
          const existingContent = existing.content as { text: string };
          const newContent = message.content as { text: string };
          updated[idx] = {
            ...existing,
            content: { text: existingContent.text + newContent.text },
          };
          return updated;
        } else if (idx >= 0 && message.type === 'tool_call') {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], ...message };
          return updated;
        }
        return [...prev, message];
      });
    });

    const offStatus = onIpc('agent-todo:status', (_event: unknown, data: unknown) => {
      const { todoId: eventTodoId, status: newStatus } = data as { todoId: string; status: string };
      if (eventTodoId !== todoId) return;
      setStatus(newStatus);
      if (newStatus === 'completed') setCanChat(true);
      else if (newStatus === 'running' || newStatus === 'initializing') setCanChat(false);
      else if (newStatus === 'failed' || newStatus === 'cancelled') setCanChat(false);
    });

    const offPermission = onIpc(
      'agent-todo:permission-request',
      (_event: unknown, data: unknown) => {
        const {
          todoId: eventTodoId,
          requestId,
          request,
        } = data as { todoId: string; requestId: number; request: PermissionRequest['request'] };
        if (eventTodoId !== todoId) return;
        setPermissionRequest({ requestId, request });
      },
    );

    const offAutoApproved = onIpc(
      'agent-todo:permission-auto-approved',
      (_event: unknown, data: unknown) => {
        const { todoId: eventTodoId, request } = data as {
          todoId: string;
          request: { toolCall: { title: string } };
        };
        if (eventTodoId !== todoId) return;
        const autoMsg: Message = {
          id: crypto.randomUUID(),
          msgId: `auto-${Date.now()}`,
          type: 'system',
          role: 'system',
          content: { text: `Auto-approved: ${request.toolCall.title}` },
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, autoMsg]);
      },
    );

    const offStderr = onIpc('agent-todo:stderr', (_event: unknown, data: unknown) => {
      const { todoId: eventTodoId, text } = data as { todoId: string; text: string };
      if (eventTodoId !== todoId) return;
      setStderrLines((prev) => [...prev.slice(-99), text]);
    });

    const offCommands = onIpc('agent-todo:commands', (_event: unknown, data: unknown) => {
      const { todoId: eventTodoId, commands } = data as {
        todoId: string;
        commands: SlashCommand[];
      };
      if (eventTodoId !== todoId) return;
      setAvailableCommands(commands);
    });

    return () => {
      offStream();
      offStatus();
      offPermission();
      offAutoApproved();
      offStderr();
      offCommands();
    };
  }, [todoId]);

  return {
    messages,
    status,
    permissionRequest,
    setPermissionRequest,
    canChat,
    stderrLines,
    availableCommands,
  };
}
