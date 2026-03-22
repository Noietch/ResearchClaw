/**
 * Test the user question extraction logic from agent-todo.service.ts.
 *
 * The frontend constructs prompts in the format:
 *   "当前文章: ...\n工作目录: ...\n\n---\n\n用户问题: <actual question>"
 *
 * The service must extract just the user question for DB storage and display,
 * while the full prompt with context is sent to the agent.
 */

import { describe, it, expect } from 'vitest';

/**
 * Replicate the exact extraction logic from agent-todo.service.ts
 */
function extractUserQuestion(prompt: string): string {
  const match = prompt.match(/(?:用户问题:\s*)([\s\S]*?)$/);
  return match ? match[1].trim() : prompt;
}

describe('User question extraction from prompt', () => {
  it('extracts question from standard prompt with paper context', () => {
    const prompt = [
      '当前文章: "Attention Is All You Need"',
      '工作目录: /Users/test/.researchclaw/papers/1706.03762',
      'PDF路径: /Users/test/.researchclaw/papers/1706.03762/paper.pdf',
      '文本路径: /Users/test/.researchclaw/papers/1706.03762/text.txt',
      '',
      '---',
      '',
      '用户问题: What is the main contribution?',
    ].join('\n');

    expect(extractUserQuestion(prompt)).toBe('What is the main contribution?');
  });

  it('extracts Chinese question', () => {
    const prompt = [
      '当前文章: "某篇论文"',
      '工作目录: /tmp/paper',
      '',
      '---',
      '',
      '用户问题: 请帮我总结这篇论文的核心内容和主要贡献',
    ].join('\n');

    expect(extractUserQuestion(prompt)).toBe('请帮我总结这篇论文的核心内容和主要贡献');
  });

  it('extracts multi-line question', () => {
    const prompt = [
      '当前文章: "Test"',
      '',
      '---',
      '',
      '用户问题: Please explain:',
      '1. The methodology',
      '2. The results',
      '3. The implications',
    ].join('\n');

    const result = extractUserQuestion(prompt);
    expect(result).toContain('Please explain:');
    expect(result).toContain('1. The methodology');
    expect(result).toContain('3. The implications');
  });

  it('returns full prompt when no "用户问题:" prefix exists', () => {
    const prompt = 'Can you explain the attention mechanism in detail?';
    expect(extractUserQuestion(prompt)).toBe(prompt);
  });

  it('handles prompt with only context and separator but no question label', () => {
    const prompt = '当前文章: "Test"\n\n---\n\nSome other format';
    expect(extractUserQuestion(prompt)).toBe(prompt);
  });

  it('handles empty question after prefix', () => {
    const prompt = '当前文章: "Test"\n\n---\n\n用户问题: ';
    expect(extractUserQuestion(prompt)).toBe('');
  });

  it('extracts question with special characters', () => {
    const prompt = '当前文章: "Test"\n\n---\n\n用户问题: What about O(n²) complexity?';
    expect(extractUserQuestion(prompt)).toBe('What about O(n²) complexity?');
  });

  it('extracts question with attached PDF quotes', () => {
    const prompt = [
      '当前文章: "Test"',
      '',
      '---',
      '',
      '用户问题: Explain these passages',
      '',
      '--- Selected text from paper ---',
      '[1] "The transformer architecture..."',
      '[2] "Multi-head attention allows..."',
    ].join('\n');

    const result = extractUserQuestion(prompt);
    expect(result).toContain('Explain these passages');
    expect(result).toContain('Selected text from paper');
    expect(result).toContain('transformer architecture');
  });

  it('does not include paper context in extracted text', () => {
    const prompt =
      '当前文章: "Secret Paper"\n工作目录: /secret/path\nPDF路径: /secret/paper.pdf\n\n---\n\n用户问题: Summarize';

    const result = extractUserQuestion(prompt);
    expect(result).toBe('Summarize');
    expect(result).not.toContain('Secret Paper');
    expect(result).not.toContain('/secret/path');
    expect(result).not.toContain('paper.pdf');
  });
});
