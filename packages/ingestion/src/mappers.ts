import type { RawEvent, IngestionEvent, NormalizedPage } from './types.js';

// ── Timestamp normalization ──

export function normalizeTimestampMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.floor(value);
    return n < 1_000_000_000_000 ? n * 1000 : n;
  }

  if (typeof value === 'string' && value.length > 0) {
    if (/^\d+$/.test(value)) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        return n < 1_000_000_000_000 ? Math.floor(n * 1000) : Math.floor(n);
      }
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }

  throw new Error(`Invalid timestamp: ${String(value)}`);
}

// ── Event mapping ──

export function toIngestionEvent(raw: RawEvent): IngestionEvent | null {
  if (!raw.id || typeof raw.id !== 'string') return null;

  let timestampMs: number;
  try {
    timestampMs = normalizeTimestampMs(raw.timestamp);
  } catch {
    return null;
  }

  return {
    eventId: raw.id,
    timestampMs,
    payload: JSON.stringify(raw),
  };
}

export function toIngestionEvents(rawEvents: readonly RawEvent[]): IngestionEvent[] {
  const result: IngestionEvent[] = [];
  for (const raw of rawEvents) {
    const event = toIngestionEvent(raw);
    if (event !== null) {
      result.push(event);
    }
  }
  return result;
}

// ── Page normalization ──

interface FlatPageShape {
  data: unknown[];
  hasMore?: boolean;
  nextCursor?: string | null;
  total?: number | null;
}

interface NestedPageShape {
  data: {
    data: unknown[];
    pagination?: {
      hasMore?: boolean;
      nextCursor?: string | null;
      cursorExpiresIn?: number;
    };
    meta?: {
      total?: number | null;
      returned?: number;
    };
  };
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

export function normalizePage(raw: unknown): NormalizedPage {
  if (!isRecord(raw)) {
    return { events: [], hasMore: false, nextCursor: null, total: null };
  }

  // Check for nested format: { data: { data: [...], pagination: {...} } }
  if (isRecord(raw['data']) && Array.isArray((raw['data'] as Record<string, unknown>)['data'])) {
    const nested = raw as unknown as NestedPageShape;
    const events = extractRawEvents(nested.data.data);
    const pagination = nested.data.pagination;
    const meta = nested.data.meta;

    return {
      events,
      hasMore: pagination?.hasMore ?? false,
      nextCursor: pagination?.nextCursor ?? null,
      total: meta?.total ?? null,
    };
  }

  // Flat format: { data: [...], hasMore, nextCursor }
  if (Array.isArray(raw['data'])) {
    const flat = raw as unknown as FlatPageShape;
    const events = extractRawEvents(flat.data);

    // Also check for pagination at root level
    const pagination = isRecord(raw['pagination'])
      ? (raw['pagination'] as Record<string, unknown>)
      : raw;

    return {
      events,
      hasMore: (pagination['hasMore'] as boolean) ?? false,
      nextCursor: (pagination['nextCursor'] as string | null) ?? null,
      total: isRecord(raw['meta'])
        ? ((raw['meta'] as Record<string, unknown>)['total'] as number | null) ?? null
        : null,
    };
  }

  return { events: [], hasMore: false, nextCursor: null, total: null };
}

function extractRawEvents(data: unknown[]): RawEvent[] {
  const events: RawEvent[] = [];
  for (const item of data) {
    if (isRecord(item) && typeof item['id'] === 'string') {
      events.push(item as RawEvent);
    }
  }
  return events;
}
