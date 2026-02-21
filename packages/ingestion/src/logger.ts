import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(): Logger {
  return pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'apiKey',
        '*.apiKey',
        'token',
        '*.token',
        'TARGET_API_KEY',
        '*.TARGET_API_KEY',
        'authorization',
        '*.authorization',
      ],
      remove: true,
    },
  });
}
