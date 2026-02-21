import { describe, it, expect, vi } from 'vitest';
import { upsertWorkerCheckpoint } from '../src/db/worker-state-repo.js';
import type { PoolClient } from '../src/db/pool.js';

function createMockClient(): PoolClient {
  return {
    query: vi.fn().mockResolvedValue({ rowCount: 1 }),
  } as unknown as PoolClient;
}

describe('upsertWorkerCheckpoint', () => {
  it('calls UPDATE with correct parameters', async () => {
    const client = createMockClient();

    await upsertWorkerCheckpoint(client, {
      workerId: 3,
      cursor: 'cursor-abc',
      lastTs: 1768000000000,
      fetchedCount: 5000,
      insertedCount: 4999,
      status: 'running',
    });

    expect(client.query).toHaveBeenCalledOnce();
    const [sql, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE worker_checkpoints');
    expect(params[0]).toBe(3); // workerId
    expect(params[1]).toBe('cursor-abc'); // cursor
    expect(params[2]).toBe('1768000000000'); // lastTs
    expect(params[5]).toBe('running'); // status
  });

  it('handles null cursor and lastTs', async () => {
    const client = createMockClient();

    await upsertWorkerCheckpoint(client, {
      workerId: 0,
      cursor: null,
      lastTs: null,
      fetchedCount: 0,
      insertedCount: 0,
      status: 'running',
    });

    const [, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBeNull(); // cursor
    expect(params[2]).toBeNull(); // lastTs
  });

  it('throws DbError on failure', async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error('deadlock')),
    } as unknown as PoolClient;

    await expect(upsertWorkerCheckpoint(client, {
      workerId: 0,
      cursor: null,
      lastTs: null,
      fetchedCount: 0,
      insertedCount: 0,
      status: 'running',
    })).rejects.toThrow('Failed to upsert');
  });
});
