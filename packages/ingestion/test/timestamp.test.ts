import { describe, it, expect } from 'vitest';
import { normalizeTimestampMs } from '../src/mappers.js';

describe('normalizeTimestampMs', () => {
  it('passes through millisecond epoch numbers', () => {
    expect(normalizeTimestampMs(1768000000000)).toBe(1768000000000);
  });

  it('converts second epoch to milliseconds', () => {
    expect(normalizeTimestampMs(1768000000)).toBe(1768000000000);
  });

  it('handles millisecond epoch as string', () => {
    expect(normalizeTimestampMs('1768000000000')).toBe(1768000000000);
  });

  it('handles second epoch as string', () => {
    expect(normalizeTimestampMs('1768000000')).toBe(1768000000000);
  });

  it('parses ISO 8601 strings', () => {
    const ts = normalizeTimestampMs('2026-01-10T00:00:00.000Z');
    expect(ts).toBe(Date.parse('2026-01-10T00:00:00.000Z'));
  });

  it('throws for empty string', () => {
    expect(() => normalizeTimestampMs('')).toThrow('Invalid timestamp');
  });

  it('throws for null', () => {
    expect(() => normalizeTimestampMs(null)).toThrow('Invalid timestamp');
  });

  it('throws for undefined', () => {
    expect(() => normalizeTimestampMs(undefined)).toThrow('Invalid timestamp');
  });

  it('throws for NaN', () => {
    expect(() => normalizeTimestampMs(NaN)).toThrow('Invalid timestamp');
  });

  it('throws for non-numeric string', () => {
    expect(() => normalizeTimestampMs('not-a-date-either-xyz')).toThrow('Invalid timestamp');
  });

  it('handles float milliseconds by flooring', () => {
    expect(normalizeTimestampMs(1768000000000.7)).toBe(1768000000000);
  });
});
