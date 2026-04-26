// ---------------------------------------------------------------------------
// Centralized configuration constants
//
// All magic numbers and env-driven defaults in one place.
// ---------------------------------------------------------------------------

export const DEFAULT_TIMELOCK_MINUTES = 10;
export const LP_DEADLINE_SECONDS = 24 * 60 * 60;
export const DEFAULT_MATCH_INTERVAL_MS = 5000;
export const DEFAULT_LP_REFILL_INTERVAL_MS = 10000;
export const DEFAULT_MATCH_THRESHOLD = 0;
export const USDC_DECIMALS = 6;

export function getTimelockMinutes(): number {
  return parseInt(process.env.TIME_LOCK ?? String(DEFAULT_TIMELOCK_MINUTES), 10);
}

export function getMatchIntervalMs(): number {
  return parseInt(process.env.MATCH_INTERVAL_MS ?? String(DEFAULT_MATCH_INTERVAL_MS), 10);
}

export function getMatchThreshold(): number {
  return parseFloat(process.env.MATCH_THRESHOLD ?? String(DEFAULT_MATCH_THRESHOLD));
}

export function getLpRefillIntervalMs(): number {
  return parseInt(process.env.LP_REFILL_INTERVAL_MS ?? String(DEFAULT_LP_REFILL_INTERVAL_MS), 10);
}
