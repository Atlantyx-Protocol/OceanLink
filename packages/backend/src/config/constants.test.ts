import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TIMELOCK_MINUTES,
  LP_DEADLINE_SECONDS,
  DEFAULT_MATCH_INTERVAL_MS,
  DEFAULT_LP_REFILL_INTERVAL_MS,
  DEFAULT_MATCH_THRESHOLD,
  USDC_DECIMALS,
  getTimelockMinutes,
  getMatchIntervalMs,
  getMatchThreshold,
  getLpRefillIntervalMs,
} from './constants.js';

describe('constants — default values', () => {
  it('DEFAULT_TIMELOCK_MINUTES is 10', () => {
    assert.equal(DEFAULT_TIMELOCK_MINUTES, 10);
  });

  it('LP_DEADLINE_SECONDS is 24 hours', () => {
    assert.equal(LP_DEADLINE_SECONDS, 86400);
  });

  it('DEFAULT_MATCH_INTERVAL_MS is 5000', () => {
    assert.equal(DEFAULT_MATCH_INTERVAL_MS, 5000);
  });

  it('DEFAULT_LP_REFILL_INTERVAL_MS is 10000', () => {
    assert.equal(DEFAULT_LP_REFILL_INTERVAL_MS, 10000);
  });

  it('DEFAULT_MATCH_THRESHOLD is 0', () => {
    assert.equal(DEFAULT_MATCH_THRESHOLD, 0);
  });

  it('USDC_DECIMALS is 6', () => {
    assert.equal(USDC_DECIMALS, 6);
  });
});

describe('constants — env getters', () => {
  const envBackup: Record<string, string | undefined> = {};

  beforeEach(() => {
    envBackup.TIME_LOCK = process.env.TIME_LOCK;
    envBackup.MATCH_INTERVAL_MS = process.env.MATCH_INTERVAL_MS;
    envBackup.MATCH_THRESHOLD = process.env.MATCH_THRESHOLD;
    envBackup.LP_REFILL_INTERVAL_MS = process.env.LP_REFILL_INTERVAL_MS;
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(envBackup)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it('getTimelockMinutes returns default when env not set', () => {
    delete process.env.TIME_LOCK;
    assert.equal(getTimelockMinutes(), DEFAULT_TIMELOCK_MINUTES);
  });

  it('getTimelockMinutes reads from env', () => {
    process.env.TIME_LOCK = '30';
    assert.equal(getTimelockMinutes(), 30);
  });

  it('getMatchIntervalMs returns default when env not set', () => {
    delete process.env.MATCH_INTERVAL_MS;
    assert.equal(getMatchIntervalMs(), DEFAULT_MATCH_INTERVAL_MS);
  });

  it('getMatchIntervalMs reads from env', () => {
    process.env.MATCH_INTERVAL_MS = '2000';
    assert.equal(getMatchIntervalMs(), 2000);
  });

  it('getMatchThreshold returns default when env not set', () => {
    delete process.env.MATCH_THRESHOLD;
    assert.equal(getMatchThreshold(), DEFAULT_MATCH_THRESHOLD);
  });

  it('getMatchThreshold reads from env', () => {
    process.env.MATCH_THRESHOLD = '0.5';
    assert.equal(getMatchThreshold(), 0.5);
  });

  it('getLpRefillIntervalMs returns default when env not set', () => {
    delete process.env.LP_REFILL_INTERVAL_MS;
    assert.equal(getLpRefillIntervalMs(), DEFAULT_LP_REFILL_INTERVAL_MS);
  });

  it('getLpRefillIntervalMs reads from env', () => {
    process.env.LP_REFILL_INTERVAL_MS = '5000';
    assert.equal(getLpRefillIntervalMs(), 5000);
  });
});
