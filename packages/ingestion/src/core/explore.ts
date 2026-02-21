import type { HttpClient } from '../api/http-client.js';
import type { AppConfig } from '../types.js';
import { HttpError } from '../types.js';
import type { Logger } from '../logger.js';

interface ProbeResult {
  readonly endpoint: string;
  readonly status: number | string;
  readonly notes: string;
}

export async function runExploration(
  httpClient: HttpClient,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  const origin = new URL(config.apiBaseUrl).origin;
  const results: ProbeResult[] = [];

  logger.info('Starting API exploration');

  // 1. Probe documented events endpoint
  await probe(httpClient, `${config.apiBaseUrl}/events?limit=1`, {
    'X-API-Key': config.apiKey,
  }, 'GET /api/v1/events', results, logger);

  // 2. Probe hidden feed endpoint
  await probe(httpClient, `${origin}/api/v1/events/d4ta/x7k9/feed?limit=1`, {
    'X-API-Key': config.apiKey,
  }, 'GET /events/d4ta/x7k9/feed (no token)', results, logger);

  // 3. Probe bulk endpoint
  await probe(httpClient, `${origin}/api/v1/events/bulk`, {
    'X-API-Key': config.apiKey,
    'Content-Type': 'application/json',
  }, 'POST /api/v1/events/bulk', results, logger, 'POST', { ids: ['test'] });

  // 4. Probe export/download endpoints
  await probe(httpClient, `${origin}/api/v1/events/export`, {
    'X-API-Key': config.apiKey,
  }, 'GET /api/v1/events/export', results, logger);

  await probe(httpClient, `${origin}/api/v1/events/download`, {
    'X-API-Key': config.apiKey,
  }, 'GET /api/v1/events/download', results, logger);

  // 5. Probe stream access
  try {
    const streamRes = await httpClient.post(`${origin}/internal/dashboard/stream-access`, {}, {
      'Origin': origin,
      'Referer': `${origin}/`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': `dashboard_api_key=${config.apiKey}`,
      'X-API-Key': config.apiKey,
    });
    results.push({
      endpoint: 'POST /internal/dashboard/stream-access',
      status: streamRes.status,
      notes: `Token received. Body keys: ${Object.keys(streamRes.body as Record<string, unknown>).join(', ')}`,
    });
  } catch (err) {
    results.push({
      endpoint: 'POST /internal/dashboard/stream-access',
      status: err instanceof HttpError ? err.status : 'error',
      notes: err instanceof Error ? err.message : String(err),
    });
  }

  // 6. Check if gzip is supported
  await probe(httpClient, `${config.apiBaseUrl}/events?limit=10`, {
    'X-API-Key': config.apiKey,
    'Accept-Encoding': 'gzip, deflate',
  }, 'GET /events with Accept-Encoding: gzip', results, logger);

  // 7. Test undocumented query params
  await probe(httpClient, `${config.apiBaseUrl}/events?limit=1&format=csv`, {
    'X-API-Key': config.apiKey,
  }, 'GET /events?format=csv', results, logger);

  await probe(httpClient, `${config.apiBaseUrl}/events?limit=1&order=asc`, {
    'X-API-Key': config.apiKey,
  }, 'GET /events?order=asc', results, logger);

  // Print summary
  logger.info({ results }, 'Exploration complete');

  for (const result of results) {
    logger.info({
      endpoint: result.endpoint,
      status: result.status,
      notes: result.notes,
    }, 'Probe result');
  }
}

async function probe(
  httpClient: HttpClient,
  url: string,
  headers: Record<string, string>,
  label: string,
  results: ProbeResult[],
  logger: Logger,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown,
): Promise<void> {
  try {
    const response = method === 'GET'
      ? await httpClient.get(url, headers)
      : await httpClient.post(url, body, headers);

    const bodyKeys = typeof response.body === 'object' && response.body !== null
      ? Object.keys(response.body as Record<string, unknown>).join(', ')
      : typeof response.body;

    results.push({
      endpoint: label,
      status: response.status,
      notes: `OK. Response keys: ${bodyKeys}`,
    });
  } catch (err) {
    results.push({
      endpoint: label,
      status: err instanceof HttpError ? err.status : 'error',
      notes: err instanceof Error ? err.message : String(err),
    });
    logger.debug({ label, err: err instanceof Error ? err.message : String(err) }, 'Probe failed');
  }
}
