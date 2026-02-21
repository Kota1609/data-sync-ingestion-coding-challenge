import type { EventsSource, FetchPageParams } from '../api/events-source.js';
import type { DbQueue } from './db-queue.js';
import type { WorkerCheckpoint, NormalizedPage, WorkerStatus } from '../types.js';
import { HttpError, WorkerStatus as WS } from '../types.js';
import { forgeCursor } from './cursor-forge.js';
import { toIngestionEvents } from '../mappers.js';
import type { Logger } from '../logger.js';

export interface WorkerResult {
  readonly workerId: number;
  readonly fetchedCount: number;
  readonly insertedCount: number;
  readonly status: WorkerStatus;
}

export interface WorkerContext {
  readonly source: EventsSource;
  readonly dbQueue: DbQueue;
  readonly logger: Logger;
  readonly batchSize: number;
  readonly shouldStop: () => boolean;
  readonly onProgress: (workerId: number, fetched: number, inserted: number) => void;
}

export async function runWorker(
  checkpoint: WorkerCheckpoint,
  ctx: WorkerContext,
): Promise<WorkerResult> {
  const { source, dbQueue, logger, batchSize, shouldStop, onProgress } = ctx;
  const { workerId, chunkStartTs, chunkEndTs } = checkpoint;

  let cursor: string | null = checkpoint.cursor;
  let lastTs: number | null = checkpoint.lastTs;
  let fetchedCount = checkpoint.fetchedCount;
  let insertedCount = checkpoint.insertedCount;

  // If no cursor, forge one at the end of this chunk (API pages DESC by timestamp)
  if (cursor === null) {
    cursor = forgeCursor(chunkEndTs);
  }

  // Skip if already completed
  if (checkpoint.status === WS.COMPLETED) {
    logger.info({ workerId }, 'Worker already completed, skipping');
    return { workerId, fetchedCount, insertedCount, status: WS.COMPLETED };
  }

  logger.info({ workerId, chunkStartTs, chunkEndTs, resuming: checkpoint.cursor !== null },
    'Worker started');

  // Pipeline: prefetch next page while inserting current
  let fetchPromise: Promise<NormalizedPage> | null = fetchPage(source, {
    limit: batchSize,
    cursor,
  });

  let done = false;

  while (!done && !shouldStop()) {
    let page: NormalizedPage;

    try {
      page = await fetchPromise!;
    } catch (err) {
      if (err instanceof HttpError && err.status === 400 && lastTs !== null) {
        // Cursor expired mid-partition — rebuild from last known timestamp
        logger.warn({ workerId, lastTs }, 'Cursor expired, rebuilding from lastTs');
        cursor = forgeCursor(lastTs);
        fetchPromise = fetchPage(source, { limit: batchSize, cursor });
        continue;
      }
      throw err;
    }

    // Filter events to this worker's partition only
    const rawEvents = page.events;
    const allEvents = toIngestionEvents(rawEvents);
    const filtered = [];

    for (const event of allEvents) {
      if (event.timestampMs < chunkStartTs) {
        // Crossed into previous partition — stop after this batch
        done = true;
        break;
      }
      // Skip events at or above our end boundary (belong to next partition)
      if (event.timestampMs >= chunkEndTs) continue;
      filtered.push(event);
    }

    fetchedCount += rawEvents.length;

    // Update cursor and lastTs for checkpoint
    cursor = page.nextCursor;
    if (allEvents.length > 0) {
      const minTs = Math.min(...allEvents.map((e) => e.timestampMs));
      lastTs = minTs;
    }

    // Start next fetch IMMEDIATELY while we insert (pipelining)
    if (page.hasMore && !done && cursor) {
      fetchPromise = fetchPage(source, { limit: batchSize, cursor });
    } else {
      fetchPromise = null;
    }

    // Insert filtered batch + checkpoint in one transaction
    if (filtered.length > 0) {
      const inserted = await dbQueue.enqueue({
        events: filtered,
        checkpoint: {
          workerId,
          cursor,
          lastTs,
          fetchedCount,
          insertedCount,
          status: WS.RUNNING,
        },
      });
      insertedCount += inserted;
    }

    onProgress(workerId, fetchedCount, insertedCount);

    // Check completion
    if (!page.hasMore || fetchPromise === null) {
      done = true;
    }
  }

  const finalStatus = shouldStop() ? WS.RUNNING : WS.COMPLETED;

  logger.info({ workerId, fetchedCount, insertedCount, status: finalStatus },
    'Worker finished');

  return { workerId, fetchedCount, insertedCount, status: finalStatus };
}

function fetchPage(
  source: EventsSource,
  params: FetchPageParams,
): Promise<NormalizedPage> {
  return source.fetchPage(params);
}
