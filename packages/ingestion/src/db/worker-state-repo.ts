import type { Pool, PoolClient } from './pool.js';
import type { WorkerCheckpoint, TimestampChunk, WorkerStatus } from '../types.js';
import { DbError } from '../types.js';

/**
 * Load all worker checkpoints from the database.
 */
export async function loadWorkerCheckpoints(pool: Pool): Promise<WorkerCheckpoint[]> {
  try {
    const result = await pool.query(
      `SELECT worker_id, chunk_start_ts, chunk_end_ts, cursor,
              last_ts, fetched_count, inserted_count, status
       FROM worker_checkpoints
       ORDER BY worker_id`,
    );

    return result.rows.map((row) => ({
      workerId: row.worker_id as number,
      chunkStartTs: Number(row.chunk_start_ts),
      chunkEndTs: Number(row.chunk_end_ts),
      cursor: row.cursor as string | null,
      lastTs: row.last_ts !== null ? Number(row.last_ts) : null,
      fetchedCount: Number(row.fetched_count),
      insertedCount: Number(row.inserted_count),
      status: row.status as WorkerStatus,
    }));
  } catch (err) {
    throw new DbError('Failed to load worker checkpoints', 'loadWorkerCheckpoints', err);
  }
}

/**
 * Initialize worker checkpoints for the given chunks.
 * Idempotent — uses ON CONFLICT DO NOTHING.
 */
export async function initializeWorkerCheckpoints(
  pool: Pool,
  chunks: readonly TimestampChunk[],
): Promise<void> {
  if (chunks.length === 0) return;

  const workerIds: number[] = [];
  const startTimestamps: string[] = [];
  const endTimestamps: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    workerIds.push(i);
    startTimestamps.push(String(chunks[i]!.startTs));
    endTimestamps.push(String(chunks[i]!.endTs));
  }

  try {
    await pool.query(
      `INSERT INTO worker_checkpoints (worker_id, chunk_start_ts, chunk_end_ts)
       SELECT t.worker_id, t.chunk_start_ts, t.chunk_end_ts
       FROM unnest($1::int[], $2::bigint[], $3::bigint[])
         AS t(worker_id, chunk_start_ts, chunk_end_ts)
       ON CONFLICT (worker_id) DO NOTHING`,
      [workerIds, startTimestamps, endTimestamps],
    );
  } catch (err) {
    throw new DbError('Failed to initialize worker checkpoints', 'initializeWorkerCheckpoints', err);
  }
}

/**
 * Reset all worker checkpoints (used when partition count changes).
 */
export async function resetAllCheckpoints(pool: Pool): Promise<void> {
  try {
    await pool.query('TRUNCATE worker_checkpoints');
  } catch (err) {
    throw new DbError('Failed to reset checkpoints', 'resetAllCheckpoints', err);
  }
}

/**
 * Upsert a single worker checkpoint within an existing transaction.
 */
export async function upsertWorkerCheckpoint(
  client: PoolClient,
  checkpoint: {
    readonly workerId: number;
    readonly cursor: string | null;
    readonly lastTs: number | null;
    readonly fetchedCount: number;
    readonly insertedCount: number;
    readonly status: WorkerStatus;
  },
): Promise<void> {
  try {
    await client.query(
      `UPDATE worker_checkpoints
       SET cursor = $2,
           last_ts = $3,
           fetched_count = $4,
           inserted_count = $5,
           status = $6,
           updated_at = NOW()
       WHERE worker_id = $1`,
      [
        checkpoint.workerId,
        checkpoint.cursor,
        checkpoint.lastTs !== null ? String(checkpoint.lastTs) : null,
        String(checkpoint.fetchedCount),
        String(checkpoint.insertedCount),
        checkpoint.status,
      ],
    );
  } catch (err) {
    throw new DbError(
      `Failed to upsert checkpoint for worker ${checkpoint.workerId}`,
      'upsertWorkerCheckpoint',
      err,
    );
  }
}
