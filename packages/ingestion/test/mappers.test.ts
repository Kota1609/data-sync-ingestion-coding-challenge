import { describe, it, expect } from 'vitest';
import { normalizePage, toIngestionEvents } from '../src/mappers.js';

describe('normalizePage', () => {
  it('handles flat response format', () => {
    const page = normalizePage({
      data: [{ id: '1', timestamp: 1768000000000 }],
      hasMore: true,
      nextCursor: 'abc123',
    });

    expect(page.events).toHaveLength(1);
    expect(page.events[0]!.id).toBe('1');
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('abc123');
  });

  it('handles nested response format', () => {
    const page = normalizePage({
      data: {
        data: [{ id: '1', timestamp: 1768000000000 }],
        pagination: {
          hasMore: false,
          nextCursor: null,
          cursorExpiresIn: 117,
        },
        meta: {
          total: 3000000,
          returned: 1,
        },
      },
    });

    expect(page.events).toHaveLength(1);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
    expect(page.total).toBe(3000000);
  });

  it('defaults to empty page for invalid input', () => {
    const page = normalizePage(null);
    expect(page.events).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });

  it('handles pagination at root level with separate data array', () => {
    const page = normalizePage({
      data: [{ id: '1', timestamp: 100 }],
      pagination: { hasMore: true, nextCursor: 'xyz' },
      meta: { total: 5000 },
    });

    expect(page.events).toHaveLength(1);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('xyz');
    expect(page.total).toBe(5000);
  });

  it('skips items without an id', () => {
    const page = normalizePage({
      data: [
        { id: '1', timestamp: 100 },
        { noId: true, timestamp: 200 },
        { id: '3', timestamp: 300 },
      ],
      hasMore: false,
    });

    expect(page.events).toHaveLength(2);
  });
});

describe('toIngestionEvents', () => {
  it('converts raw events to ingestion events', () => {
    const events = toIngestionEvents([
      { id: 'evt-1', timestamp: 1768000000000, data: { foo: 'bar' } },
      { id: 'evt-2', timestamp: '2026-01-10T00:00:00.000Z', data: { baz: 1 } },
    ]);

    expect(events).toHaveLength(2);
    expect(events[0]!.eventId).toBe('evt-1');
    expect(events[0]!.timestampMs).toBe(1768000000000);
    expect(JSON.parse(events[0]!.payload)).toHaveProperty('data');
  });

  it('skips events with missing id', () => {
    const events = toIngestionEvents([
      { id: '', timestamp: 1000 },
      { id: 'valid', timestamp: 2000 },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]!.eventId).toBe('valid');
  });

  it('skips events with invalid timestamps', () => {
    const events = toIngestionEvents([
      { id: 'a', timestamp: 'not-a-date' },
      { id: 'b', timestamp: 1768000000000 },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]!.eventId).toBe('b');
  });
});
