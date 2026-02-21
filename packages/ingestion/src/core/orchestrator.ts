import type { Pool } from '../db/pool.js';
import type { AppConfig } from '../types.js';
import { WorkerStatus as WS } from '../types.js';
import type { EventsSource } from '../api/events-source.js';
import type { DbQueue } from './db-queue.js';
import type { Logger } from '../logger.js';
import { createTimestampChunks } from './cursor-forge.js';
import { discoverTimeRange } from './time-range.js';
import {
  loadWorkerCheckpoints,
  initializeWorkerCheckpoints,
  resetAllCheckpoints,
} from '../db/worker-state-repo.js';
import { runWorker } from './worker.js';
import type { Metrics } from './metrics.js';

export interface OrchestratorDeps {
  readonly pool: Pool;
  readonly config: AppConfig;
  readonly source: EventsSource;
  readonly dbQueue: DbQueue;
  readonly logger: Logger;
  readonly metrics: Metrics;
}

export interface Orchestrator {
  readonly run: () => Promise<void>;
  readonly stopFetching: () => void;
  readonly saveAllCheckpoints: () => Promise<void>;
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { pool, config, source, dbQueue, logger, metrics } = deps;
  let stopping = false;

  function stopFetching(): void {
    stopping = true;
  }

  async function run(): Promise<void> {
    logger.info({
      partitionCount: config.partitionCount,
      batchSize: config.batchSize,
      dbWriteConcurrency: config.dbWriteConcurrency,
      pgSyncCommit: config.pgSyncCommit,
    }, 'Orchestrator starting');

    // 1. Discover time range
    const timeRange = await discoverTimeRange(
      source,
      config.minTimestampMs,
      config.maxTimestampMs,
      logger,
    );

    // 2. Create timestamp chunks
    const chunks = createTimestampChunks(
      timeRange.startTs,
      timeRange.endTs,
      config.partitionCount,
    );

    // 3. Load existing checkpoints and detect config changes
    const savedCheckpoints = await loadWorkerCheckpoints(pool);

    if (savedCheckpoints.length > 0 && savedCheckpoints.length !== config.partitionCount) {
      logger.warn(
        { saved: savedCheckpoints.length, current: config.partitionCount },
        'Partition count changed — resetting all checkpoints',
      );
      await resetAllCheckpoints(pool);
    }

    // 4. Initialize checkpoints for new workers
    await initializeWorkerCheckpoints(pool, chunks);

    // 5. Load final checkpoint state
    const checkpoints = await loadWorkerCheckpoints(pool);

    // 6. Filter out already-completed workers
    const activeCheckpoints = checkpoints.filter((cp) => cp.status !== WS.COMPLETED);

    if (activeCheckpoints.length === 0) {
      logger.info('All workers already completed');
      return;
    }

    logger.info({
      totalWorkers: checkpoints.length,
      activeWorkers: activeCheckpoints.length,
      completedWorkers: checkpoints.length - activeCheckpoints.length,
    }, 'Workers initialized');

    // 7. Start progress logging
    const progressInterval = setInterval(() => {
      const snapshot = metrics.getSnapshot();
      logger.info({
        totalInserted: snapshot.totalInserted,
        throughputEps: Math.round(snapshot.throughputEps),
        etaSeconds: snapshot.etaSeconds !== null ? Math.round(snapshot.etaSeconds) : null,
        activeWorkers: snapshot.activeWorkers,
        pendingWrites: dbQueue.pendingCount(),
      }, `Progress: ${snapshot.totalInserted.toLocaleString()} / 3,000,000 (${((snapshot.totalInserted / 3_000_000) * 100).toFixed(1)}%)`);
    }, config.progressLogIntervalMs);

    // 8. Launch workers with staggered starts
    const workerPromises = activeCheckpoints.map((checkpoint, index) => {
      const delay = index * 500; // 500ms stagger
      return new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          runWorker(checkpoint, {
            source,
            dbQueue,
            logger,
            batchSize: config.batchSize,
            shouldStop: () => stopping,
            onProgress: (workerId, fetched, inserted) => {
              metrics.updateWorker(workerId, fetched, inserted, WS.RUNNING);
            },
          }).then((result) => {
            metrics.updateWorker(result.workerId, result.fetchedCount, result.insertedCount, result.status);
            resolve();
          }).catch(reject);
        }, delay);
      });
    });

    let workerFailures: PromiseRejectedResult[] = [];
    try {
      const results = await Promise.allSettled(workerPromises);
      workerFailures = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      for (const f of workerFailures) {
        logger.error({ reason: f.reason }, 'Worker failed');
      }
    } finally {
      clearInterval(progressInterval);
      // Drain remaining writes even if a worker failed
      await dbQueue.drain();
    }

    // 10. Final progress log
    const finalSnapshot = metrics.getSnapshot();

    if (workerFailures.length > 0) {
      logger.error({
        totalInserted: finalSnapshot.totalInserted,
        failedWorkers: workerFailures.length,
      }, `${workerFailures.length} worker(s) failed`);
      throw new Error(`${workerFailures.length} worker(s) failed during ingestion`);
    }

    logger.info({
      totalInserted: finalSnapshot.totalInserted,
      throughputEps: Math.round(finalSnapshot.throughputEps),
      uptimeSeconds: Math.round(finalSnapshot.uptimeSeconds),
    }, 'ingestion complete');
  }

  async function saveAllCheckpoints(): Promise<void> {
    // Checkpoints are saved transactionally with each batch insert.
    // This is a no-op since the DB queue handles it.
    logger.info('All checkpoints are up to date (saved transactionally)');
  }

  return { run, stopFetching, saveAllCheckpoints };
}
