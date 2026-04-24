import { Wallet } from 'ethers';
import type { MatchingService } from '../matching/service/matchingService.js';
import type { OrderStore } from '../matching/store/orderStore.js';
import type { IntentOrder, MatchResult, TickStats } from '../matching/types.js';
import { orchestrator } from '../orchestrator/orchestrator.js';

// ---------------------------------------------------------------------------
// Liquidity Market Service
//
// Maintains deterministic liquidity coverage by creating power-of-2 orders
// for each LP on their assigned chain routes.  On startup every order is
// seeded; a periodic refill loop recreates any that get matched or expire.
//
// LP assignments (from env private keys):
//   B → Ethereum Sepolia   (creates orders TO Base & Arbitrum Sepolia)
//   C → Base Sepolia       (creates orders TO Ethereum & Arbitrum Sepolia)
//   D → Arbitrum Sepolia   (creates orders TO Ethereum & Base Sepolia)
//
// Important: LP orders on opposite routes would match against each other
// if fed into the algorithm together.  The `tick()` method prevents this
// by only including LP counter-orders for routes that have user orders.
// ---------------------------------------------------------------------------

// Chain IDs
const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const ARBITRUM_SEPOLIA = 421614;

// Powers of 2 from 2^0 to 2^13  (all <= 10 000)
// Sum = 16 383, so any integer amount in [1, 10 000] can be covered.
export const POWER_OF_TWO_AMOUNTS = Array.from({ length: 14 }, (_, i) => 2 ** i);

// LP orders live for 24 h; the refill loop recreates them when expired.
const LP_DEADLINE_SECONDS = 24 * 60 * 60;

export interface LPConfig {
  name: string;
  address: string;
  srcChainId: number;
  desChainIds: number[];
}

/**
 * Build LP configs from environment private keys.
 * Throws if any key is missing.
 */
export function loadLPConfigsFromEnv(): LPConfig[] {
  const defs = [
    { name: 'B', envKey: 'PRIVATE_KEY_B', src: SEPOLIA, des: [BASE_SEPOLIA, ARBITRUM_SEPOLIA] },
    { name: 'C', envKey: 'PRIVATE_KEY_C', src: BASE_SEPOLIA, des: [SEPOLIA, ARBITRUM_SEPOLIA] },
    { name: 'D', envKey: 'PRIVATE_KEY_D', src: ARBITRUM_SEPOLIA, des: [SEPOLIA, BASE_SEPOLIA] },
  ];

  return defs.map(({ name, envKey, src, des }) => {
    const pk = process.env[envKey];
    if (!pk) throw new Error(`Missing env variable: ${envKey}`);
    return { name, address: new Wallet(pk).address, srcChainId: src, desChainIds: des };
  });
}

