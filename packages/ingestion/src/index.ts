import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createPool } from './db/pool.js';
import { ensureSchema } from './db/schema.js';
import { createHttpClient } from './api/http-client.js';
import { createStreamAccessManager } from './api/stream-access.js';
import { createEventsSource } from './api/events-source.js';
import { createRateLimiter } from './api/middleware/rate-limit.js';
import { createDbQueue } from './core/db-queue.js';
import { createMetrics } from './core/metrics.js';
import { createOrchestrator } from './core/orchestrator.js';
import { startHealthServer } from './core/health.js';
import { submitResults } from './core/submitter.js';
import { runExploration } from './core/explore.js';
import type { Server } from 'node:http';
import type { Pool } from './db/pool.js';

const logger = createLogger();

let shutdownInProgress = false;
let healthServer: Server | null = null;
let pool: Pool | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shutdownInProgress) return;
  shutdownInProgress = true;
  logger.info({ signal }, 'Shutdown signal received');

  if (healthServer) {
    healthServer.close();
  }

  if (pool) {
    await pool.end();
  }

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });

async function main(): Promise<void> {
  const config = loadConfig();
  logger.info({ mode: config.mode, partitionCount: config.partitionCount }, 'Starting datasync-forge');

  // Initialize database
  pool = createPool(config, logger);
  await ensureSchema(pool);
  logger.info('Database schema ensured');

  // Initialize HTTP client
  const httpClient = createHttpClient(config);

  if (config.mode === 'explore') {
    await runExploration(httpClient, config, logger);
    await pool.end();
    return;
  }

  // Ingest mode
  const rateLimiter = createRateLimiter(logger);
  const streamManager = createStreamAccessManager(httpClient, config, logger);
  const source = createEventsSource(httpClient, streamManager, rateLimiter, config, logger);
  const dbQueue = createDbQueue(pool, config.dbWriteConcurrency, config.maxPendingWrites);
  const metrics = createMetrics(config.partitionCount);

  // Start health server
  healthServer = startHealthServer(config.healthPort, metrics, logger);

  // Create and run orchestrator
  const orchestrator = createOrchestrator({
    pool,
    config,
    source,
    dbQueue,
    logger,
    metrics,
  });

  // Override shutdown to use orchestrator
  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');

  const gracefulShutdown = async (signal: string): Promise<void> => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    logger.info({ signal }, 'Shutdown signal received');

    orchestrator.stopFetching();
    await dbQueue.drain();
    await orchestrator.saveAllCheckpoints();

    if (healthServer) healthServer.close();
    if (pool) await pool.end();

    logger.info('Graceful shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => { void gracefulShutdown('SIGTERM'); });
  process.on('SIGINT', () => { void gracefulShutdown('SIGINT'); });

  try {
    // Run ingestion
    await orchestrator.run();

    // Auto-submit if configured
    await submitResults(pool, httpClient, config, logger);
  } finally {
    // Guaranteed cleanup even on errors
    if (healthServer) healthServer.close();
    if (pool) await pool.end();
  }
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});
