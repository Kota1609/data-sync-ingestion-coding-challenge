import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      API_BASE_URL: 'http://example.com/api/v1',
      TARGET_API_KEY: 'test-key',
      MODE: 'ingest',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads required config from environment', () => {
    const config = loadConfig();
    expect(config.databaseUrl).toBe('postgresql://test:test@localhost:5432/test');
    expect(config.apiKey).toBe('test-key');
  });

  it('normalizes API base URL ending with /api/v1', () => {
    process.env['API_BASE_URL'] = 'http://example.com/api/v1';
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe('http://example.com/api/v1');
  });

  it('appends /api/v1 to origin-only URLs', () => {
    process.env['API_BASE_URL'] = 'http://example.com';
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe('http://example.com/api/v1');
  });

  it('strips trailing slashes', () => {
    process.env['API_BASE_URL'] = 'http://example.com/api/v1/';
    const config = loadConfig();
    expect(config.apiBaseUrl).toBe('http://example.com/api/v1');
  });

  it('uses default values for optional config', () => {
    const config = loadConfig();
    expect(config.partitionCount).toBe(8);
    expect(config.batchSize).toBe(5000);
    expect(config.dbWriteConcurrency).toBe(2);
    expect(config.pgSyncCommit).toBe('off');
    expect(config.healthPort).toBe(8080);
    expect(config.autoSubmit).toBe(false);
  });

  it('clamps batch size to max 5000', () => {
    process.env['BATCH_SIZE'] = '10000';
    const config = loadConfig();
    expect(config.batchSize).toBe(5000);
  });

  it('clamps partition count to min 1', () => {
    process.env['PARTITION_COUNT'] = '0';
    const config = loadConfig();
    expect(config.partitionCount).toBe(1);
  });

  it('throws if DATABASE_URL is missing', () => {
    delete process.env['DATABASE_URL'];
    expect(() => loadConfig()).toThrow('DATABASE_URL');
  });

  it('throws if TARGET_API_KEY is missing', () => {
    delete process.env['TARGET_API_KEY'];
    expect(() => loadConfig()).toThrow('TARGET_API_KEY');
  });

  it('throws for invalid MODE', () => {
    process.env['MODE'] = 'invalid';
    expect(() => loadConfig()).toThrow('MODE');
  });
});
