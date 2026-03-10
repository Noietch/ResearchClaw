import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock app-settings-store before importing proxy-test.service
vi.mock('../../src/main/store/app-settings-store', () => ({
  getProxy: vi.fn(() => undefined),
}));

function makeFakeHttps(statusCode = 200) {
  return {
    request: vi.fn(
      (_url: string, opts: Record<string, unknown>, callback: (res: object) => void) => {
        const res = new EventEmitter();
        (res as Record<string, unknown>).statusCode = statusCode;
        (res as Record<string, unknown>).resume = vi.fn();
        // Simulate async response so req.end() is called first
        setImmediate(() => callback(res));
        const req = new EventEmitter();
        (req as Record<string, unknown>).end = vi.fn();
        (req as Record<string, unknown>).destroy = vi.fn();
        return req;
      },
    ),
  };
}

describe('proxy-test service', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('TEST_ENDPOINTS includes expected sites', async () => {
    vi.doMock('node:https', () => makeFakeHttps(200));

    const { testProxy } = await import('../../src/main/services/proxy-test.service');
    const result = await testProxy();

    expect(result.hasProxy).toBe(false);
    const names = result.results.map((r) => r.name);
    expect(names).toContain('HuggingFace');
    expect(names).toContain('Google');
    expect(names).toContain('GitHub');
    expect(names).toContain('YouTube');

    const hfResult = result.results.find((r) => r.name === 'HuggingFace');
    expect(hfResult?.url).toBe('https://huggingface.co');
    expect(hfResult?.success).toBe(true);
  });

  it('testProxy returns hasProxy=true when proxy is configured', async () => {
    const { getProxy } = await import('../../src/main/store/app-settings-store');
    vi.mocked(getProxy).mockReturnValue('http://127.0.0.1:7890');

    vi.doMock('node:https', () => makeFakeHttps(200));

    const { testProxy } = await import('../../src/main/services/proxy-test.service');
    const result = await testProxy();
    expect(result.hasProxy).toBe(true);
  });

  it('passes agent to https.request when proxy is set', async () => {
    const { getProxy } = await import('../../src/main/store/app-settings-store');
    vi.mocked(getProxy).mockReturnValue('http://127.0.0.1:7890');

    const fakeHttps = makeFakeHttps(200);
    vi.doMock('node:https', () => fakeHttps);

    const { testProxy } = await import('../../src/main/services/proxy-test.service');
    await testProxy();

    // Every call to https.request should have received an agent option
    for (const call of fakeHttps.request.mock.calls) {
      const opts = call[1] as Record<string, unknown>;
      expect(opts.agent).toBeDefined();
      expect(typeof opts.agent).toBe('object');
    }
  });

  it('does NOT pass agent to https.request when no proxy is set', async () => {
    const { getProxy } = await import('../../src/main/store/app-settings-store');
    vi.mocked(getProxy).mockReturnValue(undefined);

    const fakeHttps = makeFakeHttps(200);
    vi.doMock('node:https', () => fakeHttps);

    const { testProxy } = await import('../../src/main/services/proxy-test.service');
    await testProxy();

    // Without a proxy, agent should be absent (undefined)
    for (const call of fakeHttps.request.mock.calls) {
      const opts = call[1] as Record<string, unknown>;
      expect(opts.agent).toBeUndefined();
    }
  });

  it('passes null to force direct connection even when store has a proxy saved', async () => {
    // Simulate: store has a proxy saved, but UI explicitly tests direct connection
    const { getProxy } = await import('../../src/main/store/app-settings-store');
    vi.mocked(getProxy).mockReturnValue('http://127.0.0.1:7897');

    const fakeHttps = makeFakeHttps(200);
    vi.doMock('node:https', () => fakeHttps);

    const { testProxy } = await import('../../src/main/services/proxy-test.service');
    // null = explicit "no proxy" — must NOT fall back to store
    const result = await testProxy(null);

    expect(result.hasProxy).toBe(false);
    for (const call of fakeHttps.request.mock.calls) {
      const opts = call[1] as Record<string, unknown>;
      expect(opts.agent).toBeUndefined();
    }
  });

  it('reports failure when proxy connection is refused', async () => {
    // Simulate ECONNREFUSED — what happens with a bad proxy port
    const fakeHttps = {
      request: vi.fn((_url: string, _opts: object, _callback: unknown) => {
        const req = new EventEmitter();
        (req as Record<string, unknown>).end = vi.fn(() => {
          setImmediate(() => {
            const err = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:19999'), {
              code: 'ECONNREFUSED',
            });
            req.emit('error', err);
          });
        });
        (req as Record<string, unknown>).destroy = vi.fn();
        return req;
      }),
    };
    vi.doMock('node:https', () => fakeHttps);

    const { testProxy } = await import('../../src/main/services/proxy-test.service');
    const result = await testProxy('http://127.0.0.1:19999');

    // All endpoints should fail when proxy is unreachable
    expect(result.hasProxy).toBe(true);
    for (const r of result.results) {
      expect(r.success).toBe(false);
      expect(r.error).toMatch(/ECONNREFUSED/);
    }
  });
});
