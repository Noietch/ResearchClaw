/**
 * A minimal fetch-like wrapper using node:https/node:http so that
 * HttpsProxyAgent is actually honoured (globalThis.fetch ignores `agent`).
 */
import * as https from 'node:https';
import * as http from 'node:http';
import type { Agent } from 'node:http';

export interface ProxyFetchResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  text(): string;
}

export function proxyFetch(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
    agent?: Agent;
    timeoutMs?: number;
  } = {},
): Promise<ProxyFetchResponse> {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body, agent, timeoutMs = 30_000 } = options;
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VibeResearch/1.0)', ...headers },
        ...(agent ? { agent } : {}),
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 400,
            status,
            headers: res.headers,
            body,
            text: () => body.toString('utf8'),
          });
        });
        res.on('error', reject);
      },
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}
