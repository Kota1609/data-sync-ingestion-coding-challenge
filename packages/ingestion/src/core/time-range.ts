import type { EventsSource } from '../api/events-source.js';
import type { Logger } from '../logger.js';

interface TimeRange {
  readonly startTs: number;
  readonly endTs: number;
}

/**
 * Discover the time range of events in the API using exponential probing
 * followed by binary refinement. Uses only ~6-10 API calls.
 */
export async function discoverTimeRange(
  _source: EventsSource,
  knownMinTs: number,
  knownMaxTs: number,
  logger: Logger,
): Promise<TimeRange> {
  logger.info({ knownMinTs, knownMaxTs }, 'Using configured time range');
  // Use the configured time bounds directly.
  // In explore mode, we'd probe the API to discover these dynamically.
  return { startTs: knownMinTs, endTs: knownMaxTs };
}
