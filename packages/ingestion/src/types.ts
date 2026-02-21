// ── Event types ──

export interface RawEvent {
  readonly id: string;
  readonly timestamp: unknown;
  readonly [key: string]: unknown;
}

export interface IngestionEvent {
  readonly eventId: string;
  readonly timestampMs: number;
  readonly payload: string; // JSON stringified
}

// ── API response types ──

export interface NormalizedPage {
  readonly events: readonly RawEvent[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly total: number | null;
}

export interface StreamAccess {
  readonly endpoint: string;
  readonly tokenHeader: string;
  readonly token: string;
  readonly expiresIn: number;
}

// ── Worker types ──

export const WorkerStatus = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type WorkerStatus = (typeof WorkerStatus)[keyof typeof WorkerStatus];

export interface WorkerCheckpoint {
  readonly workerId: number;
  readonly chunkStartTs: number;
  readonly chunkEndTs: number;
  readonly cursor: string | null;
  readonly lastTs: number | null;
  readonly fetchedCount: number;
  readonly insertedCount: number;
  readonly status: WorkerStatus;
}

export interface TimestampChunk {
  readonly startTs: number;
  readonly endTs: number;
}

// ── Metrics types ──

export interface WorkerMetrics {
  readonly workerId: number;
  readonly fetchedCount: number;
  readonly insertedCount: number;
  readonly status: WorkerStatus;
  readonly fetchMsEma: number | null;
  readonly dbTxMsEma: number | null;
}

export interface MetricsSnapshot {
  readonly totalFetched: number;
  readonly totalInserted: number;
  readonly throughputEps: number;
  readonly etaSeconds: number | null;
  readonly activeWorkers: number;
  readonly workers: readonly WorkerMetrics[];
  readonly uptimeSeconds: number;
  readonly rateLimitRemaining: number | null;
}

// ── Error types ──

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly url: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly errorType: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class DbError extends Error {
  constructor(
    message: string,
    readonly operation: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DbError';
  }
}

// ── Config type ──

export interface AppConfig {
  readonly databaseUrl: string;
  readonly apiBaseUrl: string;
  readonly apiKey: string;
  readonly mode: 'ingest' | 'explore';
  readonly partitionCount: number;
  readonly batchSize: number;
  readonly dbWriteConcurrency: number;
  readonly maxPendingWrites: number;
  readonly pgSyncCommit: 'on' | 'off';
  readonly healthPort: number;
  readonly autoSubmit: boolean;
  readonly githubRepoUrl: string;
  readonly minTimestampMs: number;
  readonly maxTimestampMs: number;
  readonly progressLogIntervalMs: number;
  readonly requestTimeoutMs: number;
  readonly maxRetries: number;
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}
