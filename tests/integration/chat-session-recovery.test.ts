/**
 * Test chat session recovery after mid-conversation exits.
 *
 * Verifies that:
 * 1. The initial user prompt is persisted as a run message
 * 2. All messages (user + assistant) survive a mid-stream exit
 * 3. Loading a chat session from history restores the full conversation
 * 4. Follow-up messages after reconnection are interleaved correctly
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { AgentTodoRepository } from '../../src/db/repositories/agent-todo.repository';
import { closeTestDatabase, ensureTestDatabaseSchema, resetTestDatabase } from '../support/test-db';

describe('Chat session recovery after mid-conversation exit', () => {
  ensureTestDatabaseSchema();

  const repository = new AgentTodoRepository();

  let testTodoId: string;
  let testRunId: string;

  beforeEach(async () => {
    await resetTestDatabase();

    const agent = await repository.createAgentConfig({
      name: 'Test Agent',
      backend: 'test-backend',
      enabled: true,
    });

    const todo = await repository.createTodo({
      title: 'Chat: Test Paper Title',
      prompt: '当前文章: "Test Paper"\n\n---\n\n用户问题: 请总结这篇论文的主要贡献',
      cwd: '/tmp/test-paper',
      agentId: agent.id,
    });
    testTodoId = todo.id;

    const run = await repository.createRun({
      todoId: testTodoId,
      status: 'running',
      trigger: 'manual',
    });
    testRunId = run.id;
  });

  it('should persist the initial user prompt as a run message', async () => {
    // Simulate what runAgentTodo now does: save initial prompt as user message
    const initialMsgId = `user-${Date.now()}`;
    const initialPrompt = '当前文章: "Test Paper"\n\n---\n\n用户问题: 请总结这篇论文的主要贡献';

    await repository.createMessage({
      runId: testRunId,
      msgId: initialMsgId,
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: initialPrompt }),
      status: null,
      toolCallId: null,
      toolName: null,
    });

    const messages = await repository.findMessagesByRunId(testRunId);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].msgId).toBe(initialMsgId);

    const content = JSON.parse(messages[0].content);
    expect(content.text).toContain('请总结这篇论文的主要贡献');
  });

  it('should recover full conversation after mid-stream exit', async () => {
    // 1. Initial user prompt
    const userMsgId = `user-${Date.now()}`;
    await repository.createMessage({
      runId: testRunId,
      msgId: userMsgId,
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: '请总结这篇论文' }),
      status: null,
      toolCallId: null,
      toolName: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // 2. Assistant starts streaming response
    const asstMsgId = 'asst-1';
    await repository.upsertMessage({
      runId: testRunId,
      msgId: asstMsgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: '这篇论文的主要贡献' }),
    });

    await repository.upsertMessage({
      runId: testRunId,
      msgId: asstMsgId,
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: '包括以下几点：' }),
    });

    // 3. User exits mid-stream (navigates away)
    // ... some chunks are lost ...

    // 4. Simulate recovery: load messages from DB
    const recoveredMessages = await repository.findMessagesByRunId(testRunId);

    // Should have both user prompt and partial assistant response
    expect(recoveredMessages).toHaveLength(2);
    expect(recoveredMessages[0].role).toBe('user');
    expect(recoveredMessages[1].role).toBe('assistant');

    const userContent = JSON.parse(recoveredMessages[0].content);
    expect(userContent.text).toBe('请总结这篇论文');

    const asstContent = JSON.parse(recoveredMessages[1].content);
    expect(asstContent.text).toBe('这篇论文的主要贡献包括以下几点：');
  });

  it('should support follow-up messages after reconnection', async () => {
    // Initial conversation
    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-1',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: '请总结这篇论文' }),
      status: null,
      toolCallId: null,
      toolName: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'asst-1',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: '这篇论文提出了...' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // User exits and comes back, then sends a follow-up
    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-2',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: '能详细说说方法部分吗？' }),
      status: null,
      toolCallId: null,
      toolName: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'asst-2',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: '方法部分主要包括...' }),
    });

    // Verify full conversation history
    const messages = await repository.findMessagesByRunId(testRunId);

    expect(messages).toHaveLength(4);
    expect(messages[0].msgId).toBe('user-1');
    expect(messages[0].role).toBe('user');
    expect(messages[1].msgId).toBe('asst-1');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].msgId).toBe('user-2');
    expect(messages[2].role).toBe('user');
    expect(messages[3].msgId).toBe('asst-2');
    expect(messages[3].role).toBe('assistant');

    // Verify chronological order
    for (let i = 1; i < messages.length; i++) {
      const prevTime = new Date(messages[i - 1].createdAt).getTime();
      const currTime = new Date(messages[i].createdAt).getTime();
      expect(currTime).toBeGreaterThanOrEqual(prevTime);
    }
  });

  it('should handle tool calls surviving mid-exit', async () => {
    // User prompt
    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-1',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: '读一下论文的结论部分' }),
      status: null,
      toolCallId: null,
      toolName: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Assistant starts a tool call
    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'tool-1',
      type: 'tool_call',
      role: 'assistant',
      content: JSON.stringify({ title: 'Read text.txt', kind: 'read' }),
      status: 'pending',
      toolCallId: 'tool-1',
      toolName: 'read',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Tool call completes
    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'tool-1',
      type: 'tool_call',
      role: 'assistant',
      content: JSON.stringify({ result: 'File contents...' }),
      status: 'completed',
      toolCallId: 'tool-1',
      toolName: 'read',
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // User exits here, then comes back

    // Verify recovery
    const messages = await repository.findMessagesByRunId(testRunId);

    expect(messages).toHaveLength(2);
    expect(messages[0].msgId).toBe('user-1');
    expect(messages[0].role).toBe('user');

    expect(messages[1].msgId).toBe('tool-1');
    expect(messages[1].type).toBe('tool_call');
    expect(messages[1].status).toBe('completed');

    const toolContent = JSON.parse(messages[1].content);
    expect(toolContent.title).toBe('Read text.txt');
    expect(toolContent.result).toBe('File contents...');
  });

  it('should load chat session from history by finding runs', async () => {
    // Simulate a completed conversation
    await repository.createMessage({
      runId: testRunId,
      msgId: 'user-1',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: '论文的核心创新点是什么？' }),
      status: null,
      toolCallId: null,
      toolName: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'asst-1',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: '核心创新点有三个方面...' }),
    });

    // Mark run as completed
    await repository.updateRun(testRunId, {
      status: 'completed',
      finishedAt: new Date(),
    });

    // Simulate: user opens chat history dropdown and clicks on this session
    // 1. List runs for this todo
    const runs = await repository.findRunsByTodoId(testTodoId);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(testRunId);
    expect(runs[0].status).toBe('completed');

    // 2. Load messages for the run
    const messages = await repository.findMessagesByRunId(runs[0].id);
    expect(messages).toHaveLength(2);

    // 3. Verify the conversation can be displayed
    const userContent = JSON.parse(messages[0].content);
    expect(userContent.text).toBe('论文的核心创新点是什么？');

    const asstContent = JSON.parse(messages[1].content);
    expect(asstContent.text).toBe('核心创新点有三个方面...');
  });

  it('should handle multiple runs with separate message histories', async () => {
    // First run - completed
    await repository.createMessage({
      runId: testRunId,
      msgId: 'r1-user-1',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: '第一轮对话' }),
      status: null,
      toolCallId: null,
      toolName: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await repository.upsertMessage({
      runId: testRunId,
      msgId: 'r1-asst-1',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: '第一轮回答' }),
    });

    await repository.updateRun(testRunId, {
      status: 'completed',
      finishedAt: new Date(),
    });

    // Second run - user comes back and sends a follow-up
    const run2 = await repository.createRun({
      todoId: testTodoId,
      status: 'running',
      trigger: 'manual',
    });

    await repository.createMessage({
      runId: run2.id,
      msgId: 'r2-user-1',
      type: 'text',
      role: 'user',
      content: JSON.stringify({ text: '第二轮对话' }),
      status: null,
      toolCallId: null,
      toolName: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    await repository.upsertMessage({
      runId: run2.id,
      msgId: 'r2-asst-1',
      type: 'text',
      role: 'assistant',
      content: JSON.stringify({ text: '第二轮回答' }),
    });

    // Verify run isolation
    const run1Messages = await repository.findMessagesByRunId(testRunId);
    expect(run1Messages).toHaveLength(2);
    expect(JSON.parse(run1Messages[0].content).text).toBe('第一轮对话');

    const run2Messages = await repository.findMessagesByRunId(run2.id);
    expect(run2Messages).toHaveLength(2);
    expect(JSON.parse(run2Messages[0].content).text).toBe('第二轮对话');
  });

  afterAll(async () => {
    await closeTestDatabase();
  });
});
