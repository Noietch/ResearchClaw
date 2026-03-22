/**
 * Backend integration test: simulate frontend chat flow.
 *
 * Tests the full backend chain that the renderer calls via IPC:
 *   1. createTodo → runTodo → stream events → messages persisted
 *   2. Mid-stream exit → recovery via getActiveTodoStatus
 *   3. Session reload from DB after task completion
 *   4. Follow-up sendMessage → messages appended correctly
 *
 * Mocks AcpConnection to avoid spawning real agent processes.
 * Uses real SQLite DB for persistence verification.
 * electron mock is auto-loaded via vitest setupFiles (electron-mock.ts).
 * globals: true — vi/describe/it/expect are available without import.
 */

// Mock AcpConnection — must use require() for EventEmitter inside the factory
// because vi.mock is hoisted above all imports.
vi.mock('../../src/main/agent/acp-connection', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { EventEmitter } = require('events');

  class MockAcpConnection extends EventEmitter {
    async spawn() {
      /* no-op */
    }
    async spawnRemote() {
      /* no-op */
    }
    async createSession() {
      return 'mock-session-id';
    }
    async sendPrompt() {
      const conn = this;
      // Emit chunks sequentially with delays to simulate real streaming
      // and avoid DB upsert race conditions
      setTimeout(() => {
        conn.emit('session:update', 'mock-session-id', {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '这篇论文的' },
        });
      }, 30);
      setTimeout(() => {
        conn.emit('session:update', 'mock-session-id', {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '主要贡献是' },
        });
      }, 60);
      setTimeout(() => {
        conn.emit('session:update', 'mock-session-id', {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: '提出了新方法。' },
        });
      }, 90);
      setTimeout(() => {
        conn.emit('session:finished', 'mock-session-id');
      }, 120);
    }
    async setSessionMode() {
      /* no-op */
    }
    respondToPermission() {
      /* no-op */
    }
    kill() {
      /* no-op */
    }
  }
  return { AcpConnection: MockAcpConnection };
});

import { AgentTodoRepository } from '../../src/db/repositories/agent-todo.repository';
import { AgentTodoService } from '../../src/main/services/agent-todo.service';
import { getRunner, stopAllRunners } from '../../src/main/services/agent-runner-registry';
import { ensureTestDatabaseSchema, resetTestDatabase, closeTestDatabase } from '../support/test-db';

