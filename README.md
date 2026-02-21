# DataSync Ingestion

A high-throughput, production-ready ingestion system that extracts 3,000,000 events from the DataSync Analytics API into PostgreSQL using parallel cursor-forged partitions.

## How to Run

```bash
sh run-ingestion.sh
```

This starts PostgreSQL and the ingestion service via Docker Compose, then monitors progress until completion. No manual steps required.

### Prerequisites

- Docker and Docker Compose

### Environment Variables

Copy `.env.example` and fill in your API key:

```bash
cp .env.example .env
# Edit .env with your TARGET_API_KEY
```

Key configuration (all have sensible defaults):

| Variable | Default | Description |
|---|---|---|
| `TARGET_API_KEY` | (required) | Your DataSync API key |
| `DATABASE_URL` | (from compose) | PostgreSQL connection string |
| `API_BASE_URL` | (from compose) | DataSync API base URL |
| `PARTITION_COUNT` | 8 | Number of parallel workers |
| `BATCH_SIZE` | 5000 | Events per API page (max 5000) |
| `PG_SYNC_COMMIT` | off | PostgreSQL synchronous_commit setting |
| `AUTO_SUBMIT` | false | Auto-submit results after completion |

### Exploration Mode

Probe the API for undocumented endpoints and capabilities:

```bash
docker compose run --rm -e MODE=explore ingestion
```

## Architecture

```
                    ┌─────────────────────┐
                    │   Orchestrator      │
                    │  (progress, health) │
                    └─────────┬───────────┘
                              │ launches 8 workers
          ┌───────────────────┼───────────────────┐
          │         │         │         │         │
     ┌────┴───┐ ┌───┴───┐ ┌──┴────┐   ...   ┌───┴───┐
     │Worker 0│ │Worker 1│ │Worker 2│        │Worker 7│
     │ts[0,T₁)│ │ts[T₁,T₂)│ │ts[T₂,T₃)│     │ts[T₇,∞)│
     └───┬────┘ └───┬────┘ └───┬────┘        └───┬────┘
         │ fetch     │ fetch    │ fetch           │ fetch
         │ + insert  │ + insert │ + insert        │ + insert
         │ pipelined │ pipelined│ pipelined       │ pipelined
         ▼           ▼          ▼                 ▼
    ┌─────────────────────────────────────────────────┐
    │  PostgreSQL (UNNEST bulk insert, ON CONFLICT)   │
    │  synchronous_commit = off                        │
    └─────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Cursor Forging** — Decoded the API's base64url cursor (`{id, ts, v, exp}`) and discovered position resolves by `ts`. We forge synthetic cursors to start 8 workers at different timeline positions, achieving ~8x parallelism. See [ADR 0001](docs/adr/0001-cursor-forging.md).

2. **Per-Worker Fetch/Insert Pipelining** — Each worker starts fetching the next page while the current batch is being inserted into PostgreSQL. This overlaps network I/O with database writes.

3. **Transactional Checkpoints** — Event inserts and worker checkpoint updates are atomic (single `BEGIN`/`COMMIT`). Crash-safe resumption with no duplicate or lost progress. See [ADR 0002](docs/adr/0002-checkpoint-strategy.md).

4. **UNNEST Bulk Inserts** — Uses PostgreSQL `unnest($1::text[], $2::bigint[], $3::text[])` for batch inserts instead of multi-row `VALUES`, reducing query parsing overhead.

5. **Stream-First with Fallback** — Primary path uses the dashboard's internal stream endpoint for potentially higher throughput; automatically falls back to `/api/v1/events` on auth failure.

6. **Adaptive Rate Limiting** — Pre-request delay based on `X-RateLimit-*` headers with exponential backoff (1.3x up, 0.5x decay) for endpoints without rate limit headers.

### Performance Optimizations

- **HTTP keep-alive** via undici Agent (saves ~50-100ms per request on TCP handshake)
- **Gzip compression** (`Accept-Encoding: gzip`) reduces response transfer size by ~80%
- **`synchronous_commit = off`** at PostgreSQL session level for faster writes
- **Connection pool sized** to `partitionCount + dbWriteConcurrency + 2`
- **Partition boundary filtering** — workers skip events outside their timestamp range and stop early

### Resilience

- **Resumable**: per-worker checkpoints survive crashes, restarts pick up where each worker left off
- **Cursor expiry**: on HTTP 400, re-forges cursor from the last known timestamp
- **Config change detection**: if partition count changes between runs, checkpoints auto-reset
- **Graceful shutdown**: SIGTERM/SIGINT triggers orderly drain of write queues, checkpoint saves, then pool close
- **Retry with backoff**: exponential backoff + jitter for 5xx errors, Retry-After header parsing for 429s

### Monitoring

- **Health server** at `http://localhost:8080/health` — worker statuses, total ingested, throughput
- **Metrics endpoint** at `http://localhost:8080/metrics` — full EMA-based throughput snapshot
- **Progress logging** every 15 seconds with per-worker breakdown and ETA

