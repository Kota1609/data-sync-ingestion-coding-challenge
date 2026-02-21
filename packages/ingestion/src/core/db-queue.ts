import pLimit from 'p-limit';
import type { Pool, PoolClient } from '../db/pool.js';
import type { IngestionEvent } from '../types.js';
import { insertEvents } from '../db/events-repo.js';
import { upsertWorkerCheckpoint } from '../db/worker-state-repo.js';
import type { WorkerStatus } from '../types.js';

interface WriteTask {
  readonly events: readonly IngestionEvent[];
  readonly checkpoint: {
    readonly workerId: number;
    readonly cursor: string | null;
    readonly lastTs: number | null;
    readonly fetchedCount: number;
    readonly insertedCount: number;
    readonly status: WorkerStatus;
  };
}

export interface DbQueue {
  readonly enqueue: (task: WriteTask) => Promise<number>;
  readonly drain: () => Promise<void>;
  readonly pendingCount: () => number;
}

export function createDbQueue(
  pool: Pool,
  concurrency: number,
  maxPending: number,
): DbQueue {
  const limiter = pLimit(concurrency);
  const pending = new Set<Promise<number>>();

  async function executeWrite(task: WriteTask): Promise<number> {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await insertEvents(client, task.events);
      await upsertWorkerCheckpoint(client, task.checkpoint);
      await client.query('COMMIT');
      return inserted;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {/* ignore rollback errors */});
      throw err;
    } finally {
      client.release();
    }
  }

  async function enqueue(task: WriteTask): Promise<number> {
    // Backpressure: wait for queue to drain below max
    while (pending.size >= maxPending) {
      await Promise.race(pending).catch(() => {/* errors handled by caller */});
    }

    const promise = limiter(() => executeWrite(task));
    pending.add(promise);
    promise.finally(() => pending.delete(promise));

    return promise;
  }

  async function drain(): Promise<void> {
    while (pending.size > 0) {
      await Promise.allSettled(Array.from(pending));
    }
  }

  function pendingCount(): number {
    return pending.size;
  }

  return { enqueue, drain, pendingCount };
}
