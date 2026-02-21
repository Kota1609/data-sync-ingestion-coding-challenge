import { createServer, type Server } from 'node:http';
import type { Metrics } from './metrics.js';
import type { Logger } from '../logger.js';

export function startHealthServer(
  port: number,
  metrics: Metrics,
  logger: Logger,
): Server {
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      const snapshot = metrics.getSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'healthy',
        uptime: Math.round(snapshot.uptimeSeconds),
        totalInserted: snapshot.totalInserted,
        throughputEps: Math.round(snapshot.throughputEps),
        activeWorkers: snapshot.activeWorkers,
      }));
      return;
    }

    if (req.url === '/metrics') {
      const snapshot = metrics.getSnapshot();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(snapshot));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(port, () => {
    logger.info({ port }, 'Health server started');
  });

  return server;
}
