import type { AppConfig } from './types.js';

function mustGetEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getEnv(key: string, fallback: string): string {
  const value = process.env[key];
  return value !== undefined && value !== '' ? value : fallback;
}

function getIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${key} must be a valid integer, got: ${raw}`);
  }
  return parsed;
}

function getBoolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export function loadConfig(): AppConfig {
  const mode = getEnv('MODE', 'ingest');
  if (mode !== 'ingest' && mode !== 'explore') {
    throw new Error(`MODE must be "ingest" or "explore", got: ${mode}`);
  }

  const pgSyncCommit = getEnv('PG_SYNC_COMMIT', 'off');
  if (pgSyncCommit !== 'on' && pgSyncCommit !== 'off') {
    throw new Error(`PG_SYNC_COMMIT must be "on" or "off", got: ${pgSyncCommit}`);
  }

  const minTimestampMs = getIntEnv('MIN_TIMESTAMP_MS', 1766700000000);
  const maxTimestampMs = getIntEnv('MAX_TIMESTAMP_MS', 1769900000000);
  if (minTimestampMs >= maxTimestampMs) {
    throw new Error(`MIN_TIMESTAMP_MS (${minTimestampMs}) must be less than MAX_TIMESTAMP_MS (${maxTimestampMs})`);
  }

  return {
    databaseUrl: mustGetEnv('DATABASE_URL'),
    apiBaseUrl: normalizeApiBaseUrl(mustGetEnv('API_BASE_URL')),
    apiKey: mustGetEnv('TARGET_API_KEY'),
    mode,
    partitionCount: Math.max(1, getIntEnv('PARTITION_COUNT', 8)),
    batchSize: Math.min(5000, Math.max(1, getIntEnv('BATCH_SIZE', 5000))),
    dbWriteConcurrency: Math.max(1, getIntEnv('DB_WRITE_CONCURRENCY', 2)),
    maxPendingWrites: Math.max(1, getIntEnv('MAX_PENDING_WRITES', 100)),
    pgSyncCommit,
    healthPort: getIntEnv('HEALTH_PORT', 8080),
    autoSubmit: getBoolEnv('AUTO_SUBMIT', false),
    githubRepoUrl: getEnv('GITHUB_REPO_URL', ''),
    minTimestampMs,
    maxTimestampMs,
    progressLogIntervalMs: getIntEnv('PROGRESS_LOG_INTERVAL_MS', 15000),
    requestTimeoutMs: getIntEnv('REQUEST_TIMEOUT_MS', 45000),
    maxRetries: getIntEnv('MAX_RETRIES', 8),
    retryBaseMs: getIntEnv('RETRY_BASE_MS', 250),
    retryMaxMs: getIntEnv('RETRY_MAX_MS', 15000),
  };
}

function normalizeApiBaseUrl(url: string): string {
  // Strip trailing slash
  let normalized = url.replace(/\/+$/, '');
  // If URL ends with /api/v1, keep it; otherwise append
  if (!normalized.endsWith('/api/v1')) {
    normalized = `${normalized}/api/v1`;
  }
  return normalized;
}
