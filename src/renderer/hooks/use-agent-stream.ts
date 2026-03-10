import { useState, useEffect, useRef, type MutableRefObject } from 'react';
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

/**
 * Subscribe to agent stream events for a given todoId.
 *
 * Also accepts an optional external ref (`todoIdRef`) that is updated
 * synchronously by the caller (e.g. in handleChatSend) before runAgentTodo
 * is called. This prevents the race where stream events arrive before React
 * re-renders with the new todoId.
 */
export function useAgentStream(todoId: string, externalTodoIdRef?: MutableRefObject<string>) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<string>('idle');
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [canChat, setCanChat] = useState(false);
  const [stderrLines, setStderrLines] = useState<string[]>([]);
  const [availableCommands, setAvailableCommands] = useState<SlashCommand[]>([]);

  // Internal ref updated synchronously during render.
  // If caller provides an externalTodoIdRef, use that instead so the caller
  // can update it synchronously before triggering runAgentTodo.
  const internalRef = useRef(todoId);
  internalRef.current = todoId;
  const todoIdRef = externalTodoIdRef ?? internalRef;

  // Track previous todoId to reset state only when switching between valid IDs
  const prevTodoIdRef = useRef('');
  useEffect(() => {
    const prev = prevTodoIdRef.current;
    prevTodoIdRef.current = todoId;
    // Only reset when switching between two valid todo IDs.
    // Do NOT reset when todoId transitions from '' to a real id, because messages
    // may have already arrived via externalTodoIdRef before React re-rendered.
    if (prev && todoId && prev !== todoId) {
      setMessages([]);
      setStatus('idle');
      setPermissionRequest(null);
      setCanChat(false);
      setStderrLines([]);
      setAvailableCommands([]);
    }
  }, [todoId]);

  // Subscribe to IPC events once on mount. Use todoIdRef for filtering so the
  // subscription never needs to be torn down and re-created when todoId changes.
  useEffect(() => {
    const offStream = onIpc('agent-todo:stream', (_event: unknown, data: unknown) => {
      const { todoId: eventTodoId, message } = data as { todoId: string; message: Message };
      if (eventTodoId !== todoIdRef.current) return;

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
          const existing = updated[idx];
          // Deep-merge content so that rawInput/locations from the initial tool_call
          // are not overwritten by undefined values in tool_call_update
          const existingContent = existing.content as Record<string, unknown>;
          const newContent = message.content as Record<string, unknown>;
          const mergedContent: Record<string, unknown> = { ...existingContent };
          for (const [k, v] of Object.entries(newContent)) {
            if (v !== undefined && v !== null && v !== '') mergedContent[k] = v;
          }
          updated[idx] = { ...existing, ...message, content: mergedContent };
          return updated;
        }
        return [...prev, message];
      });
    });

    const offStatus = onIpc('agent-todo:status', (_event: unknown, data: unknown) => {
      const { todoId: eventTodoId, status: newStatus } = data as { todoId: string; status: string };
      if (eventTodoId !== todoIdRef.current) return;
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
        if (eventTodoId !== todoIdRef.current) return;
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
        if (eventTodoId !== todoIdRef.current) return;
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
      if (eventTodoId !== todoIdRef.current) return;
      setStderrLines((prev) => [...prev.slice(-99), text]);
    });

    const offCommands = onIpc('agent-todo:commands', (_event: unknown, data: unknown) => {
      const { todoId: eventTodoId, commands } = data as {
        todoId: string;
        commands: SlashCommand[];
      };
      if (eventTodoId !== todoIdRef.current) return;
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