## API Discoveries

1. **Cursor structure**: base64url-encoded JSON `{id, ts, v, exp}` — position resolves by `ts`, enabling parallel partitioning via cursor forging
2. **Stream endpoint**: `/api/v1/events/d4ta/x7k9/feed` accessible via dashboard stream tokens from `POST /internal/dashboard/stream-access`
3. **Cursors expire**: forged cursors with far-future `exp` avoid mid-fetch expiry; recovery by re-forging from `lastTs`
4. **Events are descending**: API returns events newest-first, so workers page backward through their partition
5. **Rate limits**: `X-RateLimit-Remaining` and `X-RateLimit-Reset` headers present on responses

## Project Structure

```
packages/ingestion/
├── src/
│   ├── index.ts              # Entry point, graceful shutdown
│   ├── config.ts             # Environment parsing + validation
│   ├── logger.ts             # Pino with credential redaction
│   ├── types.ts              # Shared types + error classes
│   ├── mappers.ts            # Timestamp/page normalization
│   ├── api/
│   │   ├── http-client.ts    # undici-based fetch with keep-alive + gzip
│   │   ├── stream-access.ts  # Dashboard token lifecycle
│   │   ├── events-source.ts  # Stream-first + /api/v1 fallback
│   │   └── middleware/       # Auth, rate-limit, retry
│   ├── core/
│   │   ├── orchestrator.ts   # Worker coordination + progress
│   │   ├── worker.ts         # Pipelined fetch loop
│   │   ├── cursor-forge.ts   # Synthetic cursor generation
│   │   ├── db-queue.ts       # Bounded write queue + backpressure
│   │   ├── metrics.ts        # EMA throughput tracking
│   │   ├── health.ts         # HTTP health/metrics server
│   │   ├── submitter.ts      # Auto-submit event IDs
│   │   └── explore.ts        # API exploration probes
│   └── db/
│       ├── pool.ts           # pg Pool with sync_commit=off
│       ├── schema.ts         # Idempotent table creation
│       ├── events-repo.ts    # UNNEST bulk insert
│       └── worker-state-repo.ts  # Checkpoint CRUD
└── test/                     # 56 tests across 9 suites
```

## Testing

```bash
cd packages/ingestion
npm install
npm test
```

9 test suites, 56 tests covering:
- Cursor forging and decoding
- Timestamp normalization (epoch ms, seconds, ISO 8601, strings)
- Event/page mappers
- Config parsing and validation
- Rate limiter adaptive backoff
- Retry logic and Retry-After parsing
- Events repo (UNNEST query construction)
- Worker state repo (checkpoint save/load)
- Worker integration (pagination, early stop, boundary filtering)

## Results

| Metric | Value |
|---|---|
| Total events ingested | 3,000,000 |
| Time to complete + submit | 27 minutes |
| Peak throughput | ~4,000 events/sec |
| Workers | 8 parallel partitions |
| Batch size | 5,000 events/page |
| Resumability | Verified — restart picks up from checkpoints |

## What I'd Improve With More Time

- **Dynamic time range discovery** — probe the API to find actual min/max timestamps instead of using configured bounds
- **Adaptive partition count** — benchmark initial pages and auto-tune worker count based on observed rate limits
- **Prometheus metrics** — expose metrics in Prometheus format for Grafana dashboards
- **Streaming inserts** — use `COPY` protocol instead of `INSERT ... SELECT unnest()` for even faster bulk loads
- **Multiple stream tokens** — test if rate limits are per-token, potentially multiplying throughput
- **End-to-end integration tests** — test against a mock HTTP server with realistic pagination and rate limiting

## AI Tools Disclosure

**Claude Code (Claude Opus)** was used throughout development for:
- Architecture planning and design decisions
- Code generation for all source files
- Test suite creation
- Documentation and ADR authoring
- Iterative code review and refinement

All generated code was reviewed and refined through multiple iterations to ensure correctness, type safety, and adherence to the project's coding standards defined in `CLAUDE.md`.
