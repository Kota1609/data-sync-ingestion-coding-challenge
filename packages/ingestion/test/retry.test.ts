import { describe, it, expect } from 'vitest';
import { parseRetryAfter } from '../src/api/middleware/retry.js';

describe('parseRetryAfter', () => {
  it('parses delta-seconds', () => {
    const headers = new Headers({ 'retry-after': '5' });
    const delay = parseRetryAfter(headers);
    expect(delay).toBe(5000);
  });

  it('parses HTTP-date', () => {
    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const headers = new Headers({ 'retry-after': futureDate });
    const delay = parseRetryAfter(headers);
    expect(delay).toBeGreaterThan(5000);
    expect(delay).toBeLessThan(15000);
  });

  it('returns null when header is absent', () => {
    const headers = new Headers();
    expect(parseRetryAfter(headers)).toBeNull();
  });

  it('returns null for 0', () => {
    const headers = new Headers({ 'retry-after': '0' });
    expect(parseRetryAfter(headers)).toBeNull();
  });

  it('returns null for negative values', () => {
    const headers = new Headers({ 'retry-after': '-5' });
    expect(parseRetryAfter(headers)).toBeNull();
  });
});
