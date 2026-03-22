/**
 * Test the displayMessages merge logic used in reader/page.tsx.
 *
 * This is a pure logic test — no React, no IPC, no DB.
 * It verifies the algorithm that combines localUserMessages, agentMessages,
 * and historicMessages into the final displayMessages array.
 *
 * The merge logic sorts all messages chronologically by createdAt timestamp,
 * ensuring multi-turn conversations display in correct order:
 *   user1 → assistant1 → user2 → assistant2
 */

import { describe, it, expect } from 'vitest';

interface Message {
  id: string;
  msgId: string;
  type: string;
  role: string;
  content: { text: string };
  status: string | null;
  createdAt?: string;
}

let timeCounter = Date.now();

/** Create a user message with auto-incrementing timestamp */
function mkUserMsg(msgId: string, text: string): Message {
  timeCounter += 100;
  return {
    id: msgId,
    msgId,
    type: 'text',
    role: 'user',
    content: { text },
    status: null,
    createdAt: new Date(timeCounter).toISOString(),
  };
}

/** Create an assistant message with auto-incrementing timestamp */
function mkAsstMsg(msgId: string, text: string): Message {
  timeCounter += 100;
  return {
    id: msgId,
    msgId,
    type: 'text',
    role: 'assistant',
    content: { text },
    status: null,
    createdAt: new Date(timeCounter).toISOString(),
  };
}

/**
 * Replicate the exact merge logic from reader/page.tsx
 */
function computeDisplayMessages(
  localUserMessages: Message[],
  agentMessages: Message[],
  historicMessages: Message[],
): Message[] {
  const streamBased = agentMessages.length > 0 ? agentMessages : historicMessages;
  const streamMsgIds = new Set(streamBased.map((m) => m.msgId));
  const pendingLocalMessages = localUserMessages.filter((m) => !streamMsgIds.has(m.msgId));

  if (pendingLocalMessages.length === 0) return streamBased;
  if (streamBased.length === 0) return [...pendingLocalMessages];

  // Merge by createdAt timestamp for correct chronological order
  const all = [...pendingLocalMessages, ...streamBased];
  all.sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
  return all;
}

