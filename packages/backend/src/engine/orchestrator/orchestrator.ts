import { bridgeService } from '../execution/bridge.js';
import type { CreateOrderResult } from '../execution/bridge.js';
import { orderStore } from '../matching/store/orderStore.js';
import type { OrderStore } from '../matching/store/orderStore.js';
import type { CycleMatch, MatchResult } from '../matching/types.js';
import { getAllChainConfigs } from '../../config/chains.js';

// ---------------------------------------------------------------------------
// Orchestrator
//
// Converts matched cycles from the matching engine into on-chain HTLC orders
// via bridgeService.createOrder().
//
// Execution model per cycle [order_0, order_1, ..., order_n-1]:
//
//   order[i] creates an HTLC on its srcChain, locking `matchedAmount` USDC.
//   The receiver of that HTLC is order[(i-1+n) % n].userAddress — the user
//   whose destination chain is order[i]'s source chain (they want those funds).
//
//   order[0] is the "presiding" order: it generates fresh secrets and returns
//   hashlocks.  Every subsequent order reuses those same hashlocks so the
//   entire cycle is atomically unlockable with a single preimage reveal.
//
// Calls are sequential: order[0] must settle before order[1] can proceed
// (hashlocks dependency).
// ---------------------------------------------------------------------------

/** chainId → chain key string (e.g. 11155111 → 'sepolia') */
const buildChainIdMap = (): Map<number, string> => {
  const map = new Map<number, string>();
  for (const [key, config] of Object.entries(getAllChainConfigs())) {
    map.set(config.chainId, key);
  }
  return map;
};

export class Orchestrator {
  private readonly chainIdToKey: Map<number, string>;

  constructor(private readonly store: OrderStore) {
    this.chainIdToKey = buildChainIdMap();
  }

  // -------------------------------------------------------------------------
  // Entry point — called by the scheduler after each tick
  // -------------------------------------------------------------------------

  async handleMatchResults(matchResults: MatchResult[]): Promise<void> {
    for (const result of matchResults) {
      for (const cycle of result.cycles) {
        try {
          await this.executeCycle(cycle);
        } catch (err) {
          console.error(
            `[Orchestrator] Cycle execution failed (matchId=${result.matchId}):`,
            err,
          );
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Core cycle execution
  // -------------------------------------------------------------------------

  private async executeCycle(cycle: CycleMatch): Promise<void> {
    const { orders: cycleEntries, matchedAmount } = cycle;
    const n = cycleEntries.length;

    // -- Resolve full order data -------------------------------------------
    const orders = cycleEntries.map((entry) => {
      const order = this.store.get(entry.orderId);
      if (!order) throw new Error(`[Orchestrator] Order not found: ${entry.orderId}`);
      return order;
    });

    console.log(
      `[Orchestrator] Executing cycle of ${n} order(s), matchedAmount=${matchedAmount}`,
    );

    // -- Sequential HTLC creation -----------------------------------------
    // order[0] is presiding: generates secrets → yields hashlocks
    // order[1..n-1] reuse those hashlocks (atomic cross-chain unlock)
    let presidingResult: CreateOrderResult | undefined;

    for (let i = 0; i < n; i++) {
      const order = orders[i];

      // The receiver for order[i] is the user whose desChain = order[i].srcChain,
      // which in a directed cycle is order[(i-1+n) % n].
      const receiverOrder = orders[(i - 1 + n) % n];

      const chainKey = this.chainIdToKey.get(order.srcChain);
      if (!chainKey) {
        throw new Error(
          `[Orchestrator] No chain key for chainId=${order.srcChain} (order ${order.orderId})`,
        );
      }

      const isPresiding = i === 0;

      // Non-presiding orders require hashlocks from the presiding result.
      // One fill per HTLC order → one hashlock from the presiding fill.
      const hashlocks: string[] | undefined = isPresiding
        ? undefined
        : presidingResult!.fills.map((f) => f.hashlock);

      console.log(
        `[Orchestrator] order[${i}] ${order.orderId.slice(0, 8)}… ` +
          `chain=${chainKey}, receiver=${receiverOrder.userAddress}, ` +
          `isPresiding=${isPresiding}`,
      );

      const result = await bridgeService.createOrder({
        privateKey: order.privateKey,
        receivers: [receiverOrder.userAddress],
        amounts: [BigInt(matchedAmount)],
        chain: chainKey,
        isPresiding,
        hashlocks,
      });

      console.log(
        `[Orchestrator] order[${i}] HTLC created — ` +
          `htlcOrderId=${result.orderId}, txHash=${result.htlcTxHash}`,
      );

      if (isPresiding) {
        presidingResult = result;
      }
    }

    console.log(`[Orchestrator] Cycle complete — all ${n} HTLC(s) on-chain`);
  }
}

/** Application-level singleton. */
export const orchestrator = new Orchestrator(orderStore);
