import { loadEnv } from './env.js';

export const DEFAULT_TIMELOCK_MINUTES = 10;
export const LP_DEADLINE_SECONDS = 24 * 60 * 60;
export const DEFAULT_MATCH_INTERVAL_MS = 5000;
export const DEFAULT_LP_REFILL_INTERVAL_MS = 10000;
export const DEFAULT_MATCH_THRESHOLD = 0;
export const USDC_DECIMALS = 6;

export function getTimelockMinutes(): number {
  return loadEnv().engine.timelockMinutes;
}

export function getMatchIntervalMs(): number {
  return loadEnv().engine.matchIntervalMs;
}

export function getMatchThreshold(): number {
  return loadEnv().engine.matchThreshold;
}

export function getLpRefillIntervalMs(): number {
  return loadEnv().engine.lpRefillIntervalMs;
}

export function isTestingMode(): boolean {
  return loadEnv().engine.testingMode;
}
