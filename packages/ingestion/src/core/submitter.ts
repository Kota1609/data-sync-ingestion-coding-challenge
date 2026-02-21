import type { Pool } from '../db/pool.js';
import type { AppConfig } from '../types.js';
import type { HttpClient } from '../api/http-client.js';
import type { Logger } from '../logger.js';

export async function submitResults(
  pool: Pool,
  httpClient: HttpClient,
  config: AppConfig,
  logger: Logger,
): Promise<void> {
  if (!config.autoSubmit) {
    logger.info('Auto-submit disabled, skipping submission');
    return;
  }

  if (!config.githubRepoUrl) {
    logger.warn('AUTO_SUBMIT is true but GITHUB_REPO_URL is not set, skipping');
    return;
  }

  logger.info('Exporting event IDs for submission...');

  // Stream event IDs from DB
  const result = await pool.query('SELECT event_id FROM ingested_events ORDER BY event_id');
  const ids = result.rows.map((row) => (row as { event_id: string }).event_id).join('\n');

  logger.info({ eventCount: result.rows.length }, 'Submitting event IDs');

  const origin = new URL(config.apiBaseUrl).origin;
  const url = `${origin}/api/v1/submissions?github_repo=${encodeURIComponent(config.githubRepoUrl)}`;

  try {
    const response = await httpClient.post(url, ids, {
      'X-API-Key': config.apiKey,
      'Content-Type': 'text/plain',
    });

    const body = response.body as Record<string, unknown>;
    const data = body['data'] as Record<string, unknown> | undefined;

    logger.info({
      submissionId: data?.['submissionId'],
      eventCount: data?.['eventCount'],
      timeToSubmit: data?.['timeToSubmit'],
    }, 'Submission complete');
  } catch (err) {
    logger.error({ err }, 'Submission failed');
  }
}
