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

export function useAgentStream(todoId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string>('idle');
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);

  useEffect(() => {
    // Reset on todoId change
    setMessages([]);
    setStatus('idle');
    setPermissionRequest(null);

    const offStream = onIpc('agent-todo:stream', (data: unknown) => {
      const { todoId: eventTodoId, message } = data as { todoId: string; message: Message };
      if (eventTodoId !== todoId) return;

      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.msgId === message.msgId);
        if (idx >= 0 && message.type === 'text') {
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

    const offStatus = onIpc('agent-todo:status', (data: unknown) => {
      const { todoId: eventTodoId, status: newStatus } = data as { todoId: string; status: string };
      if (eventTodoId !== todoId) return;
      setStatus(newStatus);
    });

    const offPermission = onIpc('agent-todo:permission-request', (data: unknown) => {
      const {
        todoId: eventTodoId,
        requestId,
        request,
      } = data as { todoId: string; requestId: number; request: PermissionRequest['request'] };
      if (eventTodoId !== todoId) return;
      setPermissionRequest({ requestId, request });
    });

    const offAutoApproved = onIpc('agent-todo:permission-auto-approved', (data: unknown) => {
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
    });

    return () => {
      offStream();
      offStatus();
      offPermission();
      offAutoApproved();
    };
  }, [todoId]);

  return { messages, status, permissionRequest, setPermissionRequest };
}
