import { useEffect, useRef } from 'react';
import { TextMessage } from './TextMessage';
import { ThoughtBlock } from './ThoughtBlock';
import { ToolCallCard } from './ToolCallCard';
import { PlanCard } from './PlanCard';
import { PermissionCard } from './PermissionCard';

interface Message {
  id: string;
  msgId: string;
  type: string;
  role: string;
  content: unknown;
  status?: string | null;
  toolCallId?: string | null;
}

interface MessageStreamProps {
  messages: Message[];
  todoId: string;
  permissionRequest: {
    requestId: number;
    request: {
      options: Array<{ optionId: string; name: string; kind: string }>;
      toolCall: { title: string; kind: string; rawInput?: Record<string, unknown> };
    };
  } | null;
  onPermissionResolved: () => void;
}

export function MessageStream({
  messages,
  todoId,
  permissionRequest,
  onPermissionResolved,
}: MessageStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0 && !permissionRequest) {
    return (
      <div className="flex items-center justify-center py-16 text-notion-text-secondary text-sm">
        Waiting for agent output...
      </div>
    );
  }

  return (
    <div className="space-y-1 p-4">
      {messages.map((msg) => {
        const content = msg.content as Record<string, unknown>;
        switch (msg.type) {
          case 'text':
            return <TextMessage key={msg.id} content={content as { text: string }} />;
          case 'thought':
            return <ThoughtBlock key={msg.id} content={content as { text: string }} />;
          case 'tool_call':
            return (
              <ToolCallCard
                key={msg.msgId}
                content={content as any}
                status={msg.status ?? undefined}
              />
            );
          case 'plan':
            return <PlanCard key={msg.id} content={content as any} />;
          case 'system':
            return (
              <p key={msg.id} className="text-xs text-center text-notion-text-secondary py-1">
                {(content as { text: string }).text}
              </p>
            );
          case 'error':
            return (
              <div
                key={msg.id}
                className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
              >
                {(content as { text: string }).text}
              </div>
            );
          default:
            return null;
        }
      })}

      {permissionRequest && (
        <PermissionCard
          todoId={todoId}
          requestId={permissionRequest.requestId}
          request={permissionRequest.request}
          onResolved={onPermissionResolved}
        />
      )}

      <div ref={bottomRef} />
    </div>
  );
}
