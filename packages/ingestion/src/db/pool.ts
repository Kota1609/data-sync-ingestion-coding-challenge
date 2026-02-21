import pg from 'pg';
import type { AppConfig } from '../types.js';
import type { Logger } from '../logger.js';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(config: AppConfig, logger: Logger): Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: config.partitionCount + config.dbWriteConcurrency + 2,
  });

  pool.on('connect', (client) => {
    if (config.pgSyncCommit === 'off') {
      client.query("SET synchronous_commit = 'off'").catch((err: unknown) => {
        logger.warn({ err }, 'Failed to set synchronous_commit=off');
      });
    }
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected pool error');
  });

  return pool;
}
