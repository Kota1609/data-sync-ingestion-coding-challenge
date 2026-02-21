import type { MetricsSnapshot, WorkerMetrics, WorkerStatus } from '../types.js';

export interface Metrics {
  readonly updateWorker: (workerId: number, fetched: number, inserted: number, status: WorkerStatus) => void;
  readonly addInserted: (count: number) => void;
  readonly getSnapshot: () => MetricsSnapshot;
  readonly getWorkerStatuses: () => readonly WorkerMetrics[];
  readonly getTotalInserted: () => number;
  readonly getThroughputEps: () => number;
  readonly getEta: () => number | null;
}

const TARGET_EVENTS = 3_000_000;

export function createMetrics(_partitionCount: number): Metrics {
  const startTime = Date.now();
  const workers = new Map<number, WorkerMetrics>();
  let totalInserted = 0;
  let lastThroughputCalcMs = startTime;
  let lastInsertedAtCalc = 0;
  let throughputEma: number | null = null;

  function ema(prev: number | null, value: number, alpha = 0.2): number {
    return prev === null ? value : prev + alpha * (value - prev);
  }

  function updateWorker(
    workerId: number,
    fetched: number,
    inserted: number,
    status: WorkerStatus,
  ): void {
    workers.set(workerId, {
      workerId,
      fetchedCount: fetched,
      insertedCount: inserted,
      status,
      fetchMsEma: null,
      dbTxMsEma: null,
    });
  }

  function addInserted(count: number): void {
    totalInserted += count;
  }

  function recalcThroughput(): number {
    const now = Date.now();
    const elapsed = (now - startTime) / 1000;
    if (elapsed < 1) return 0;

    // Calculate overall throughput
    const currentTotal = getTotalInserted();
    const instantEps = (currentTotal - lastInsertedAtCalc) /
      Math.max(0.001, (now - lastThroughputCalcMs) / 1000);

    lastThroughputCalcMs = now;
    lastInsertedAtCalc = currentTotal;

    throughputEma = ema(throughputEma, instantEps);
    return throughputEma;
  }

  function getTotalInserted(): number {
    // Sum from worker metrics as authoritative source
    let total = 0;
    for (const w of workers.values()) {
      total += w.insertedCount;
    }
    return total || totalInserted;
  }

  function getThroughputEps(): number {
    return recalcThroughput();
  }

  function getEta(): number | null {
    const eps = getThroughputEps();
    if (eps <= 0) return null;
    const remaining = TARGET_EVENTS - getTotalInserted();
    if (remaining <= 0) return 0;
    return remaining / eps;
  }

  function getWorkerStatuses(): readonly WorkerMetrics[] {
    return Array.from(workers.values()).sort((a, b) => a.workerId - b.workerId);
  }

  function getSnapshot(): MetricsSnapshot {
    const total = getTotalInserted();
    const eps = getThroughputEps();
    const eta = getEta();
    const active = Array.from(workers.values()).filter((w) => w.status === 'running').length;

    return {
      totalFetched: Array.from(workers.values()).reduce((sum, w) => sum + w.fetchedCount, 0),
      totalInserted: total,
      throughputEps: eps,
      etaSeconds: eta,
      activeWorkers: active,
      workers: getWorkerStatuses(),
      uptimeSeconds: (Date.now() - startTime) / 1000,
      rateLimitRemaining: null,
    };
  }

  return {
    updateWorker,
    addInserted,
    getSnapshot,
    getWorkerStatuses,
    getTotalInserted,
    getThroughputEps,
    getEta,
  };
}
