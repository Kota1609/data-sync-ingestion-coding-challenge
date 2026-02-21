# ADR 0002: Transactional Checkpoint Strategy

## Status

Accepted

## Context

The ingestion system must be resumable after crashes. With 8 parallel workers each paginating independently, we need a way to track each worker's progress so it can resume from where it left off.

Two approaches were considered:

1. **Separate checkpoint writes** — insert events, then update checkpoint in a separate query
2. **Transactional checkpoint** — insert events and update checkpoint atomically in a single transaction

## Decision

We use transactional checkpoints: each batch insert and its corresponding checkpoint update are wrapped in a single PostgreSQL transaction (`BEGIN` / `COMMIT`).

```typescript
await client.query('BEGIN');
const inserted = await insertEvents(client, events);
await upsertWorkerCheckpoint(client, {
  workerId, cursor, lastTs, fetchedCount, insertedCount, status,
});
await client.query('COMMIT');
```

Checkpoint state includes:
- `worker_id` — partition identifier
- `cursor` — last API cursor for resumption
- `last_ts` — last event timestamp (for cursor re-forging on expiry)
- `fetched_count` / `inserted_count` — progress counters
- `status` — running | completed | failed
- `chunk_start_ts` / `chunk_end_ts` — partition boundaries

## Consequences

### Positive
- **Crash safety**: if the process dies mid-transaction, both the events and the checkpoint roll back — no progress is lost and no phantom state
- **Exact resumption**: on restart, each worker reads its checkpoint and resumes from the saved cursor
- **Config change detection**: if partition count changes between runs, all checkpoints are reset to avoid data gaps

### Negative
- Slightly higher write latency per batch due to transaction overhead
- Requires a dedicated `worker_checkpoints` table

### Mitigations
- `synchronous_commit = off` at the session level reduces transaction overhead (acceptable since worst case on crash is re-fetching one batch)
- Checkpoint table is small (one row per worker) and uses `UPDATE` by primary key
