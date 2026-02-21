import type { Pool } from './pool.js';
import { DbError } from '../types.js';

const CREATE_INGESTED_EVENTS = `
  CREATE TABLE IF NOT EXISTS ingested_events (
    event_id TEXT PRIMARY KEY,
    timestamp_ms BIGINT NOT NULL,
    payload JSONB NOT NULL,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const CREATE_WORKER_CHECKPOINTS = `
  CREATE TABLE IF NOT EXISTS worker_checkpoints (
    worker_id INTEGER PRIMARY KEY,
    chunk_start_ts BIGINT NOT NULL,
    chunk_end_ts BIGINT NOT NULL,
    cursor TEXT,
    last_ts BIGINT,
    fetched_count BIGINT NOT NULL DEFAULT 0,
    inserted_count BIGINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

export async function ensureSchema(pool: Pool): Promise<void> {
  try {
    await pool.query(CREATE_INGESTED_EVENTS);
    await pool.query(CREATE_WORKER_CHECKPOINTS);
  } catch (err) {
    throw new DbError('Failed to create schema', 'ensureSchema', err);
  }
}
