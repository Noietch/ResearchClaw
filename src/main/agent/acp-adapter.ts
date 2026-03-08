import { randomUUID } from 'node:crypto';
import type { SessionUpdate } from '@agentclientprotocol/sdk';

export interface TodoMessage {
  id: string;
  msgId: string;
  type: 'text' | 'tool_call' | 'thought' | 'plan' | 'permission' | 'system' | 'error';
  role: 'user' | 'assistant' | 'system';
  content: unknown;
  status?: string;
  toolCallId?: string;
  toolName?: string;
  createdAt: string;
}

export function transformAcpUpdate(
  update: SessionUpdate,
  currentMsgId: string,
): TodoMessage | null {
  if (update.sessionUpdate === 'agent_message_chunk') {
    const text = update.content.type === 'text' ? (update.content.text ?? '') : '';
    return {
      id: randomUUID(),
      msgId: currentMsgId,
      type: 'text',
      role: 'assistant',
      content: { text },
      createdAt: new Date().toISOString(),
    };
  }

  if (update.sessionUpdate === 'agent_thought_chunk') {
    const text = update.content.type === 'text' ? (update.content.text ?? '') : '';
    return {
      id: randomUUID(),
      msgId: `thought-${currentMsgId}`,
      type: 'thought',
      role: 'assistant',
      content: { text },
      createdAt: new Date().toISOString(),
    };
  }

  if (update.sessionUpdate === 'tool_call') {
    return {
      id: randomUUID(),
      msgId: update.toolCallId,
      type: 'tool_call',
      role: 'assistant',
      content: {
        title: update.title,
        kind: update.kind,
        rawInput: update.rawInput,
        locations: update.locations,
      },
      status: update.status ?? 'pending',
      toolCallId: update.toolCallId,
      toolName: update.kind ?? undefined,
      createdAt: new Date().toISOString(),
    };
  }

  if (update.sessionUpdate === 'tool_call_update') {
    return {
      id: randomUUID(),
      msgId: update.toolCallId,
      type: 'tool_call',
      role: 'assistant',
      content: {
        title: update.title,
        kind: update.kind,
        rawInput: update.rawInput,
        status: update.status,
      },
      status: update.status ?? undefined,
      toolCallId: update.toolCallId,
      toolName: update.kind ?? undefined,
      createdAt: new Date().toISOString(),
    };
  }

  if (update.sessionUpdate === 'plan') {
    return {
      id: randomUUID(),
      msgId: `plan-${currentMsgId}`,
      type: 'plan',
      role: 'assistant',
      content: { entries: update.entries },
      createdAt: new Date().toISOString(),
    };
  }

  return null;
}
