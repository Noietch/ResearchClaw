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

function doFetch(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
    agent?: Agent;
    timeoutMs?: number;
    onProgress?: (downloaded: number, total: number) => void;
  },
  redirectsLeft: number,
): Promise<ProxyFetchResponse> {
  return new Promise((resolve, reject) => {
    const { method = 'GET', headers = {}, body, agent, timeoutMs = 30_000, onProgress } = options;
    const parsed = new URL(urlStr);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResearchClaw/1.0)', ...headers },
        ...(agent ? { agent } : {}),
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;

        // Follow redirects (301, 302, 303, 307, 308)
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume(); // drain the response body
          const location = res.headers.location;
          const nextUrl = location.startsWith('http')
            ? location
            : `${parsed.protocol}//${parsed.host}${location}`;
          doFetch(nextUrl, options, redirectsLeft - 1).then(resolve, reject);
          return;
        }

        const chunks: Buffer[] = [];
        const contentLength = res.headers['content-length'];
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        let downloaded = 0;

        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          downloaded += chunk.length;
          if (onProgress) onProgress(downloaded, total);
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            ok: status >= 200 && status < 300,
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

export function proxyFetch(
  urlStr: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: Buffer | string;
    agent?: Agent;
    timeoutMs?: number;
    onProgress?: (downloaded: number, total: number) => void;
  } = {},
): Promise<ProxyFetchResponse> {
  return doFetch(urlStr, options, 5);
}
