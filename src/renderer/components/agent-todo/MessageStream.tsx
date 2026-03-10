import { useEffect, useRef, useMemo, memo } from 'react';
import { Loader2 } from 'lucide-react';
import { TextMessage } from './TextMessage';
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
  status?: string;
  permissionRequest: {
    requestId: number;
    request: {
      options: Array<{ optionId: string; name: string; kind: string }>;
      toolCall: { title: string; kind: string; rawInput?: Record<string, unknown> };
    };
  } | null;
  onPermissionResolved: () => void;
}

interface MessageGroup {
  role: 'user' | 'assistant' | 'system';
  messages: Message[];
}

function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];

  for (const msg of messages) {
    if (msg.type === 'system' || msg.type === 'error') {
      groups.push({ role: 'system', messages: [msg] });
      continue;
    }

    const role = msg.role === 'user' ? 'user' : 'assistant';
    const last = groups[groups.length - 1];

    if (last && last.role === role) {
      last.messages.push(msg);
    } else {
      groups.push({ role, messages: [msg] });
    }
  }

  return groups;
}

const MessageGroupView = memo(function MessageGroupView({
  group,
  lastTextMsgId,
  isStreaming,
}: {
  group: MessageGroup;
  lastTextMsgId: string | null;
  isStreaming: boolean;
}) {
  if (group.role === 'system') {
    const msg = group.messages[0];
    const content = msg.content as { text: string };
    if (msg.type === 'error') {
      return (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 my-2">
          {content.text}
        </div>
      );
    }
    return (
      <p className="text-xs text-center text-notion-text-tertiary py-1 my-1">{content.text}</p>
    );
  }

  if (group.role === 'user') {
    return (
      <div className="flex justify-end my-4">
        <div className="bg-[#f0f0ef] rounded-2xl px-4 py-2.5 max-w-[80%]">
          {group.messages.map((msg) => {
            const content = msg.content as { text: string };
            return (
              <p key={msg.id} className="text-sm text-notion-text leading-relaxed m-0">
                {content.text}
              </p>
            );
          })}
        </div>
      </div>
    );
  }

  // assistant group
  // Sort messages: tool_calls first (by creation order), then text messages
  const sortedMessages = [...group.messages].sort((a, b) => {
    // tool_calls should come before text
    const typeOrder = (t: string) => {
      if (t === 'tool_call') return 0;
      if (t === 'thought') return 1;
      if (t === 'plan') return 2;
      if (t === 'text') return 3;
      return 4;
    };
    return typeOrder(a.type) - typeOrder(b.type);
  });

  const mergedElements: React.ReactNode[] = [];
  let consecutiveToolCalls: {
    id: string;
    msgId: string;
    content: Record<string, unknown>;
    status?: string | null;
  }[] = [];

  // Track if this group has any thought messages (to show spinner while streaming)
  let hasThoughts = false;

  function flushToolCalls() {
    if (consecutiveToolCalls.length > 0) {
      const calls = consecutiveToolCalls;
      consecutiveToolCalls = [];
      return (
        <div key={calls[0].id} className="my-1 space-y-0.5">
          {calls.map((tc) => (
            <ToolCallCard
              key={tc.msgId}
              content={tc.content as any}
              status={tc.status ?? undefined}
            />
          ))}
        </div>
      );
    }
    return null;
  }

  for (const msg of sortedMessages) {
    const content = msg.content as Record<string, unknown>;

    if (msg.type === 'thought') {
      // Flush pending tool calls, then skip thought content
      const toolsEl = flushToolCalls();
      if (toolsEl) mergedElements.push(toolsEl);
      hasThoughts = true;
    } else if (msg.type === 'tool_call') {
      consecutiveToolCalls.push({ id: msg.id, msgId: msg.msgId, content, status: msg.status });
    } else {
      const toolsEl = flushToolCalls();
      if (toolsEl) mergedElements.push(toolsEl);

      switch (msg.type) {
        case 'text':
          mergedElements.push(
            <TextMessage
              key={msg.id}
              content={content as { text: string }}
              streaming={msg.msgId === lastTextMsgId}
            />,
          );
          break;
        case 'plan':
          mergedElements.push(<PlanCard key={msg.id} content={content as any} />);
          break;
      }
    }
  }
  const remainingTools = flushToolCalls();
  if (remainingTools) mergedElements.push(remainingTools);

  // Show spinner after tool calls / thoughts only while streaming and no text yet
  const hasText = sortedMessages.some((m) => m.type === 'text');
  const showSpinner = isStreaming && (hasThoughts || consecutiveToolCalls.length > 0) && !hasText;

  return (
    <div className="my-4">
      {mergedElements}
      {showSpinner && <Loader2 size={14} className="animate-spin text-notion-text-tertiary mt-1" />}
    </div>
  );
});

export function MessageStream({
  messages,
  todoId,
  status,
  permissionRequest,
  onPermissionResolved,
}: MessageStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const isStreaming = status === 'running' || status === 'initializing';
  const userScrolledUpRef = useRef(false);

  const lastTextMsgId = isStreaming
    ? ([...messages].reverse().find((m) => m.type === 'text' && m.role === 'assistant')?.msgId ??
      null)
    : null;

  // Detect scroll container (the overflow-y-auto parent) on mount
  useEffect(() => {
    const el = bottomRef.current?.parentElement;
    if (!el) return;
    scrollContainerRef.current = el;

    const onScroll = () => {
      if (!scrollContainerRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
      // Consider "scrolled up" if more than 100px from bottom
      userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 100;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!bottomRef.current) return;
    // Don't auto-scroll if user has scrolled up to read history
    if (userScrolledUpRef.current) return;
    if (isStreaming) {
      // During streaming, use instant scroll to avoid jank from repeated smooth animations
      bottomRef.current.scrollIntoView({ behavior: 'instant' });
    } else {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isStreaming]);

  const hasTextOutput = useMemo(
    () => messages.some((m) => m.type === 'text' && m.role === 'assistant'),
    [messages],
  );
  const showThinking = isStreaming && !hasTextOutput && !permissionRequest;

  if (messages.length === 0 && !permissionRequest && !showThinking) {
    const isEmpty = status === 'idle' || !status;
    const isFailed = status === 'failed' || status === 'cancelled';
    return (
      <div className="flex items-center justify-center py-16 text-sm">
        {isFailed ? (
          <span className="text-notion-red">Run failed — no output recorded.</span>
        ) : isEmpty ? (
          <span className="text-notion-text-tertiary">No output yet. Press Run to start.</span>
        ) : (
          <span className="text-notion-text-secondary">Waiting for agent output...</span>
        )}
      </div>
    );
  }

  const groups = useMemo(() => groupMessages(messages), [messages]);

  return (
    <div className="px-5 py-4">
      {groups.map((group, i) => (
        <MessageGroupView
          key={i}
          group={group}
          lastTextMsgId={lastTextMsgId}
          isStreaming={isStreaming}
        />
      ))}

      {showThinking && (
        <div className="my-3">
          <Loader2 size={14} className="animate-spin text-notion-text-tertiary" />
        </div>
      )}

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