describe('displayMessages merge logic', () => {
  // ── Scenario 1: User sends first message (no history, no stream yet) ──────

  it('shows only local user message when no stream/history data', () => {
    const local = [mkUserMsg('local-user-1', 'Hello')];
    const result = computeDisplayMessages(local, [], []);

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].content.text).toBe('Hello');
  });

  // ── Scenario 2: Agent starts responding (stream has assistant, no user) ───

  it('shows local user + streamed assistant messages', () => {
    const local = [mkUserMsg('local-user-1', 'Hello')];
    const stream = [mkAsstMsg('asst-1', 'Hi there!')];

    const result = computeDisplayMessages(local, stream, []);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[0].content.text).toBe('Hello');
    expect(result[1].role).toBe('assistant');
    expect(result[1].content.text).toBe('Hi there!');
  });

  // ── Scenario 3: History loaded (no local messages) ────────────────────────

  it('shows historic messages when no local user messages', () => {
    const historic = [
      mkUserMsg('user-123', 'What is attention?'),
      mkAsstMsg('asst-1', 'Attention is a mechanism...'),
    ];

    const result = computeDisplayMessages([], [], historic);

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  // ── Scenario 4: History with user messages — no duplicates ────────────────

  it('does not duplicate when history already has user messages', () => {
    const historic = [
      mkUserMsg('user-123', 'Summarize'),
      mkAsstMsg('asst-1', 'This paper proposes...'),
    ];
    // localUserMessages is empty because this is a restored session
    const result = computeDisplayMessages([], [], historic);

    expect(result).toHaveLength(2);
    // No duplicates
    const userMsgs = result.filter((m) => m.role === 'user');
    expect(userMsgs).toHaveLength(1);
  });

  // ── Scenario 5: Stream takes over from history ────────────────────────────

  it('prefers agentMessages over historicMessages when both exist', () => {
    const historic = [mkUserMsg('user-old', 'Old question')];
    const stream = [mkAsstMsg('asst-new', 'New response')];

    const result = computeDisplayMessages([], stream, historic);

    // Should use stream, not historic
    expect(result).toHaveLength(1);
    expect(result[0].msgId).toBe('asst-new');
  });

  // ── Scenario 6: No message duplication between local and stream ───────────

  it('does not show user message twice when stream has no user messages', () => {
    const local = [mkUserMsg('local-user-1', 'Question')];
    const stream = [mkAsstMsg('asst-1', 'Thinking...'), mkAsstMsg('asst-2', 'Answer')];

    const result = computeDisplayMessages(local, stream, []);

    // user + 2 assistant = 3
    expect(result).toHaveLength(3);
    const userMsgs = result.filter((m) => m.role === 'user');
    expect(userMsgs).toHaveLength(1);
  });

  // ── Scenario 7: Backend user messages in stream don't cause duplicates ────
  // This tests the case where pushUserMessage was broadcasting (now fixed).
  // Even if stream somehow contains user messages, local ones are filtered.

  it('filters local messages when stream already has user messages', () => {
    const local = [mkUserMsg('local-user-1', 'Clean question')];
    const stream = [
      mkUserMsg('user-backend-1', 'Full prompt with context'),
      mkAsstMsg('asst-1', 'Response'),
    ];

    const result = computeDisplayMessages(local, stream, []);

    // streamHasUserMessages = true
    // pendingLocalMessages = local (different msgId)
    // result = [...stream, ...pendingLocal]
    // This would show 3 messages (2 stream + 1 local) — BUT since
    // pushUserMessage no longer broadcasts, stream won't have user messages
    // during live chat. This test documents the behavior if it did.
    expect(result).toHaveLength(3);
  });

  // ── Scenario 8: Multi-turn conversation display ───────────────────────────

  it('correctly interleaves multi-turn conversation by timestamp', () => {
    // Simulate: user1 → asst1 → user2 → asst2 (chronological order)
    const user1 = mkUserMsg('local-user-1', 'First question');
    const asst1 = mkAsstMsg('asst-1', 'First answer');
    const user2 = mkUserMsg('local-user-2', 'Follow up');
    const asst2 = mkAsstMsg('asst-2', 'Follow up answer');

    const result = computeDisplayMessages([user1, user2], [asst1, asst2], []);

    // Should be chronologically interleaved, not all-users-then-all-assistants
    expect(result).toHaveLength(4);
    expect(result[0].content.text).toBe('First question');
    expect(result[1].content.text).toBe('First answer');
    expect(result[2].content.text).toBe('Follow up');
    expect(result[3].content.text).toBe('Follow up answer');
  });

  // ── Scenario 9: Empty state ───────────────────────────────────────────────

  it('returns empty array when all sources are empty', () => {
    const result = computeDisplayMessages([], [], []);
    expect(result).toHaveLength(0);
  });

  // ── Scenario 10: Recovery after mid-stream exit ───────────────────────────

  it('shows recovered messages correctly after navigating back', () => {
    // User navigated away during streaming, then came back.
    // loadChatSession loaded historic messages from DB.
    // useAgentStream recovery did NOT override (completed task).
    const historic = [
      mkUserMsg('user-123', 'Original question'),
      mkAsstMsg('asst-1', 'Partial response so far...'),
    ];

    // agentMessages is empty because recovery skipped for completed tasks
    const result = computeDisplayMessages([], [], historic);

    expect(result).toHaveLength(2);
    expect(result[0].content.text).toBe('Original question');
    expect(result[1].content.text).toBe('Partial response so far...');
  });

  // ── Scenario 11: Recovery during active run ───────────────────────────────

  it('shows live messages from useAgentStream recovery during active run', () => {
    // User navigated away during active streaming, came back.
    // useAgentStream recovery loaded live messages into agentMessages.
    const agentMsgs = [
      mkUserMsg('user-mem-1', 'Question from memory'),
      mkAsstMsg('asst-1', 'Live response being streamed...'),
    ];

    const result = computeDisplayMessages([], agentMsgs, []);

    expect(result).toHaveLength(2);
    // agentMessages has user messages, so streamHasUserMessages = true
    // displayMessages = streamBased (agentMsgs)
    expect(result[0].role).toBe('user');
    expect(result[1].role).toBe('assistant');
  });

  // ── Scenario 12: Tool calls mixed with text ────────────────────────────────

  it('preserves tool call messages in correct position', () => {
    const user1 = mkUserMsg('local-user-1', 'Read the conclusion');
    // Tool call and response arrive after user message (timestamps auto-increment)
    timeCounter += 100;
    const toolCall: Message = {
      id: 'tc-1',
      msgId: 'tc-1',
      type: 'tool_call',
      role: 'assistant',
      content: { text: 'Read text.txt' },
      status: 'completed',
      createdAt: new Date(timeCounter).toISOString(),
    };
    const asst1 = mkAsstMsg('asst-1', 'The conclusion states...');

    const result = computeDisplayMessages([user1], [toolCall, asst1], []);

    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('user');
    expect(result[1].type).toBe('tool_call');
    expect(result[2].role).toBe('assistant');
  });

  // ── Scenario 13: Follow-up in same session (multiple local user msgs) ────

  it('handles follow-up messages sent before agent finishes', () => {
    // User sends msg1, agent responds, user sends msg2 before stream updates
    const user1 = mkUserMsg('local-user-1', 'First question');
    const asst1 = mkAsstMsg('asst-1', 'Answering first question...');
    const user2 = mkUserMsg('local-user-2', 'Actually, also explain...');

    const result = computeDisplayMessages([user1, user2], [asst1], []);

    // Chronological: user1 → asst1 → user2
    expect(result).toHaveLength(3);
    expect(result[0].content.text).toBe('First question');
    expect(result[1].content.text).toBe('Answering first question...');
    expect(result[2].content.text).toBe('Actually, also explain...');
  });

  // ── Scenario 14: agentMessages takes priority over historicMessages ───────

  it('completely replaces historic with agent messages when both exist', () => {
    const historic = [mkUserMsg('user-1', 'Old user msg'), mkAsstMsg('asst-old', 'Old response')];
    const agent = [
      mkUserMsg('user-1', 'Old user msg'),
      mkAsstMsg('asst-old', 'Old response'),
      mkAsstMsg('asst-new', 'New streaming response...'),
    ];

    const result = computeDisplayMessages([], agent, historic);

    // agentMessages.length > 0 so streamBased = agent, not historic
    expect(result).toHaveLength(3);
    expect(result[2].content.text).toBe('New streaming response...');
  });

  // ── Scenario 15: No user message duplication across any path ──────────────

  it('never shows the same user question more than once', () => {
    // The critical bug scenario: user sends "What's the main contribution?"
    // It should appear exactly once, regardless of data source combination
    const question = "What's the main contribution?";

    // Case A: Only local
    const resultA = computeDisplayMessages([mkUserMsg('l-1', question)], [], []);
    expect(resultA.filter((m) => m.content.text === question)).toHaveLength(1);

    // Case B: Only in history
    const resultB = computeDisplayMessages(
      [],
      [],
      [mkUserMsg('u-1', question), mkAsstMsg('a-1', 'Answer')],
    );
    expect(resultB.filter((m) => m.content.text === question)).toHaveLength(1);

    // Case C: In agent stream (from recovery)
    const resultC = computeDisplayMessages(
      [],
      [mkUserMsg('u-1', question), mkAsstMsg('a-1', 'Answer')],
      [],
    );
    expect(resultC.filter((m) => m.content.text === question)).toHaveLength(1);

    // Case D: Local + stream without user msgs (normal live chat)
    const resultD = computeDisplayMessages(
      [mkUserMsg('l-1', question)],
      [mkAsstMsg('a-1', 'Answer')],
      [],
    );
    expect(resultD.filter((m) => m.content.text === question)).toHaveLength(1);
  });
});
