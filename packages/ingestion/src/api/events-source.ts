import type { AppConfig, NormalizedPage } from '../types.js';
import { HttpError } from '../types.js';
import type { HttpClient, HttpResponse } from './http-client.js';
import type { StreamAccessManager } from './stream-access.js';
import type { RateLimiter } from './middleware/rate-limit.js';
import { withRetry } from './middleware/retry.js';
import { getAuthHeaders } from './middleware/auth.js';
import { normalizePage } from '../mappers.js';
import type { Logger } from '../logger.js';

const FEED_PATH = '/events/d4ta/x7k9/feed';

export interface FetchPageParams {
  readonly limit: number;
  readonly cursor?: string | null;
  readonly since?: number;
  readonly until?: number;
}

export interface EventsSource {
  readonly fetchPage: (params: FetchPageParams) => Promise<NormalizedPage>;
}

export function createEventsSource(
  httpClient: HttpClient,
  streamManager: StreamAccessManager,
  rateLimiter: RateLimiter,
  config: AppConfig,
  logger: Logger,
): EventsSource {
  let streamDisabled = false;

  async function fetchStreamPage(params: FetchPageParams): Promise<HttpResponse> {
    const access = await streamManager.get();
    const origin = new URL(config.apiBaseUrl).origin;
    const url = new URL(`${origin}${access.endpoint || FEED_PATH}`);

    url.searchParams.set('limit', String(params.limit));
    if (params.cursor) url.searchParams.set('cursor', params.cursor);
    if (params.since) url.searchParams.set('since', String(params.since));
    if (params.until) url.searchParams.set('until', String(params.until));

    return httpClient.get(url.toString(), {
      [access.tokenHeader]: access.token,
      'X-API-Key': config.apiKey,
      'Origin': origin,
      'Referer': `${origin}/`,
    });
  }

  async function fetchFallbackPage(params: FetchPageParams): Promise<HttpResponse> {
    const url = new URL(`${config.apiBaseUrl}/events`);
    url.searchParams.set('limit', String(params.limit));
    if (params.cursor) url.searchParams.set('cursor', params.cursor);

    return httpClient.get(url.toString(), getAuthHeaders(config));
  }

  async function fetchPage(params: FetchPageParams): Promise<NormalizedPage> {
    // Pre-request rate limit delay
    const delay = rateLimiter.getPreRequestDelayMs();
    if (delay > 0) {
      await sleep(delay);
    }

    let response: HttpResponse;

    try {
      if (!streamDisabled) {
        const fetchFn = withRetry(
          () => fetchStreamPage(params),
          config,
          logger,
          'stream-fetch',
        );
        response = await fetchFn();
      } else {
        const fetchFn = withRetry(
          () => fetchFallbackPage(params),
          config,
          logger,
          'fallback-fetch',
        );
        response = await fetchFn();
      }
    } catch (err) {
      if (err instanceof HttpError && (err.status === 401 || err.status === 403) && !streamDisabled) {
        // Stream auth failed — invalidate and try to refresh
        streamManager.invalidate();
        try {
          const fetchFn = withRetry(
            () => fetchStreamPage(params),
            config,
            logger,
            'stream-fetch-retry',
          );
          response = await fetchFn();
        } catch (retryErr) {
          // Fall back to standard endpoint
          streamDisabled = true;
          const reason = retryErr instanceof Error ? retryErr.message : String(retryErr);
          logger.warn({ reason }, 'Stream disabled, falling back to /api/v1/events');

          const fetchFn = withRetry(
            () => fetchFallbackPage(params),
            config,
            logger,
            'fallback-fetch',
          );
          response = await fetchFn();
        }
      } else if (err instanceof HttpError && err.status === 429) {
        rateLimiter.record429();
        throw err;
      } else {
        throw err;
      }
    }

    // Update rate limiter from response headers
    rateLimiter.updateFromHeaders(response.headers);
    rateLimiter.recordSuccess();

    return normalizePage(response.body);
  }

  return { fetchPage };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