export class LiquidityService {
  private readonly activeOrders = new Map<string, string>(); // key → orderId
  private readonly lpAddresses: Set<string>;
  private matchTimer: ReturnType<typeof setInterval> | null = null;
  private refillTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly service: MatchingService,
    private readonly store: OrderStore,
    private readonly lpConfigs: LPConfig[],
    private readonly refillIntervalMs: number = parseInt(
      process.env.LP_REFILL_INTERVAL_MS ?? '10000',
      10
    )
  ) {
    this.lpAddresses = new Set(lpConfigs.map((lp) => lp.address));
  }

  // ---- Key helpers ----------------------------------------------------------

  private orderKey(address: string, src: number, des: number, amount: number): string {
    return `${address}-${src}-${des}-${amount}`;
  }

  private futureDeadline(): number {
    return Math.floor(Date.now() / 1000) + LP_DEADLINE_SECONDS;
  }

  // ---- Core logic -----------------------------------------------------------

  /** Seed the full set of liquidity orders for every LP + route + amount. */
  seed(): { created: number; skipped: number } {
    let created = 0;
    let skipped = 0;

    for (const lp of this.lpConfigs) {
      for (const des of lp.desChainIds) {
        for (const amount of POWER_OF_TWO_AMOUNTS) {
          if (this.createIfMissing(lp.address, lp.srcChainId, des, amount)) {
            created++;
          } else {
            skipped++;
          }
        }
      }
    }
    return { created, skipped };
  }

  /** Check every tracked slot and recreate consumed / expired orders. */
  refill(): number {
    let refilled = 0;
    for (const lp of this.lpConfigs) {
      for (const des of lp.desChainIds) {
        for (const amount of POWER_OF_TWO_AMOUNTS) {
          if (this.createIfMissing(lp.address, lp.srcChainId, des, amount)) {
            refilled++;
          }
        }
      }
    }
    if (refilled > 0) {
      console.log(`[LiquidityService] Refilled ${refilled} LP orders`);
    }
    return refilled;
  }

  // ---- Matching tick --------------------------------------------------------

  /**
   * Run a matching tick that only matches user orders against LP counter-orders.
   * Prevents LP→LP self-matching by filtering: only LP orders whose route is
   * the reverse of a user order are included in the matching pass.
   *
   * Selection strategy: for each user order of amount A, pick the LP
   * counter-orders whose amounts form the binary decomposition of A (e.g.
   * A=10 → 8+2 → 2 LP orders, not 1+2+4+3). This yields the minimum number
   * of cycles and avoids unnecessary partials.
   *
   * Call this instead of `matchingService.runTick()` when liquidity is active.
   */
  tick(): TickStats {
    const expired = this.store.expireStale();
    const allActive = this.store.getActiveOrders();
    const queuedBefore = allActive.length;

    // Separate user orders from LP orders
    const userOrders = allActive.filter((o) => !this.lpAddresses.has(o.userAddress));

    let matchResults: MatchResult[] = [];

    if (userOrders.length > 0) {
      const selectedLpOrders = this.selectLpOrdersForUsers(userOrders, allActive);
      matchResults = this.service.runMatchingPass([...userOrders, ...selectedLpOrders]);
    }

    // Refill any LP orders that were consumed
    this.refill();

    const queuedAfter = this.store.getActiveOrders().length;
    const matchedOrders = matchResults.flatMap((r) =>
      r.orders.filter((o) => o.status === 'MATCHED')
    ).length;
    const partialOrders = matchResults.flatMap((r) =>
      r.orders.filter((o) => o.status === 'PARTIAL')
    ).length;

    return { queuedBefore, expired, matchResults, matchedOrders, partialOrders, queuedAfter };
  }

  // ---- Lifecycle ------------------------------------------------------------

  /** Seed all orders and start the matching + refill loops. */
  start(): void {
    const { created } = this.seed();
    console.log(`[LiquidityService] Seeded ${created} LP orders`);

    const matchIntervalMs = parseInt(process.env.MATCH_INTERVAL_MS ?? '5000', 10);

    if (this.matchTimer === null) {
      this.matchTimer = setInterval(() => {
        const stats = this.tick();
        if (stats.matchResults.length > 0) {
          const summary = stats.matchResults
            .flatMap((r) => r.orders)
            .map(
              (o) =>
                `  ${o.orderId.slice(0, 8)}… [${o.status}] matched=${o.matchedAmount} remaining=${o.remainingAmount}`
            )
            .join('\n');
          console.log(
            `[LiquidityService] Tick — matched: ${stats.matchedOrders}, partial: ${stats.partialOrders}\n${summary}`
          );

          void orchestrator.handleMatchResults(stats.matchResults);
        }
      }, matchIntervalMs);
    }

    // Separate refill loop for expired orders (runs independently of matching)
    if (this.refillTimer === null) {
      this.refillTimer = setInterval(() => this.refill(), this.refillIntervalMs);
    }

    console.log(
      `[LiquidityService] Started — match=${matchIntervalMs}ms, refill=${this.refillIntervalMs}ms`
    );
  }

  stop(): void {
    if (this.matchTimer !== null) {
      clearInterval(this.matchTimer);
      this.matchTimer = null;
    }
    if (this.refillTimer !== null) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
    console.log('[LiquidityService] Stopped');
  }

  /** Whether an address belongs to an LP. */
  isLPAddress(address: string): boolean {
    return this.lpAddresses.has(address);
  }

  // ---- Internal -------------------------------------------------------------

  /**
   * For each user order, pick LP counter-orders whose amounts are the binary
   * decomposition of the user's amount (largest bit first). Reserves picked
   * LP orders so two user orders in the same tick cannot claim the same slot.
   *
   * Only QUEUED LP orders with exact power-of-2 amounts are considered — a
   * PARTIAL LP order has a non-power-of-2 remainder that wouldn't fit any bit.
   */
  private selectLpOrdersForUsers(
    userOrders: IntentOrder[],
    allActive: IntentOrder[]
  ): IntentOrder[] {
    // route key = `${src}-${des}` → amount → QUEUED LP orders
    const lpByRouteAmount = new Map<string, Map<number, IntentOrder[]>>();
    for (const o of allActive) {
      if (!this.lpAddresses.has(o.userAddress)) continue;
      if (o.status !== 'QUEUED') continue;
      const route = `${o.srcChain}-${o.desChain}`;
      const amount = Number(o.amount);
      let byAmount = lpByRouteAmount.get(route);
      if (!byAmount) {
        byAmount = new Map();
        lpByRouteAmount.set(route, byAmount);
      }
      let pool = byAmount.get(amount);
      if (!pool) {
        pool = [];
        byAmount.set(amount, pool);
      }
      pool.push(o);
    }

    const selected: IntentOrder[] = [];
    const reserved = new Set<string>();

    for (const user of userOrders) {
      const reverseRoute = `${user.desChain}-${user.srcChain}`;
      const byAmount = lpByRouteAmount.get(reverseRoute);
      if (!byAmount) continue;

      const amount = Number(user.amount);
      for (let i = POWER_OF_TWO_AMOUNTS.length - 1; i >= 0; i--) {
        const pow = POWER_OF_TWO_AMOUNTS[i];
        if ((amount & pow) === 0) continue;

        const pool = byAmount.get(pow);
        const pick = pool?.find((o) => !reserved.has(o.orderId));
        if (pick) {
          reserved.add(pick.orderId);
          selected.push(pick);
        }
      }
    }

    return selected;
  }

  /**
   * Creates an LP order if the slot is not currently covered by an active order.
   * Returns true when a new order was created.
   */
  private createIfMissing(address: string, src: number, des: number, amount: number): boolean {
    const key = this.orderKey(address, src, des, amount);
    const existingId = this.activeOrders.get(key);

    if (existingId) {
      const existing = this.store.get(existingId);
      // Only skip if the order is still QUEUED at its original amount.
      // PARTIAL orders have a reduced amount and no longer cover the slot,
      // so we recreate a fresh order with the full power-of-2 amount.
      if (existing && existing.status === 'QUEUED') {
        return false;
      }
    }

    const result = this.service.createOrder({
      srcChain: src,
      desChain: des,
      amount: String(amount),
      deadline: this.futureDeadline(),
      userAddress: address,
    });

    if ('order' in result) {
      this.activeOrders.set(key, result.order.orderId);
      return true;
    }

    console.error(
      `[LiquidityService] Order creation failed: ${(result as { error: string }).error}`
    );
    return false;
  }

  // ---- Diagnostics ----------------------------------------------------------

  get trackedCount(): number {
    return this.activeOrders.size;
  }
}
