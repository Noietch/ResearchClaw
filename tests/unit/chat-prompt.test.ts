import { describe, it, expect } from 'vitest';
import { getChatSystemPrompt, getChatContextIntro, getChatContextResponse } from '@shared';

describe('Chat prompts i18n', () => {
  it('should return English system prompt by default', () => {
    const prompt = getChatSystemPrompt();
    expect(prompt).toContain('research ideation assistant');
    expect(prompt).toContain('Respond in English');
  });

  it('should return Chinese system prompt when language is zh', () => {
    const prompt = getChatSystemPrompt('zh');
    expect(prompt).toContain('研究创意助手');
    expect(prompt).toContain('用中文回复');
  });

  it('should return English context intro by default', () => {
    const intro = getChatContextIntro();
    expect(intro).toContain('discuss research ideas');
    expect(intro).toContain('ready');
  });

  it('should return Chinese context intro when language is zh', () => {
    const intro = getChatContextIntro('zh');
    expect(intro).toContain('讨论研究想法');
    expect(intro).toContain('准备好');
  });

  it('should return English context response by default', () => {
    const response = getChatContextResponse();
    expect(response).toContain('understand');
    expect(response).toContain('ready to help');
  });

  it('should return Chinese context response when language is zh', () => {
    const response = getChatContextResponse('zh');
    expect(response).toContain('理解');
    expect(response).toContain('准备好');
  });
});
