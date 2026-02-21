import { describe, it, expect, vi } from 'vitest';
import { insertEvents } from '../src/db/events-repo.js';
import type { PoolClient } from '../src/db/pool.js';
import type { IngestionEvent } from '../src/types.js';

function createMockClient(): PoolClient {
  return {
    query: vi.fn().mockResolvedValue({ rowCount: 2 }),
  } as unknown as PoolClient;
}

describe('insertEvents', () => {
  it('returns 0 for empty array', async () => {
    const client = createMockClient();
    const result = await insertEvents(client, []);
    expect(result).toBe(0);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('calls query with UNNEST and correct params', async () => {
    const client = createMockClient();
    const events: IngestionEvent[] = [
      { eventId: 'e1', timestampMs: 1000, payload: '{"id":"e1"}' },
      { eventId: 'e2', timestampMs: 2000, payload: '{"id":"e2"}' },
    ];

    const result = await insertEvents(client, events);

    expect(result).toBe(2);
    expect(client.query).toHaveBeenCalledOnce();

    const [sql, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('unnest');
    expect(sql).toContain('ON CONFLICT');
    expect(params).toHaveLength(3); // ids, timestamps, payloads
    expect((params[0] as string[])).toEqual(['e1', 'e2']);
    expect((params[1] as string[])).toEqual(['1000', '2000']);
    expect((params[2] as string[])).toEqual(['{"id":"e1"}', '{"id":"e2"}']);
  });

  it('throws DbError on query failure', async () => {
    const client = {
      query: vi.fn().mockRejectedValue(new Error('connection lost')),
    } as unknown as PoolClient;

    await expect(insertEvents(client, [
      { eventId: 'e1', timestampMs: 1000, payload: '{}' },
    ])).rejects.toThrow('Failed to insert');
  });
});
