import { useState, useEffect, useRef, useCallback } from 'react';
import { ipc } from './use-ipc';

interface Message {
  id: string;
  msgId: string;
  type: string;
  role: string;
  content: unknown;
  status?: string | null;
  toolCallId?: string | null;
  toolName?: string | null;
  createdAt?: string;
}

/**
 * Merge DB raw rows into a deduped message list.
 * - text: concatenate chunks with the same msgId
 * - tool_call: deep-merge fields, last non-empty status wins
 * - plan: keep last occurrence
 * - others: keep first occurrence
 * - IMPORTANT: Messages are already sorted by createdAt ASC from DB,
 *   we preserve this order by only updating in-place, never reordering.
 */
function mergeFromDb(rawMsgs: any[]): Message[] {
  const parsed = rawMsgs.map((m) => ({
    ...m,
    content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
  }));

  const result: Message[] = [];
  const seen = new Map<string, number>(); // msgId -> index in result

  for (const m of parsed) {
    const existing = seen.get(m.msgId);
    if (existing !== undefined) {
      if (m.type === 'text') {
        const prev = result[existing];
        const prevText = (prev.content as { text: string }).text ?? '';
        const newText = (m.content as { text: string }).text ?? '';
        // Keep original position, just update content
        result[existing] = { ...prev, content: { text: prevText + newText } };
      } else if (m.type === 'tool_call') {
        const prev = result[existing];
        const prevContent = prev.content as Record<string, unknown>;
        const newContent = m.content as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...prevContent };
        for (const [k, v] of Object.entries(newContent)) {
          if (v !== undefined && v !== null && v !== '') merged[k] = v;
        }
        result[existing] = {
          ...prev,
          status: m.status || prev.status,
          content: merged,
        };
      } else if (m.type === 'plan') {
        result[existing] = m;
      }
      // others: keep first occurrence at its original position
    } else {
      seen.set(m.msgId, result.length);
      result.push(m);
    }
  }

  return result;
}

/**
 * Merge incoming stream messages into a base list.
 * - Matches by msgId; updates existing or appends new.
 * - text: replace content (stream already accumulates upstream)
 * - tool_call: deep-merge
 * - others: replace
 * - NEW: Sort by createdAt to ensure chronological order
 */
function mergeStreamInto(base: Message[], incoming: Message[]): Message[] {
  const result = [...base];
  const idxMap = new Map<string, number>(result.map((m, i) => [m.msgId, i]));

  for (const msg of incoming) {
    const idx = idxMap.get(msg.msgId);
    if (idx !== undefined) {
      if (msg.type === 'tool_call') {
        const prev = result[idx];
        const prevContent = prev.content as Record<string, unknown>;
        const newContent = msg.content as Record<string, unknown>;
        const merged: Record<string, unknown> = { ...prevContent };
        for (const [k, v] of Object.entries(newContent)) {
          if (v !== undefined && v !== null && v !== '') merged[k] = v;
        }
        result[idx] = { ...prev, ...msg, content: merged };
      } else {
        // Update in place to preserve order
        result[idx] = msg;
      }
    } else {
      result.push(msg);
      idxMap.set(msg.msgId, result.length - 1);
    }
  }

  // Sort by createdAt to ensure chronological order
  // This fixes the issue where user messages appear at wrong positions
  result.sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aTime - bTime;
  });

  return result;
}

/**
 * Unified message list for a single run.
 *
 * Usage:
 *   const { messages, addOptimisticMessage } = useRunMessages(
 *     selectedRunId,
 *     streamMessages,   // from useAgentStream
 *     isViewingCurrentRun,
 *   );
 *
 * Mount this with key={selectedRunId} on the parent component so that
 * switching runs forces a fresh mount and automatic state reset.
 */
export function useRunMessages(
  runId: string | null,
  streamMessages: Message[],
  isCurrentRun: boolean,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  // Tracks optimistic user messages by their text content for dedup
  const optimisticTextsRef = useRef<Set<string>>(new Set());

  // Load history from DB whenever runId changes
  useEffect(() => {
    if (!runId) {
      setMessages([]);
      optimisticTextsRef.current = new Set();
      return;
    }

    // Immediately clear to avoid showing stale content from previous run
    setMessages([]);
    optimisticTextsRef.current = new Set();

    ipc
      .getAgentTodoRunMessages(runId)
      .then((msgs) => {
        setMessages(mergeFromDb(msgs));
      })
      .catch(console.error);
  }, [runId]);

  // Merge stream messages into the list (only for the current active run)
  useEffect(() => {
    if (!isCurrentRun || streamMessages.length === 0) return;

    setMessages((prev) => {
      const merged = mergeStreamInto(prev, streamMessages);

      // Remove optimistic user messages whose text now appears in the stream
      const streamUserTexts = new Set(
        streamMessages
          .filter((m) => m.role === 'user' && m.type === 'text')
          .map((m) => (m.content as { text: string }).text),
      );

      if (streamUserTexts.size === 0) return merged;

      return merged.filter((m) => {
        if (!m.msgId.startsWith('opt-')) return true;
        const text = (m.content as { text: string }).text;
        return !streamUserTexts.has(text);
      });
    });
  }, [streamMessages, isCurrentRun]);

  // Append an optimistic user message immediately after the user sends
  // The message will be replaced by the real one from the stream
  const addOptimisticMessage = useCallback((text: string) => {
    optimisticTextsRef.current.add(text);
    const ts = Date.now();
    const msg: Message = {
      id: `opt-${ts}`,
      msgId: `opt-${ts}`,
      type: 'text',
      role: 'user',
      content: { text },
      status: null,
      createdAt: new Date(ts).toISOString(),
    };
    // Use functional update to ensure we append to the latest state
    setMessages((prev) => {
      // Find the latest createdAt to ensure optimistic message is placed at the end
      const latestTime = prev.reduce((max, m) => {
        const t = m.createdAt ? new Date(m.createdAt).getTime() : 0;
        return Math.max(max, t);
      }, 0);
      // Use the later of current time or latest message time + 1ms
      const actualTime = Math.max(ts, latestTime + 1);
      msg.createdAt = new Date(actualTime).toISOString();
      return [...prev, msg];
    });
  }, []);

  // Remove an optimistic message by text content (used when send fails)
  const removeOptimisticMessage = useCallback((text: string) => {
    optimisticTextsRef.current.delete(text);
    setMessages((prev) =>
      prev.filter((m) => {
        if (!m.msgId.startsWith('opt-')) return true;
        const msgText = (m.content as { text: string }).text;
        return msgText !== text;
      }),
    );
  }, []);

  return { messages, addOptimisticMessage, removeOptimisticMessage };
}
