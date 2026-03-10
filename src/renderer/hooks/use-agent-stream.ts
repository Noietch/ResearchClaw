import { useState, useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import { onIpc, ipc } from './use-ipc';

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
  const [canChat, setCanChat] = useState<boolean>(false);
  const [stderrLines, setStderrLines] = useState<string[]>([]);
  const [availableCommands, setAvailableCommands] = useState<SlashCommand[]>([]);

  // Internal ref updated synchronously during render.
  // If caller provides an externalTodoIdRef, use that instead so the caller
  // can update it synchronously before triggering runAgentTodo.
  const internalRef = useRef(todoId);
  internalRef.current = todoId;
  const todoIdRef = externalTodoIdRef ?? internalRef;

  // === Fix: Fully synchronous message accumulation ===
  // Use refs to track accumulated text synchronously without relying on React state updates.
  // Key insight: We must NEVER call setMessages callback to read state, because callbacks
  // are async and can execute out of order when multiple chunks arrive rapidly.
  const textAccumulatorRef = useRef<Map<string, string>>(new Map());
  const messageMetadataRef = useRef<Map<string, Message>>(new Map());
  const pendingFlushRef = useRef<boolean>(false);

  // === Fix: Race condition recovery ===
  // When navigating back to a page, we need to recover state from the backend.
  // But IPC events may arrive during recovery, causing text scrambling.
  // Solution: buffer events during recovery, process them after recovery completes.
  const isRecoveringRef = useRef<boolean>(false);
  const pendingEventsRef = useRef<Array<{ message: Message }>>([]);

  // Flush accumulated text to React state (batched via requestAnimationFrame)
  const flushToState = useCallback(() => {
    if (pendingFlushRef.current) return;
    pendingFlushRef.current = true;

    requestAnimationFrame(() => {
      pendingFlushRef.current = false;

      // Build updated messages from accumulators
      const textAcc = textAccumulatorRef.current;
      const metaAcc = messageMetadataRef.current;

      if (textAcc.size === 0) return;

      setMessages((prev) => {
        const updated = [...prev];
        let changed = false;

        for (const [msgId, text] of textAcc) {
          const idx = updated.findIndex((m) => m.msgId === msgId);
          if (idx >= 0) {
            // Update existing message
            updated[idx] = {
              ...updated[idx],
              content: { text },
            };
            changed = true;
          } else {
            // Add new message
            const meta = metaAcc.get(msgId);
            if (meta) {
              updated.push({
                ...meta,
                content: { text },
              });
              changed = true;
            }
          }
        }

        return changed ? updated : prev;
      });
    });
  }, []);

  // Process a stream event - handles text accumulation and other message types
  const processStreamEvent = useCallback(
    (message: Message) => {
      // Handle text/thought accumulation FULLY SYNCHRONOUSLY via refs
      if (message.type === 'text' || message.type === 'thought') {
        const newContent = message.content as { text: string };
        const msgId = message.msgId;

        // Synchronously append text to accumulator
        const existingText = textAccumulatorRef.current.get(msgId);
        if (existingText !== undefined) {
          // Already have this msgId - append synchronously
          textAccumulatorRef.current.set(msgId, existingText + newContent.text);
        } else {
          // First chunk for this msgId - store it
          textAccumulatorRef.current.set(msgId, newContent.text);
          messageMetadataRef.current.set(msgId, message);
        }

        flushToState();
        return;
      }

      // Handle tool_call with deep merge
      if (message.type === 'tool_call') {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.msgId === message.msgId);
          if (idx >= 0) {
            const updated = [...prev];
            const existing = updated[idx];
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
        return;
      }

      // Other message types: append directly
      setMessages((prev) => [...prev, message]);
    },
    [flushToState],
  );

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
      textAccumulatorRef.current = new Map();
      messageMetadataRef.current = new Map();
    }
  }, [todoId]);

  // Recovery: when mounting with a valid todoId, try to restore active state from backend
  // This handles the case where user navigates away and back while a task is running
  useEffect(() => {
    if (!todoId) return;

    let cancelled = false;

    // Start recovery - buffer IPC events until recovery completes
    isRecoveringRef.current = true;
    pendingEventsRef.current = [];

    ipc.getActiveAgentTodoStatus(todoId).then((result) => {
      if (cancelled) return;
      if (!result) {
        // No active runner - clear recovery state
        isRecoveringRef.current = false;
        return;
      }

      // Restore status
      setStatus(result.status);

      // Restore messages into accumulator refs AND state
      if (result.messages && result.messages.length > 0) {
        for (const msg of result.messages) {
          const msgId = msg.msgId;
          const content = msg.content as { text?: string };
          if ((msg.type === 'text' || msg.type === 'thought') && content.text) {
            // Populate accumulator ref with accumulated text
            textAccumulatorRef.current.set(msgId, content.text);
            messageMetadataRef.current.set(msgId, msg as Message);
          }
        }
        // Set initial messages state
        setMessages(result.messages as Message[]);
      }

      // If task is running, allow chat after recovery
      if (result.status === 'completed') {
        setCanChat(true);
      }

      // Recovery complete - process any buffered events
      isRecoveringRef.current = false;
      const pendingEvents = pendingEventsRef.current;
      pendingEventsRef.current = [];

      // Process buffered events AFTER recovery state is set
      for (const event of pendingEvents) {
        processStreamEvent(event.message);
      }
    });

    return () => {
      cancelled = true;
      isRecoveringRef.current = false;
      pendingEventsRef.current = [];
    };
  }, [todoId]);

  // Subscribe to IPC events once on mount. Use todoIdRef for filtering so the
  // subscription never needs to be torn down and re-created when todoId changes.
  useEffect(() => {
    const offStream = onIpc('agent-todo:stream', (_event: unknown, data: unknown) => {
      const { todoId: eventTodoId, message } = data as { todoId: string; message: Message };
      if (eventTodoId !== todoIdRef.current) return;

      // === Fix: Buffer events during recovery ===
      // If we're recovering state from the backend, buffer events to prevent race conditions
      if (isRecoveringRef.current) {
        pendingEventsRef.current.push({ message });
        return;
      }

      processStreamEvent(message);
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
  }, [processStreamEvent]); // eslint-disable-line react-hooks/exhaustive-deps

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
