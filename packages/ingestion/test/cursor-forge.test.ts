import { describe, it, expect } from 'vitest';
import { forgeCursor, decodeCursorTimestamp, createTimestampChunks } from '../src/core/cursor-forge.js';

describe('forgeCursor', () => {
  it('creates a base64url-encoded cursor with the given timestamp', () => {
    const cursor = forgeCursor(1768000000000);
    expect(cursor).toBeTruthy();
    expect(typeof cursor).toBe('string');
    // Should not contain standard base64 chars that are replaced
    expect(cursor).not.toContain('+');
    expect(cursor).not.toContain('/');
    expect(cursor).not.toContain('=');
  });

  it('encodes a null UUID and far-future expiry', () => {
    const cursor = forgeCursor(1768000000000);
    const decoded = JSON.parse(Buffer.from(
      cursor.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf-8'));

    expect(decoded.id).toBe('00000000-0000-0000-0000-000000000000');
    expect(decoded.ts).toBe(1768000000000);
    expect(decoded.v).toBe(2);
    expect(decoded.exp).toBe(4102444800000);
  });
});

describe('decodeCursorTimestamp', () => {
  it('extracts timestamp from a forged cursor', () => {
    const cursor = forgeCursor(1768123456789);
    const ts = decodeCursorTimestamp(cursor);
    expect(ts).toBe(1768123456789);
  });

  it('returns null for invalid cursors', () => {
    expect(decodeCursorTimestamp('not-valid-base64')).toBeNull();
    expect(decodeCursorTimestamp('')).toBeNull();
  });
});

describe('createTimestampChunks', () => {
  it('divides a range into equal chunks', () => {
    const chunks = createTimestampChunks(1000, 2000, 4);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]!.startTs).toBe(1000);
    // Last chunk endTs is endTs+1 (exclusive upper bound includes endTs events)
    expect(chunks[3]!.endTs).toBe(2001);
  });

  it('covers the full range without gaps', () => {
    const chunks = createTimestampChunks(0, 3000, 3);
    expect(chunks[0]!.startTs).toBe(0);
    expect(chunks[0]!.endTs).toBe(1000);
    expect(chunks[1]!.startTs).toBe(1000);
    expect(chunks[1]!.endTs).toBe(2000);
    expect(chunks[2]!.startTs).toBe(2000);
    expect(chunks[2]!.endTs).toBe(3001); // Last chunk inclusive of endTs
  });

  it('handles a single partition', () => {
    const chunks = createTimestampChunks(100, 200, 1);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.startTs).toBe(100);
    expect(chunks[0]!.endTs).toBe(201); // Inclusive of endTs
  });
});