describe('Chat backend flow (simulating frontend IPC calls)', () => {
  ensureTestDatabaseSchema();

  const repository = new AgentTodoRepository();
  let service: AgentTodoService;
  let testAgentId: string;

  beforeEach(async () => {
    // Stop all runners from previous test to prevent async DB writes after reset
    stopAllRunners();
    await new Promise((r) => setTimeout(r, 100)); // Let pending async ops settle
    await resetTestDatabase();
    service = new AgentTodoService();

    const agent = await repository.createAgentConfig({
      name: 'Test Claude Agent',
      backend: 'claude-code',
      enabled: true,
    });
    testAgentId = agent.id;
  });

  // ── Test 1: Full chat flow — create, run, stream, persist ─────────────────

  it('should persist initial user message and streamed assistant response', async () => {
    // Frontend: createAgentTodo
    const todo = await service.createTodo({
      title: 'Chat: Attention Is All You Need',
      prompt: '请总结这篇论文的主要贡献',
      cwd: '/tmp/test-paper',
      agentId: testAgentId,
    });
    expect(todo.id).toBeTruthy();

    // Frontend: runAgentTodo
    const run = await service.runTodo(todo.id);
    expect(run.id).toBeTruthy();

    await waitForRunner(todo.id, 3000);

    // Frontend loads messages from DB
    const messages = await repository.findMessagesByRunId(run.id);

    expect(messages.length).toBeGreaterThanOrEqual(2);

    // User prompt persisted
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    const userContent = JSON.parse(userMsg!.content);
    expect(userContent.text).toContain('请总结这篇论文的主要贡献');

    // Assistant response — combine all assistant messages to verify content
    // (upsert accumulation may produce 1 or more DB rows depending on timing)
    const asstMsgs = messages.filter((m) => m.role === 'assistant');
    expect(asstMsgs.length).toBeGreaterThanOrEqual(1);
    const fullAsstText = asstMsgs.map((m) => JSON.parse(m.content).text).join('');
    expect(fullAsstText).toContain('这篇论文的');
    expect(fullAsstText).toContain('提出了新方法。');
  });

  // ── Test 2: Mid-stream recovery via getActiveTodoStatus ───────────────────

  it('should recover live state mid-stream via getActiveTodoStatus', async () => {
    const todo = await service.createTodo({
      title: 'Chat: Recovery Test',
      prompt: '解释一下方法论',
      cwd: '/tmp/test-paper',
      agentId: testAgentId,
    });

    const run = await service.runTodo(todo.id);
    await new Promise((r) => setTimeout(r, 20));

    // Frontend navigates away then back → getActiveTodoStatus
    const activeStatus = service.getActiveTodoStatus(todo.id);
    expect(activeStatus).not.toBeNull();
    expect(activeStatus!.runId).toBe(run.id);

    // Runner memory does NOT have user messages (they're in DB only).
    // Frontend combines DB user messages with runner assistant messages.
    const userMessages = activeStatus!.messages.filter((m) => m.role === 'user');
    expect(userMessages.length).toBe(0);

    // But user message IS in DB
    const dbMsgs = await repository.findMessagesByRunId(run.id);
    const dbUser = dbMsgs.find((m) => m.role === 'user');
    expect(dbUser).toBeDefined();
    expect(JSON.parse(dbUser!.content).text).toContain('解释一下方法论');

    await waitForRunner(todo.id, 3000);
  });

  // ── Test 3: Load completed conversation from DB ───────────────────────────

  it('should load full conversation from DB after task completes', async () => {
    const todo = await service.createTodo({
      title: 'Chat: Completed Paper',
      prompt: '论文的结论是什么？',
      cwd: '/tmp/test-paper',
      agentId: testAgentId,
    });

    const run = await service.runTodo(todo.id);
    await waitForRunner(todo.id, 3000);

    const messages = await service.getRunMessages(run.id);
    expect(messages.length).toBeGreaterThanOrEqual(2);

    for (const msg of messages) {
      const content = JSON.parse(msg.content);
      expect(typeof content.text).toBe('string');
    }

    expect(messages[0].role).toBe('user');
    expect(messages.some((m) => m.role === 'assistant')).toBe(true);
  });

  // ── Test 4: New run for follow-up after completion ────────────────────────

  it('should create separate run for follow-up after task completion', async () => {
    const todo = await service.createTodo({
      title: 'Chat: Follow-up Test',
      prompt: '初始问题',
      cwd: '/tmp/test-paper',
      agentId: testAgentId,
    });

    const run1 = await service.runTodo(todo.id);
    await waitForRunner(todo.id, 3000);

    const run1Msgs = await repository.findMessagesByRunId(run1.id);
    const run1Count = run1Msgs.length;

    const run2 = await service.runTodo(todo.id);
    expect(run2.id).not.toBe(run1.id);
    await waitForRunner(todo.id, 3000);

    const run2Msgs = await repository.findMessagesByRunId(run2.id);
    expect(run2Msgs.length).toBeGreaterThanOrEqual(2);

    // Run 1 isolation
    const run1MsgsAfter = await repository.findMessagesByRunId(run1.id);
    expect(run1MsgsAfter.length).toBe(run1Count);
  });

  // ── Test 5: Chat history — list runs ──────────────────────────────────────

  it('should list all runs for chat history dropdown', async () => {
    const todo = await service.createTodo({
      title: 'Chat: History Test',
      prompt: '第一次对话',
      cwd: '/tmp/test-paper',
      agentId: testAgentId,
    });

    await service.runTodo(todo.id);
    await waitForRunner(todo.id, 3000);

    await service.updateTodo(todo.id, { prompt: '第二次对话' });
    await service.runTodo(todo.id);
    await waitForRunner(todo.id, 3000);

    const runs = await service.listRuns(todo.id);
    expect(runs.length).toBe(2);

    for (const run of runs) {
      const msgs = await service.getRunMessages(run.id);
      expect(msgs.length).toBeGreaterThanOrEqual(2);
    }
  });

  // ── Test 6: Non-existent todo ─────────────────────────────────────────────

  it('should return null for non-existent todo', () => {
    const status = service.getActiveTodoStatus('nonexistent-id');
    expect(status).toBeNull();
  });

  // ── Test 7: Extract clean user text from prompt with paper context ────────

  it('should store clean user text, not full prompt with paper context', async () => {
    // Simulate the exact prompt format that handleChatSend creates
    const promptWithContext = [
      '当前文章: "Attention Is All You Need"',
      '工作目录: /Users/test/.researchclaw/papers/1706.03762',
      'PDF路径: /Users/test/.researchclaw/papers/1706.03762/paper.pdf',
      '文本路径: /Users/test/.researchclaw/papers/1706.03762/text.txt',
      '',
      '---',
      '',
      '用户问题: What is the main contribution?',
    ].join('\n');

    const todo = await service.createTodo({
      title: 'Chat: Attention Is All You Need',
      prompt: promptWithContext,
      cwd: '/tmp/test-paper',
      agentId: testAgentId,
    });

    const run = await service.runTodo(todo.id);
    await waitForRunner(todo.id, 3000);

    const messages = await repository.findMessagesByRunId(run.id);
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();

    const content = JSON.parse(userMsg!.content);
    // Should contain ONLY the user question, not the paper context
    expect(content.text).toBe('What is the main contribution?');
    expect(content.text).not.toContain('当前文章');
    expect(content.text).not.toContain('工作目录');
    expect(content.text).not.toContain('PDF路径');
  });

  // ── Test 8: Prompt without "用户问题:" prefix stores as-is ───────────────

  it('should store full prompt when no "用户问题:" prefix exists', async () => {
    // Follow-up messages and direct prompts don't have the prefix
    const todo = await service.createTodo({
      title: 'Chat: Follow-up',
      prompt: 'Can you explain the attention mechanism in more detail?',
      cwd: '/tmp/test-paper',
      agentId: testAgentId,
    });

    const run = await service.runTodo(todo.id);
    await waitForRunner(todo.id, 3000);

    const messages = await repository.findMessagesByRunId(run.id);
    const userMsg = messages.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();

    const content = JSON.parse(userMsg!.content);
    expect(content.text).toBe('Can you explain the attention mechanism in more detail?');
  });

  // ── Test 9: pushUserMessage stores in memory but doesn't broadcast ────────

  it('should NOT include user messages in getActiveTodoStatus (they come from DB)', async () => {
    const promptWithContext = '当前文章: "Test"\n\n---\n\n用户问题: Explain the methodology';

    const todo = await service.createTodo({
      title: 'Chat: Test',
      prompt: promptWithContext,
      cwd: '/tmp/test-paper',
      agentId: testAgentId,
    });

    const run = await service.runTodo(todo.id);
    await new Promise((r) => setTimeout(r, 20));

    const activeStatus = service.getActiveTodoStatus(todo.id);
    expect(activeStatus).not.toBeNull();

    // Runner memory should NOT have user messages (pushUserMessage is a no-op).
    // User messages are in DB only, loaded separately by frontend's loadChatSession.
    const userMsgs = activeStatus!.messages.filter((m) => m.role === 'user');
    expect(userMsgs.length).toBe(0);

    // But DB should have the user message
    const dbMsgs = await repository.findMessagesByRunId(run.id);
    const dbUserMsg = dbMsgs.find((m) => m.role === 'user');
    expect(dbUserMsg).toBeDefined();
    expect(JSON.parse(dbUserMsg!.content).text).toBe('Explain the methodology');

    await waitForRunner(todo.id, 3000);
  });

  // ── Test 10: Multi-turn conversation with DB recovery ─────────────────────

  it('should recover complete multi-turn conversation from DB', async () => {
    // Round 1: initial chat
    const todo = await service.createTodo({
      title: 'Chat: Multi-turn Test',
      prompt: '当前文章: "Test"\n\n---\n\n用户问题: Summarize the paper',
      cwd: '/tmp/test-paper',
      agentId: testAgentId,
    });

    const run1 = await service.runTodo(todo.id);
    await waitForRunner(todo.id, 3000);

    // Round 2: follow-up (agent stopped, new run)
    await service.updateTodo(todo.id, { prompt: 'What about the experiments?' });
    const run2 = await service.runTodo(todo.id);
    await waitForRunner(todo.id, 3000);

    // Simulate frontend loading chat history for each run
    const run1Msgs = await service.getRunMessages(run1.id);
    const run2Msgs = await service.getRunMessages(run2.id);

    // Run 1: user question (clean) + assistant response
    const run1User = run1Msgs.find((m) => m.role === 'user');
    expect(run1User).toBeDefined();
    expect(JSON.parse(run1User!.content).text).toBe('Summarize the paper');

    const run1Asst = run1Msgs.find((m) => m.role === 'assistant');
    expect(run1Asst).toBeDefined();

    // Run 2: user question (no prefix, stored as-is) + assistant response
    const run2User = run2Msgs.find((m) => m.role === 'user');
    expect(run2User).toBeDefined();
    expect(JSON.parse(run2User!.content).text).toBe('What about the experiments?');

    const run2Asst = run2Msgs.find((m) => m.role === 'assistant');
    expect(run2Asst).toBeDefined();
  });

  // ── Test 11: Summarize prompt also extracts clean text ────────────────────

  it('should extract user text from summarize prompt format', async () => {
    // handleSummarize uses the same prompt format with i18n
    const summarizePrompt = [
      '当前文章: "Some Paper Title"',
      '工作目录: /tmp/paper-dir',
      'PDF路径: /tmp/paper-dir/paper.pdf',
      '文本路径: /tmp/paper-dir/text.txt',
      '',
      '---',
      '',
      '用户问题: 请帮我总结这篇论文的核心内容和主要贡献',
    ].join('\n');

    const todo = await service.createTodo({
      title: 'Chat: Some Paper Title',
      prompt: summarizePrompt,
      cwd: '/tmp/paper-dir',
      agentId: testAgentId,
    });

    const run = await service.runTodo(todo.id);
    await waitForRunner(todo.id, 3000);

    const messages = await repository.findMessagesByRunId(run.id);
    const userMsg = messages.find((m) => m.role === 'user');
    const content = JSON.parse(userMsg!.content);
    expect(content.text).toBe('请帮我总结这篇论文的核心内容和主要贡献');
  });

  afterAll(async () => {
    stopAllRunners();
    await new Promise((r) => setTimeout(r, 100));
    await closeTestDatabase();
  });
});

/**
 * Poll until runner reaches a terminal state.
 */
async function waitForRunner(todoId: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const runner = getRunner(todoId);
    if (!runner) break;
    const status = runner.getStatus();
    if (status === 'completed' || status === 'failed' || status === 'cancelled') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  // Let async DB operations (upsertMessage) settle
  await new Promise((r) => setTimeout(r, 200));
}
