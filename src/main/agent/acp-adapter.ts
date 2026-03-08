import { randomUUID } from 'node:crypto';
import { AcpSessionUpdate } from './acp-types';

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
  update: AcpSessionUpdate,
  currentMsgId: string,
): TodoMessage | null {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk':
      return {
        id: randomUUID(),
        msgId: currentMsgId,
        type: 'text',
        role: 'assistant',
        content: { text: update.content?.text || '' },
        createdAt: new Date().toISOString(),
      };

    case 'agent_thought_chunk':
      return {
        id: randomUUID(),
        msgId: `thought-${currentMsgId}`,
        type: 'thought',
        role: 'assistant',
        content: { text: update.content?.text || '' },
        createdAt: new Date().toISOString(),
      };

    case 'tool_call':
      return {
        id: randomUUID(),
        msgId: update.toolCallId || randomUUID(),
        type: 'tool_call',
        role: 'assistant',
        content: {
          title: update.title,
          kind: update.kind,
          rawInput: update.rawInput,
          locations: update.locations,
        },
        status: update.status || 'pending',
        toolCallId: update.toolCallId,
        toolName: update.kind,
        createdAt: new Date().toISOString(),
      };

    case 'tool_call_update':
      return {
        id: randomUUID(),
        msgId: update.toolCallId || randomUUID(),
        type: 'tool_call',
        role: 'assistant',
        content: {
          title: update.title,
          kind: update.kind,
          rawInput: update.rawInput,
          status: update.status,
        },
        status: update.status,
        toolCallId: update.toolCallId,
        toolName: update.kind,
        createdAt: new Date().toISOString(),
      };

    case 'plan':
      return {
        id: randomUUID(),
        msgId: `plan-${currentMsgId}`,
        type: 'plan',
        role: 'assistant',
        content: { entries: update.entries },
        createdAt: new Date().toISOString(),
      };

    default:
      return null;
  }
}
