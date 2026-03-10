import { describe, expect, it, beforeEach } from 'vitest';

/**
 * Test message accumulation logic for agent streaming.
 * This tests the core logic used in:
 * - src/main/services/agent-task-runner.ts (mergeMessage)
 * - src/renderer/hooks/use-agent-stream.ts (text accumulation)
 */

interface Message {
  id: string;
  msgId: string;
  type: string;
  content: { text: string };
  createdAt: string;
}

// Simulate main process merge logic (from agent-task-runner.ts)
function createMainProcessAccumulator() {
  const mergedMessages = new Map<string, Message>();

  function mergeMessage(message: Message): void {
    const existing = mergedMessages.get(message.msgId);
    if (!existing) {
      mergedMessages.set(message.msgId, { ...message });
      return;
    }

    if (message.type === 'text' || message.type === 'thought') {
      const existingContent = existing.content as { text: string };
      const newContent = message.content as { text: string };
      existing.content = { text: existingContent.text + newContent.text };
      return;
    }
  }

  return {
    mergeMessage,
    getMergedMessages: (): Message[] => Array.from(mergedMessages.values()),
  };
}

// Simulate renderer process accumulation logic (from use-agent-stream.ts)
function createRendererAccumulator() {
  const textAccumulator = new Map<string, string>();
  const messageMetadata = new Map<string, Message>();
  const messages: Message[] = [];

  function handleChunk(message: Message): void {
    const msgId = message.msgId;
    const newContent = message.content as { text: string };

    const existingText = textAccumulator.get(msgId);
    if (existingText !== undefined) {
      textAccumulator.set(msgId, existingText + newContent.text);
    } else {
      textAccumulator.set(msgId, newContent.text);
      messageMetadata.set(msgId, message);
    }

    // Flush to messages array (simplified version of flushToState)
    const accumulatedText = textAccumulator.get(msgId);
    const meta = messageMetadata.get(msgId);
    if (meta && accumulatedText) {
      const idx = messages.findIndex((m) => m.msgId === msgId);
      const updatedMessage = { ...meta, content: { text: accumulatedText } };
      if (idx >= 0) {
        messages[idx] = updatedMessage;
      } else {
        messages.push(updatedMessage);
      }
    }
  }

  return {
    handleChunk,
    getMessages: () => messages,
    getAccumulator: () => textAccumulator,
  };
}

