/**
 * Test message ordering and deduplication in agent todo chat
 *
 * This test ensures that:
 * 1. Messages are stored in correct chronological order
 * 2. Text chunks are properly accumulated (not duplicated)
 * 3. User and assistant messages are properly interleaved
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { AgentTodoRepository } from '../../src/db/repositories/agent-todo.repository';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';

describe('Message ordering and deduplication', () => {
  ensureTestDatabaseSchema();

  const repository = new AgentTodoRepository();

  let testTodoId: string;
  let testRunId: string;

  beforeEach(async () => {
    // Reset test database
    await resetTestDatabase();

    // Create test agent config
    const agent = await repository.createAgentConfig({
      name: 'Test Agent',
      backend: 'test-backend',
      enabled: true,
    });

    // Create test todo
    const todo = await repository.createTodo({
      title: 'Test Todo',
      prompt: 'Test prompt',
      cwd: '/tmp',
      agentId: agent.id,
    });
    testTodoId = todo.id;

    // Create test run
    const run = await repository.createRun({
      todoId: testTodoId,
      status: 'running',
      trigger: 'manual',
    });
    testRunId = run.id;
  });

  it('should accumulate text chunks with the same msgId', async () => {
    const msgId = 'msg-1';

    // Simulate streaming text chunks
    await repository.upsertMessage({
      runId: testRunId,
      msgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: 'Hello' }),
    });

    await repository.upsertMessage({
      runId: testRunId,
      msgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: ' world' }),
    });

    await repository.upsertMessage({
      runId: testRunId,
      msgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: '!' }),
    });

    // Fetch messages
    const messages = await repository.findMessagesByRunId(testRunId);

    // Should have only one message with accumulated content
    expect(messages).toHaveLength(1);
    expect(messages[0].msgId).toBe(msgId);
    const content = JSON.parse(messages[0].content);
    expect(content.text).toBe('Hello world!');
  });

  it('should maintain chronological order of messages', async () => {
    const now = Date.now();

    // Create messages in order: user -> assistant -> user -> assistant
    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-1',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: 'First user message' }),
    });

    // Wait 10ms to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));

    await repository.createMessage({
      runId: testRunId,
      msgId: 'asst-1',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: 'First assistant message' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-2',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: 'Second user message' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    await repository.createMessage({
      runId: testRunId,
      msgId: 'asst-2',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: 'Second assistant message' }),
    });

    // Fetch messages
    const messages = await repository.findMessagesByRunId(testRunId);

    // Should have 4 messages in chronological order
    expect(messages).toHaveLength(4);
    expect(messages[0].msgId).toBe('user-1');
    expect(messages[1].msgId).toBe('asst-1');
    expect(messages[2].msgId).toBe('user-2');
    expect(messages[3].msgId).toBe('asst-2');

    // Verify timestamps are in ascending order
    for (let i = 1; i < messages.length; i++) {
      const prevTime = new Date(messages[i - 1].createdAt).getTime();
      const currTime = new Date(messages[i].createdAt).getTime();
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }
  });

  it('should properly interleave user and assistant messages with text chunks', async () => {
    // User sends message
    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-1',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: 'What is 2+2?' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Assistant responds with streaming text
    const asstMsgId = 'asst-1';
    await repository.upsertMessage({
      runId: testRunId,
      msgId: asstMsgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: 'The answer' }),
    });

    await repository.upsertMessage({
      runId: testRunId,
      msgId: asstMsgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: ' is' }),
    });

    await repository.upsertMessage({
      runId: testRunId,
      msgId: asstMsgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: ' 4' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // User sends follow-up
    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-2',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: 'Thanks!' }),
    });

    // Fetch messages
    const messages = await repository.findMessagesByRunId(testRunId);

    // Should have 3 messages: user -> assistant (accumulated) -> user
    expect(messages).toHaveLength(3);
    expect(messages[0].msgId).toBe('user-1');
    expect(messages[0].role).toBe('user');

    expect(messages[1].msgId).toBe(asstMsgId);
    expect(messages[1].role).toBe('assistant');
    const asstContent = JSON.parse(messages[1].content);
    expect(asstContent.text).toBe('The answer is 4');

    expect(messages[2].msgId).toBe('user-2');
    expect(messages[2].role).toBe('user');
  });

  it('should handle tool_call updates correctly', async () => {
    const toolCallId = 'tool-1';

    // Initial tool_call
    await repository.upsertMessage({
      runId: testRunId,
      msgId: toolCallId,
      type: 'tool_call',
      role: 'assistant',
      content: JSON.stringify({
        title: 'Read file',
        kind: 'read',
      }),
      status: 'pending',
      toolCallId,
      toolName: 'read',
    });

    // Update tool_call status
    await repository.upsertMessage({
      runId: testRunId,
      msgId: toolCallId,
      type: 'tool_call',
      role: 'assistant',
      content: JSON.stringify({
        status: 'completed',
      }),
      status: 'completed',
      toolCallId,
      toolName: 'read',
    });

    // Fetch messages
    const messages = await repository.findMessagesByRunId(testRunId);

    // Should have only one message with merged content and updated status
    expect(messages).toHaveLength(1);
    expect(messages[0].msgId).toBe(toolCallId);
    expect(messages[0].status).toBe('completed');

    const content = JSON.parse(messages[0].content);
    expect(content.title).toBe('Read file');
    expect(content.kind).toBe('read');
    expect(content.status).toBe('completed');
  });

  it('should not duplicate messages with the same msgId', async () => {
    const msgId = 'duplicate-test';

    // Try to create the same message multiple times
    await repository.upsertMessage({
      runId: testRunId,
      msgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: 'First' }),
    });

    await repository.upsertMessage({
      runId: testRunId,
      msgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: ' Second' }),
    });

    await repository.upsertMessage({
      runId: testRunId,
      msgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: ' Third' }),
    });

    // Fetch messages
    const messages = await repository.findMessagesByRunId(testRunId);

    // Should have only one message
    expect(messages).toHaveLength(1);
    expect(messages[0].msgId).toBe(msgId);

    // Content should be accumulated
    const content = JSON.parse(messages[0].content);
    expect(content.text).toBe('First Second Third');
  });

  it('should handle complex interleaved conversation', async () => {
    // Simulate a realistic conversation with streaming
    const timestamps: number[] = [];

    // User: "Hello"
    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-1',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: 'Hello' }),
    });
    timestamps.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Assistant: "Hi there! How" (streaming)
    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'asst-1',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: 'Hi there!' }),
    });
    timestamps.push(Date.now());

    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'asst-1',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: ' How' }),
    });

    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'asst-1',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: ' can I help?' }),
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Tool call
    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'tool-1',
      type: 'tool_call',
      role: 'assistant',
      content: JSON.stringify({ title: 'Read file', kind: 'read' }),
      status: 'pending',
      toolCallId: 'tool-1',
    });
    timestamps.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 10));

    // User: "Can you help me?"
    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-2',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: 'Can you help me?' }),
    });
    timestamps.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Tool call completes
    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'tool-1',
      type: 'tool_call',
      role: 'assistant',
      content: JSON.stringify({ status: 'completed' }),
      status: 'completed',
      toolCallId: 'tool-1',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Assistant: "Sure!" (streaming)
    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'asst-2',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: 'Sure!' }),
    });
    timestamps.push(Date.now());

    // Fetch messages
    const messages = await repository.findMessagesByRunId(testRunId);

    // Should have 5 messages: user -> asst -> tool -> user -> asst
    expect(messages).toHaveLength(5);

    expect(messages[0].msgId).toBe('user-1');
    expect(messages[0].role).toBe('user');

    expect(messages[1].msgId).toBe('asst-1');
    expect(messages[1].role).toBe('assistant');
    const asst1Content = JSON.parse(messages[1].content);
    expect(asst1Content.text).toBe('Hi there! How can I help?');

    expect(messages[2].msgId).toBe('tool-1');
    expect(messages[2].type).toBe('tool_call');
    expect(messages[2].status).toBe('completed');

    expect(messages[3].msgId).toBe('user-2');
    expect(messages[3].role).toBe('user');

    expect(messages[4].msgId).toBe('asst-2');
    expect(messages[4].role).toBe('assistant');

    // Verify chronological order
    for (let i = 1; i < messages.length; i++) {
      const prevTime = new Date(messages[i - 1].createdAt).getTime();
      const currTime = new Date(messages[i].createdAt).getTime();
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }
  });

  afterAll(async () => {
    await closeTestDatabase();
  });
});
