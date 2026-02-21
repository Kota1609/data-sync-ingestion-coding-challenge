import { describe, it, expect, vi } from 'vitest';
import { runWorker, type WorkerContext } from '../src/core/worker.js';
import type { WorkerCheckpoint, NormalizedPage } from '../src/types.js';
import type { EventsSource } from '../src/api/events-source.js';
import type { DbQueue } from '../src/core/db-queue.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

function createMockSource(pages: NormalizedPage[]): EventsSource {
  let callCount = 0;
  return {
    fetchPage: vi.fn().mockImplementation(async () => {
      const page = pages[callCount];
      callCount++;
      return page ?? { events: [], hasMore: false, nextCursor: null, total: null };
    }),
  };
}

function createMockDbQueue(): DbQueue {
  return {
    enqueue: vi.fn().mockImplementation(async (task) => task.events.length),
    drain: vi.fn().mockResolvedValue(undefined),
    pendingCount: vi.fn().mockReturnValue(0),
  };
}

describe('runWorker', () => {
  it('processes pages until hasMore is false', async () => {
    const source = createMockSource([
      {
        events: [
          { id: 'e1', timestamp: 1768500000000 },
          { id: 'e2', timestamp: 1768400000000 },
        ],
        hasMore: true,
        nextCursor: 'cursor-2',
        total: null,
      },
      {
        events: [
          { id: 'e3', timestamp: 1768300000000 },
        ],
        hasMore: false,
        nextCursor: null,
        total: null,
      },
    ]);

    const dbQueue = createMockDbQueue();

    const checkpoint: WorkerCheckpoint = {
      workerId: 0,
      chunkStartTs: 1768000000000,
      chunkEndTs: 1769000000000,
      cursor: null,
      lastTs: null,
      fetchedCount: 0,
      insertedCount: 0,
      status: 'running',
    };

    const ctx: WorkerContext = {
      source,
      dbQueue,
      logger,
      batchSize: 5000,
      shouldStop: () => false,
      onProgress: vi.fn(),
    };

    const result = await runWorker(checkpoint, ctx);

    expect(result.status).toBe('completed');
    expect(result.fetchedCount).toBeGreaterThan(0);
    expect(source.fetchPage).toHaveBeenCalledTimes(2);
  });

  it('stops when shouldStop returns true', async () => {
    let stopAfter = 1;
    const source = createMockSource([
      {
        events: [{ id: 'e1', timestamp: 1768500000000 }],
        hasMore: true,
        nextCursor: 'cursor-2',
        total: null,
      },
      {
        events: [{ id: 'e2', timestamp: 1768400000000 }],
        hasMore: true,
        nextCursor: 'cursor-3',
        total: null,
      },
    ]);

    const dbQueue = createMockDbQueue();

    const checkpoint: WorkerCheckpoint = {
      workerId: 0,
      chunkStartTs: 1768000000000,
      chunkEndTs: 1769000000000,
      cursor: null,
      lastTs: null,
      fetchedCount: 0,
      insertedCount: 0,
      status: 'running',
    };

    const ctx: WorkerContext = {
      source,
      dbQueue,
      logger,
      batchSize: 5000,
      shouldStop: () => {
        stopAfter--;
        return stopAfter < 0;
      },
      onProgress: vi.fn(),
    };

    const result = await runWorker(checkpoint, ctx);

    // Should stop before processing all pages
    expect(result.status).toBe('running');
  });

  it('filters events outside chunk boundary', async () => {
    const source = createMockSource([
      {
        events: [
          { id: 'in-range', timestamp: 1768500000000 },
          { id: 'below-range', timestamp: 1767000000000 }, // Below chunkStartTs
        ],
        hasMore: false,
        nextCursor: null,
        total: null,
      },
    ]);

    const dbQueue = createMockDbQueue();

    const checkpoint: WorkerCheckpoint = {
      workerId: 0,
      chunkStartTs: 1768000000000,
      chunkEndTs: 1769000000000,
      cursor: null,
      lastTs: null,
      fetchedCount: 0,
      insertedCount: 0,
      status: 'running',
    };

    const ctx: WorkerContext = {
      source,
      dbQueue,
      logger,
      batchSize: 5000,
      shouldStop: () => false,
      onProgress: vi.fn(),
    };

    await runWorker(checkpoint, ctx);

    // The enqueue call should only contain the in-range event
    const enqueueCall = (dbQueue.enqueue as ReturnType<typeof vi.fn>).mock.calls[0];
    if (enqueueCall) {
      const task = enqueueCall[0] as { events: Array<{ eventId: string }> };
      const eventIds = task.events.map((e) => e.eventId);
      expect(eventIds).toContain('in-range');
      expect(eventIds).not.toContain('below-range');
    }
  });

  it('skips already completed workers', async () => {
    const source = createMockSource([]);
    const dbQueue = createMockDbQueue();

    const checkpoint: WorkerCheckpoint = {
      workerId: 0,
      chunkStartTs: 1768000000000,
      chunkEndTs: 1769000000000,
      cursor: null,
      lastTs: null,
      fetchedCount: 5000,
      insertedCount: 5000,
      status: 'completed',
    };

    const ctx: WorkerContext = {
      source,
      dbQueue,
      logger,
      batchSize: 5000,
      shouldStop: () => false,
      onProgress: vi.fn(),
    };

    const result = await runWorker(checkpoint, ctx);

    expect(result.status).toBe('completed');
    expect(source.fetchPage).not.toHaveBeenCalled();
  });
});
