import { HttpError } from '../../types.js';
import type { AppConfig } from '../../types.js';
import type { Logger } from '../../logger.js';
import type { HttpResponse } from '../http-client.js';

type FetchFn = () => Promise<HttpResponse>;

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500 || status === 0;
}

export function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) return null;

  // Delta seconds (e.g. "5")
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? seconds * 1000 : null;
  }

  // HTTP-date (e.g. "Thu, 01 Dec 2025 16:00:00 GMT")
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    const delayMs = date - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

export function withRetry(
  fn: FetchFn,
  config: AppConfig,
  logger: Logger,
  operationName: string,
): () => Promise<HttpResponse> {
  return async (): Promise<HttpResponse> => {
    let lastError: HttpError | null = null;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof HttpError) || !isRetryable(err.status)) {
          throw err;
        }

        lastError = err;
        let delayMs: number;

        if (err.status === 429) {
          // For rate limits, we'll get retry info from the middleware layer
          // Here just use exponential backoff as baseline
          delayMs = Math.min(
            config.retryBaseMs * Math.pow(2, attempt - 1),
            config.retryMaxMs,
          );
        } else {
          // 5xx / network errors: exponential backoff with jitter
          const base = config.retryBaseMs * Math.pow(2, attempt - 1);
          const jitter = Math.random() * base * 0.3;
          delayMs = Math.min(base + jitter, config.retryMaxMs);
        }

        logger.warn(
          { operationName, attempt, maxRetries: config.maxRetries, status: err.status, delayMs },
          'Retrying operation',
        );

        await sleep(delayMs);
      }
    }

    throw lastError ?? new HttpError('Max retries exceeded', 0, 'UNKNOWN', '');
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
