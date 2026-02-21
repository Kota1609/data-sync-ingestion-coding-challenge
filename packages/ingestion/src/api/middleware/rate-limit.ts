import type { Logger } from '../../logger.js';

export interface RateLimitState {
  remaining: number | null;
  limit: number | null;
  resetAtMs: number | null;
  adaptiveDelayMs: number;
  consecutive429s: number;
}

const ADAPTIVE_MULTIPLIER = 1.3;
const ADAPTIVE_DECAY = 0.5;
const ADAPTIVE_MIN_MS = 1000;
const ADAPTIVE_MAX_MS = 8000;
const LAST_429_DEDUP_WINDOW_MS = 2000;

export function createRateLimiter(logger: Logger): {
  readonly getPreRequestDelayMs: () => number;
  readonly updateFromHeaders: (headers: Headers) => void;
  readonly record429: () => void;
  readonly recordSuccess: () => void;
  readonly getState: () => Readonly<RateLimitState>;
} {
  const state: RateLimitState = {
    remaining: null,
    limit: null,
    resetAtMs: null,
    adaptiveDelayMs: 0,
    consecutive429s: 0,
  };

  let last429AtMs = 0;

  function getPreRequestDelayMs(): number {
    const now = Date.now();

    // Header-based: if remaining is low, wait until reset
    if (state.remaining !== null && state.remaining <= 1 && state.resetAtMs !== null) {
      const waitMs = state.resetAtMs - now;
      if (waitMs > 0) return waitMs + 100; // small buffer
    }

    // Adaptive backoff for headerless endpoints
    return state.adaptiveDelayMs;
  }

  function updateFromHeaders(headers: Headers): void {
    const remaining = headers.get('x-ratelimit-remaining');
    const limit = headers.get('x-ratelimit-limit');
    const reset = headers.get('x-ratelimit-reset');

    if (remaining !== null) {
      state.remaining = Number(remaining);
    }
    if (limit !== null) {
      state.limit = Number(limit);
    }
    if (reset !== null) {
      const resetVal = Number(reset);
      if (Number.isFinite(resetVal)) {
        // Could be epoch seconds or delta seconds
        state.resetAtMs = resetVal > 1_000_000_000
          ? resetVal * 1000 // epoch seconds → ms
          : Date.now() + resetVal * 1000; // delta seconds → future ms
      }
    }
  }

  function record429(): void {
    const now = Date.now();
    // Deduplicate bursts
    if (now - last429AtMs < LAST_429_DEDUP_WINDOW_MS) return;
    last429AtMs = now;

    state.consecutive429s++;
    if (state.adaptiveDelayMs === 0) {
      state.adaptiveDelayMs = ADAPTIVE_MIN_MS;
    } else {
      state.adaptiveDelayMs = Math.min(
        state.adaptiveDelayMs * ADAPTIVE_MULTIPLIER,
        ADAPTIVE_MAX_MS,
      );
    }

    logger.warn(
      { consecutive429s: state.consecutive429s, adaptiveDelayMs: state.adaptiveDelayMs },
      'Rate limit hit, increasing adaptive delay',
    );
  }

  function recordSuccess(): void {
    if (state.consecutive429s > 0) {
      state.consecutive429s = 0;
      state.adaptiveDelayMs = Math.max(
        state.adaptiveDelayMs * ADAPTIVE_DECAY,
        0,
      );
      if (state.adaptiveDelayMs < 100) {
        state.adaptiveDelayMs = 0;
      }
    }
  }

  function getState(): Readonly<RateLimitState> {
    return { ...state };
  }

  return { getPreRequestDelayMs, updateFromHeaders, record429, recordSuccess, getState };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
