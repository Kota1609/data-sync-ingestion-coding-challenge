import { describe, it, expect } from 'vitest';
import { createRateLimiter } from '../src/api/middleware/rate-limit.js';
import pino from 'pino';

const logger = pino({ level: 'silent' });

describe('createRateLimiter', () => {
  it('returns 0 delay when no rate limit state', () => {
    const limiter = createRateLimiter(logger);
    expect(limiter.getPreRequestDelayMs()).toBe(0);
  });

  it('returns delay when remaining is low and reset is in the future', () => {
    const limiter = createRateLimiter(logger);
    const futureReset = Math.floor((Date.now() + 5000) / 1000); // 5s from now, in epoch seconds

    limiter.updateFromHeaders(new Headers({
      'x-ratelimit-remaining': '1',
      'x-ratelimit-limit': '60',
      'x-ratelimit-reset': String(futureReset),
    }));

    const delay = limiter.getPreRequestDelayMs();
    expect(delay).toBeGreaterThan(0);
    expect(delay).toBeLessThan(10000);
  });

  it('increases adaptive delay on 429', () => {
    const limiter = createRateLimiter(logger);

    limiter.record429();
    const state1 = limiter.getState();
    expect(state1.adaptiveDelayMs).toBeGreaterThan(0);
    expect(state1.consecutive429s).toBe(1);
  });

  it('decays adaptive delay on success', () => {
    const limiter = createRateLimiter(logger);

    limiter.record429();
    const afterThrottle = limiter.getState().adaptiveDelayMs;

    limiter.recordSuccess();
    const afterSuccess = limiter.getState().adaptiveDelayMs;

    expect(afterSuccess).toBeLessThan(afterThrottle);
  });

  it('resets consecutive count on success', () => {
    const limiter = createRateLimiter(logger);

    limiter.record429();
    expect(limiter.getState().consecutive429s).toBe(1);

    limiter.recordSuccess();
    expect(limiter.getState().consecutive429s).toBe(0);
  });
});
