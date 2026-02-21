import { Agent } from 'undici';
import { HttpError } from '../types.js';
import type { AppConfig } from '../types.js';

export interface HttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

export interface HttpClient {
  readonly get: (url: string, headers?: Record<string, string>) => Promise<HttpResponse>;
  readonly post: (url: string, body: unknown, headers?: Record<string, string>) => Promise<HttpResponse>;
}

export function createHttpClient(config: AppConfig): HttpClient {
  const dispatcher = new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: config.partitionCount + 4,
  });

  async function request(
    method: string,
    url: string,
    body: unknown | undefined,
    extraHeaders: Record<string, string> | undefined,
  ): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      ...extraHeaders,
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        dispatcher,
      } as unknown as RequestInit);

      let responseBody: unknown;
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        responseBody = await response.json();
      } else {
        responseBody = await response.text();
      }

      if (!response.ok) {
        throw new HttpError(
          `HTTP ${response.status} ${method} ${url}`,
          response.status,
          method,
          url,
        );
      }

      return {
        status: response.status,
        headers: response.headers,
        body: responseBody,
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new HttpError(`Request timeout after ${config.requestTimeoutMs}ms`, 0, method, url);
      }
      throw new HttpError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
        0,
        method,
        url,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    get: (url, headers) => request('GET', url, undefined, headers),
    post: (url, body, headers) => request('POST', url, body, headers),
  };
}
