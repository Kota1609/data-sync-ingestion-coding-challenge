# ADR 0001: Cursor Forging for Parallel Partitioning

## Status

Accepted

## Context

The DataSync API returns events in descending timestamp order with cursor-based pagination. A single client iterating through 3,000,000 events sequentially would take approximately 50-60 minutes given rate limits and network latency.

By inspecting the cursor structure (base64url-encoded JSON: `{id, ts, v, exp}`), we discovered that the API resolves cursor position by the `ts` (timestamp) field, not by `id`. This means we can synthesize ("forge") cursors to start pagination at arbitrary points in the timeline.

## Decision

We forge synthetic cursors to split the event timeline into N parallel partitions (default 8). Each worker receives a cursor pointing to its partition's upper timestamp boundary and pages backward until it reaches the lower boundary.

```typescript
function forgeCursor(timestampMs: number): string {
  return toBase64Url(JSON.stringify({
    id: "00000000-0000-0000-0000-000000000000",
    ts: timestampMs,
    v: 2,
    exp: 4102444800000, // year 2100
  }));
}
```

Each worker filters events to its `[chunkStartTs, chunkEndTs)` range and stops early when encountering events below its lower boundary.

## Consequences

### Positive
- ~8x throughput increase via parallelism (limited by rate limits and DB write speed)
- Each worker is independently resumable via per-worker checkpoints
- Partition boundaries prevent duplicate processing across workers

### Negative
- Tightly coupled to the API's cursor structure (if the format changes, forging breaks)
- Workers must handle cursor expiry mid-fetch by re-forging from `lastTs`
- Small overlap at partition boundaries requires `ON CONFLICT DO NOTHING` deduplication

### Mitigations
- Cursor expiry recovery: on HTTP 400, re-forge cursor from the last known timestamp
- Deduplication: `INSERT ... ON CONFLICT (event_id) DO NOTHING` handles any boundary overlap
- If cursor structure changes, the system falls back to sequential pagination via the standard API