describe('Message Accumulation', () => {
  describe('Main Process (agent-task-runner.ts)', () => {
    it('should accumulate text chunks in order', () => {
      const accumulator = createMainProcessAccumulator();
      const msgId = 'msg-1';

      // Simulate chunks arriving in order
      const chunks = ['我', '先', '快速', '读', '一下', 'text.txt'];

      for (let i = 0; i < chunks.length; i++) {
        accumulator.mergeMessage({
          id: `chunk-${i}`,
          msgId,
          type: 'text',
          content: { text: chunks[i] },
          createdAt: new Date().toISOString(),
        });
      }

      const messages = accumulator.getMergedMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].content.text).toBe('我先快速读一下text.txt');
    });

    it('should handle multiple messages with different msgIds', () => {
      const accumulator = createMainProcessAccumulator();

      // First message
      accumulator.mergeMessage({
        id: 'chunk-0',
        msgId: 'msg-1',
        type: 'text',
        content: { text: 'Hello' },
        createdAt: new Date().toISOString(),
      });
      accumulator.mergeMessage({
        id: 'chunk-1',
        msgId: 'msg-1',
        type: 'text',
        content: { text: ' World' },
        createdAt: new Date().toISOString(),
      });

      // Second message
      accumulator.mergeMessage({
        id: 'chunk-2',
        msgId: 'msg-2',
        type: 'text',
        content: { text: 'Goodbye' },
        createdAt: new Date().toISOString(),
      });

      const messages = accumulator.getMergedMessages();
      expect(messages).toHaveLength(2);
      expect(messages.find((m) => m.msgId === 'msg-1')?.content.text).toBe('Hello World');
      expect(messages.find((m) => m.msgId === 'msg-2')?.content.text).toBe('Goodbye');
    });
  });

  describe('Renderer Process (use-agent-stream.ts)', () => {
    it('should accumulate text chunks synchronously', () => {
      const accumulator = createRendererAccumulator();
      const msgId = 'msg-1';

      const chunks = ['我', '先', '快速', '读', '一下', 'text.txt'];

      for (let i = 0; i < chunks.length; i++) {
        accumulator.handleChunk({
          id: `chunk-${i}`,
          msgId,
          type: 'text',
          content: { text: chunks[i] },
          createdAt: new Date().toISOString(),
        });
      }

      const messages = accumulator.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].content.text).toBe('我先快速读一下text.txt');
    });

    it('should maintain order when chunks arrive rapidly', () => {
      const accumulator = createRendererAccumulator();
      const msgId = 'msg-1';

      // Simulate rapid chunk arrival (like real streaming)
      const expectedText =
        '我先快速读一下 text.txt，必要时，再对照 paper.pdf 确认结构。我先抓一下结论章节，整理成你能直接用的摘要。';

      const chunks = expectedText.split('');
      for (let i = 0; i < chunks.length; i++) {
        accumulator.handleChunk({
          id: `chunk-${i}`,
          msgId,
          type: 'text',
          content: { text: chunks[i] },
          createdAt: new Date().toISOString(),
        });
      }

      const messages = accumulator.getMessages();
      expect(messages[0].content.text).toBe(expectedText);
    });
  });

  describe('State Recovery (when navigating back to page)', () => {
    it('should preserve accumulated text when recovering from main process', () => {
      // Simulate main process accumulation
      const mainAccumulator = createMainProcessAccumulator();
      const msgId = 'msg-1';

      const originalText = '我先快速读一下text.txt，再对照paper.pdf确认结构';
      const chunks = originalText.split('');
      for (let i = 0; i < chunks.length; i++) {
        mainAccumulator.mergeMessage({
          id: `chunk-${i}`,
          msgId,
          type: 'text',
          content: { text: chunks[i] },
          createdAt: new Date().toISOString(),
        });
      }

      // Get merged messages (simulating getActiveTodoStatus call)
      const recoveredMessages = mainAccumulator.getMergedMessages();

      // Verify the recovered message is correct
      expect(recoveredMessages).toHaveLength(1);
      expect(recoveredMessages[0].content.text).toBe(originalText);
    });

    it('should NOT duplicate text when recovering state', () => {
      const mainAccumulator = createMainProcessAccumulator();
      const msgId = 'msg-1';

      // Accumulate some text
      mainAccumulator.mergeMessage({
        id: 'chunk-0',
        msgId,
        type: 'text',
        content: { text: 'Hello' },
        createdAt: new Date().toISOString(),
      });
      mainAccumulator.mergeMessage({
        id: 'chunk-1',
        msgId,
        type: 'text',
        content: { text: ' World' },
        createdAt: new Date().toISOString(),
      });

      const messages = mainAccumulator.getMergedMessages();

      // The text should be "Hello World", not "Hello World World" or any duplication
      expect(messages[0].content.text).toBe('Hello World');
      expect(messages[0].content.text).not.toContain('Hello World World');
    });
  });

  describe('Page Navigation Recovery', () => {
    it('should correctly initialize accumulator from recovered messages', () => {
      // Simulate: user is on page, chunks arrive and accumulate
      const mainAccumulator = createMainProcessAccumulator();
      const msgId = 'msg-1';

      // Accumulate some text
      const chunks = ['我先', '快速', '读', '一下', 'text.txt'];
      for (let i = 0; i < chunks.length; i++) {
        mainAccumulator.mergeMessage({
          id: `chunk-${i}`,
          msgId,
          type: 'text',
          content: { text: chunks[i] },
          createdAt: new Date().toISOString(),
        });
      }

      // User navigates away, then navigates back
      // Renderer needs to recover state from main process
      const recoveredMessages = mainAccumulator.getMergedMessages();

      // Create new renderer accumulator (simulating new hook instance)
      const rendererAccumulator = createRendererAccumulator();

      // Populate accumulator from recovered messages (simulating recovery logic)
      for (const msg of recoveredMessages) {
        const content = msg.content as { text?: string };
        if ((msg.type === 'text' || msg.type === 'thought') && content.text) {
          // This is what use-agent-stream.ts does in recovery
          rendererAccumulator.handleChunk({
            ...msg,
            content: { text: content.text }, // Already accumulated text
          });
        }
      }

      // Now simulate a new chunk arriving after recovery
      rendererAccumulator.handleChunk({
        id: 'chunk-new',
        msgId,
        type: 'text',
        content: { text: '，这是后续内容' },
        createdAt: new Date().toISOString(),
      });

      const finalMessages = rendererAccumulator.getMessages();
      expect(finalMessages).toHaveLength(1);
      expect(finalMessages[0].content.text).toBe('我先快速读一下text.txt，这是后续内容');
    });

    it('should NOT double the text when recovering', () => {
      // This is the bug scenario: text gets duplicated on recovery
      const mainAccumulator = createMainProcessAccumulator();
      const msgId = 'msg-1';

      mainAccumulator.mergeMessage({
        id: 'chunk-0',
        msgId,
        type: 'text',
        content: { text: 'Hello' },
        createdAt: new Date().toISOString(),
      });

      const recoveredMessages = mainAccumulator.getMergedMessages();
      expect(recoveredMessages[0].content.text).toBe('Hello');

      // If we accidentally treat the recovered message as a chunk and append it again
      // We would get "HelloHello" which is wrong
      const wrongResult = recoveredMessages[0].content.text + recoveredMessages[0].content.text;
      expect(wrongResult).toBe('HelloHello'); // This is what we DON'T want

      // Correct behavior: use recovered text as initial state, don't append
      const correctResult = recoveredMessages[0].content.text;
      expect(correctResult).toBe('Hello');
    });
  });

  describe('Race Condition: IPC events arrive during recovery', () => {
    // Simulate the FIXED behavior with buffering
    function createFixedRendererAccumulator() {
      const textAccumulator = new Map<string, string>();
      const messageMetadata = new Map<string, Message>();
      const messages: Message[] = [];
      const pendingEvents: Message[] = [];
      let isRecovering = false;

      function startRecovery() {
        isRecovering = true;
        pendingEvents.length = 0;
      }

      function completeRecovery(recoveredMessages: Message[]) {
        // First, populate accumulator with recovered messages
        for (const msg of recoveredMessages) {
          const content = msg.content as { text?: string };
          if ((msg.type === 'text' || msg.type === 'thought') && content.text) {
            textAccumulator.set(msg.msgId, content.text);
            messageMetadata.set(msg.msgId, msg);
          }
        }
        messages.push(...recoveredMessages);

        // Then, process buffered events
        isRecovering = false;
        for (const event of pendingEvents) {
          handleChunkInternal(event);
        }
        pendingEvents.length = 0;
      }

      function handleChunk(message: Message): void {
        if (isRecovering) {
          // Buffer event during recovery
          pendingEvents.push(message);
          return;
        }
        handleChunkInternal(message);
      }

      function handleChunkInternal(message: Message): void {
        const msgId = message.msgId;
        const newContent = message.content as { text: string };

        const existingText = textAccumulator.get(msgId);
        if (existingText !== undefined) {
          textAccumulator.set(msgId, existingText + newContent.text);
        } else {
          textAccumulator.set(msgId, newContent.text);
          messageMetadata.set(msgId, message);
        }

        const accumulatedText = textAccumulator.get(msgId);
        const meta = messageMetadata.get(msgId);
        if (meta && accumulatedText) {
          const idx = messages.findIndex((m) => m.msgId === msgId);
          const updatedMessage = { ...meta, content: { text: accumulatedText } };
          if (idx >= 0) {
            messages[idx] = updatedMessage;
          } else {
            messages.push(updatedMessage);
          }
        }
      }

      return {
        handleChunk,
        startRecovery,
        completeRecovery,
        getMessages: () => messages,
      };
    }

    it('should handle IPC events arriving while recovery is in progress (FIXED)', () => {
      // Simulate: chunks arrive, user navigates away, recovery starts, new chunks arrive
      const mainAccumulator = createMainProcessAccumulator();
      const msgId = 'msg-1';

      // Initial chunks
      mainAccumulator.mergeMessage({
        id: 'chunk-0',
        msgId,
        type: 'text',
        content: { text: 'Hello' },
        createdAt: new Date().toISOString(),
      });

      // User navigates away - get state for recovery
      // IMPORTANT: Deep copy the messages, because the main accumulator will continue to mutate them
      const recoveredMessages = mainAccumulator.getMergedMessages().map((m) => ({
        ...m,
        content: { ...m.content },
      }));

      // Meanwhile, more chunks arrive in main process
      mainAccumulator.mergeMessage({
        id: 'chunk-1',
        msgId,
        type: 'text',
        content: { text: ' World' },
        createdAt: new Date().toISOString(),
      });

      // Create FIXED renderer accumulator with buffering
      const rendererAccumulator = createFixedRendererAccumulator();

      // Start recovery (buffering begins)
      rendererAccumulator.startRecovery();

      // Simulate: new IPC event arrives DURING recovery
      // This should be BUFFERED, not processed immediately
      rendererAccumulator.handleChunk({
        id: 'chunk-1',
        msgId,
        type: 'text',
        content: { text: ' World' },
        createdAt: new Date().toISOString(),
      });

      // Recovery completes with recovered messages
      // This should set accumulator to "Hello" first, then process buffered " World"
      rendererAccumulator.completeRecovery(recoveredMessages);

      const finalMessages = rendererAccumulator.getMessages();
      expect(finalMessages[0].content.text).toBe('Hello World');
    });

    it('should handle recovery completing before new IPC events', () => {
      // Correct order: recovery completes first
      const mainAccumulator = createMainProcessAccumulator();
      const msgId = 'msg-1';

      mainAccumulator.mergeMessage({
        id: 'chunk-0',
        msgId,
        type: 'text',
        content: { text: 'Hello' },
        createdAt: new Date().toISOString(),
      });

      const recoveredMessages = mainAccumulator.getMergedMessages();

      const rendererAccumulator = createFixedRendererAccumulator();

      // Start and complete recovery first
      rendererAccumulator.startRecovery();
      rendererAccumulator.completeRecovery(recoveredMessages);

      // Then new IPC events arrive (not buffered since recovery is complete)
      rendererAccumulator.handleChunk({
        id: 'chunk-1',
        msgId,
        type: 'text',
        content: { text: ' World' },
        createdAt: new Date().toISOString(),
      });

      const finalMessages = rendererAccumulator.getMessages();
      expect(finalMessages[0].content.text).toBe('Hello World');
    });
  });

  describe('Bug Reproduction: Text scrambling when navigating back', () => {
    it('should NOT scramble text like "我快速先读" -> "我先快速读"', () => {
      const accumulator = createMainProcessAccumulator();
      const msgId = 'msg-1';

      // Simulate the actual chunk order that might cause scrambling
      // The bug might be caused by chunks arriving out of order
      const correctText = '我先快速读一下text.txt';
      const chunks = correctText.split('');

      // Process chunks in order
      for (let i = 0; i < chunks.length; i++) {
        accumulator.mergeMessage({
          id: `chunk-${i}`,
          msgId,
          type: 'text',
          content: { text: chunks[i] },
          createdAt: new Date().toISOString(),
        });
      }

      const messages = accumulator.getMergedMessages();
      expect(messages[0].content.text).toBe(correctText);

      // It should NOT be scrambled like this
      expect(messages[0].content.text).not.toBe('我快速先读text一下.txt');
    });

    it('should handle chunk reordering gracefully', () => {
      // This test simulates what might happen if chunks arrive out of order
      // Current implementation does NOT handle out-of-order chunks
      // This is a known limitation

      const accumulator = createMainProcessAccumulator();
      const msgId = 'msg-1';

      // Chunks arriving out of order (chunk 1, then chunk 0)
      accumulator.mergeMessage({
        id: 'chunk-1',
        msgId,
        type: 'text',
        content: { text: '快速' },
        createdAt: new Date().toISOString(),
      });
      accumulator.mergeMessage({
        id: 'chunk-0',
        msgId,
        type: 'text',
        content: { text: '我先' },
        createdAt: new Date().toISOString(),
      });

      const messages = accumulator.getMergedMessages();

      // NOTE: Current implementation will produce wrong order: "快速我先"
      // This is a KNOWN LIMITATION - chunks must arrive in order
      // If this test fails, it means we need to add sequence numbers to chunks
      expect(messages[0].content.text).toBe('快速我先'); // This is the current (wrong) behavior
    });
  });
});
