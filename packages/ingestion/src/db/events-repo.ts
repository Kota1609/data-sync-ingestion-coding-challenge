import type { PoolClient } from './pool.js';
import type { IngestionEvent } from '../types.js';
import { DbError } from '../types.js';

/**
 * Bulk insert events using PostgreSQL UNNEST for optimal performance.
 * Uses ON CONFLICT DO NOTHING for idempotent writes.
 * Returns the number of actually inserted rows (excludes duplicates).
 */
export async function insertEvents(
  client: PoolClient,
  events: readonly IngestionEvent[],
): Promise<number> {
  if (events.length === 0) return 0;

  const ids: string[] = [];
  const timestamps: string[] = [];
  const payloads: string[] = [];

  for (const event of events) {
    ids.push(event.eventId);
    timestamps.push(String(event.timestampMs));
    payloads.push(event.payload);
  }

  try {
    const result = await client.query(
      `INSERT INTO ingested_events (event_id, timestamp_ms, payload)
       SELECT t.event_id, t.timestamp_ms, t.payload::jsonb
       FROM unnest($1::text[], $2::bigint[], $3::text[])
         AS t(event_id, timestamp_ms, payload)
       ON CONFLICT (event_id) DO NOTHING`,
      [ids, timestamps, payloads],
    );
    return result.rowCount ?? 0;
  } catch (err) {
    throw new DbError(
      `Failed to insert ${events.length} events`,
      'insertEvents',
      err,
    );
  }
}
