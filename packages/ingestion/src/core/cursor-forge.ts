import type { TimestampChunk } from '../types.js';

const NULL_UUID = '00000000-0000-0000-0000-000000000000';
const FAR_FUTURE_EXP = 4102444800000; // year 2100

/**
 * Forge a synthetic cursor that positions the API at the given timestamp.
 * The API resolves cursor position by `ts`, not `id`.
 */
export function forgeCursor(timestampMs: number): string {
  const payload = JSON.stringify({
    id: NULL_UUID,
    ts: timestampMs,
    v: 2,
    exp: FAR_FUTURE_EXP,
  });
  return toBase64Url(payload);
}

/**
 * Decode a cursor to extract its timestamp. Returns null if invalid.
 */
export function decodeCursorTimestamp(cursor: string): number | null {
  try {
    const json = fromBase64Url(cursor);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const ts = parsed['ts'];
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
    return null;
  } catch {
    return null;
  }
}

/**
 * Create timestamp chunks by dividing a time range into N equal partitions.
 */
export function createTimestampChunks(
  startTs: number,
  endTs: number,
  count: number,
): TimestampChunk[] {
  const width = (endTs - startTs) / count;
  const chunks: TimestampChunk[] = [];

  for (let i = 0; i < count; i++) {
    const chunkStart = Math.floor(startTs + width * i);
    const chunkEnd = i === count - 1
      ? endTs + 1  // Last partition uses exclusive upper bound to include events at endTs
      : Math.floor(startTs + width * (i + 1));

    chunks.push({ startTs: chunkStart, endTs: chunkEnd });
  }

  return chunks;
}

// ── Base64url encoding ──

function toBase64Url(str: string): string {
  return Buffer.from(str, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf-8');
}
