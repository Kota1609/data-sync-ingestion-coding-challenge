import type { AppConfig, StreamAccess } from '../types.js';
import { HttpError } from '../types.js';
import type { HttpClient } from './http-client.js';
import type { Logger } from '../logger.js';

interface CachedStreamAccess {
  readonly access: StreamAccess;
  readonly expiresAtMs: number;
}

const REFRESH_BUFFER_S = 60;

export function createStreamAccessManager(
  httpClient: HttpClient,
  config: AppConfig,
  logger: Logger,
): {
  readonly get: () => Promise<StreamAccess>;
  readonly invalidate: () => void;
} {
  let cached: CachedStreamAccess | null = null;
  let refreshInFlight: Promise<StreamAccess> | null = null;

  function getBaseOrigin(): string {
    // Extract origin from API base URL
    const url = new URL(config.apiBaseUrl);
    return url.origin;
  }

  async function fetchStreamAccess(): Promise<StreamAccess> {
    const origin = getBaseOrigin();
    const url = `${origin}/internal/dashboard/stream-access`;

    logger.info('Requesting stream access token');

    try {
      const response = await httpClient.post(url, {}, {
        'Origin': origin,
        'Referer': `${origin}/`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Cookie': `dashboard_api_key=${config.apiKey}`,
        'X-API-Key': config.apiKey,
      });

      const body = response.body as Record<string, unknown>;
      const streamAccess = body['streamAccess'] as Record<string, unknown> | undefined;

      if (!streamAccess || typeof streamAccess['token'] !== 'string') {
        throw new Error('Invalid stream access response');
      }

      return {
        endpoint: streamAccess['endpoint'] as string,
        tokenHeader: streamAccess['tokenHeader'] as string,
        token: streamAccess['token'] as string,
        expiresIn: streamAccess['expiresIn'] as number,
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(
        `Stream access failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
        'POST',
        url,
      );
    }
  }

  async function get(): Promise<StreamAccess> {
    const now = Date.now();

    // Return cached if still valid
    if (cached && now < cached.expiresAtMs) {
      return cached.access;
    }

    // Deduplicate concurrent refresh requests
    if (refreshInFlight) {
      return refreshInFlight;
    }

    refreshInFlight = fetchStreamAccess().then((access) => {
      const expiresAtMs = now + Math.max(0, access.expiresIn - REFRESH_BUFFER_S) * 1000;
      cached = { access, expiresAtMs };
      logger.info({ expiresIn: access.expiresIn }, 'Stream access token acquired');
      return access;
    }).finally(() => {
      refreshInFlight = null;
    });

    return refreshInFlight;
  }

  function invalidate(): void {
    cached = null;
  }

  return { get, invalidate };
}

export type StreamAccessManager = ReturnType<typeof createStreamAccessManager>;
