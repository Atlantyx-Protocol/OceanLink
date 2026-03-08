import { matchingService } from '../service/matchingService.js';
import type { MatchingService } from '../service/matchingService.js';
import { orchestrator } from '../../orchestrator/orchestrator.js';

// ---------------------------------------------------------------------------
// MatchScheduler
//
// Runs a periodic "tick" that drives the matching engine.
// ENV variables:
//   MATCH_INTERVAL_MS  — how often to tick (default: 5000 ms)
//
// Concurrency safety:
//   isRunning flag prevents overlapping ticks.  Because Node.js is
//   single-threaded, a plain boolean is sufficient — no real mutex needed.
// ---------------------------------------------------------------------------

export class MatchScheduler {
  private isRunning = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly service: MatchingService,
    private readonly intervalMs: number = parseInt(
      process.env.MATCH_INTERVAL_MS ?? '5000',
      10,
    ),
  ) {}

  /** Starts the scheduler.  Idempotent — safe to call multiple times. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    console.log(
      `[MatchScheduler] Started — interval=${this.intervalMs}ms, threshold=${process.env.MATCH_THRESHOLD ?? '0.8'}`,
    );
  }

  /** Stops the scheduler. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[MatchScheduler] Stopped');
    }
  }

  /** Exposed for testing — runs one tick synchronously from the caller. */
  async tick(): Promise<void> {
    if (this.isRunning) {
      console.warn('[MatchScheduler] Tick skipped — previous tick still running');
      return;
    }

    this.isRunning = true;

    try {
      const stats = this.service.runTick();

      const matchedOrders = stats.matchResults.flatMap((r) => r.orders);

      console.log(
        `[MatchScheduler] Tick — ` +
          `queued: ${stats.queuedBefore} → ${stats.queuedAfter}, ` +
          `expired: ${stats.expired}, ` +
          `matched: ${stats.matchedOrders}, ` +
          `partial: ${stats.partialOrders}, ` +
          `cycles: ${stats.matchResults.reduce((s, r) => s + r.rawCycles.length, 0)}`,
      );

      if (matchedOrders.length > 0) {
        const summary = matchedOrders
          .map(
            (o) =>
              `  ${o.orderId.slice(0, 8)}… [${o.status}] matched=${o.matchedAmount} remaining=${o.remainingAmount}`,
          )
          .join('\n');
        console.log(`[MatchScheduler] Orders affected:\n${summary}`);
      }

      if (stats.matchResults.length > 0) {
        void orchestrator.handleMatchResults(stats.matchResults);
      }
    } catch (err) {
      console.error('[MatchScheduler] Tick error:', err);
    } finally {
      this.isRunning = false;
    }
  }
}

/** Application-level singleton. */
export const matchScheduler = new MatchScheduler(matchingService);
