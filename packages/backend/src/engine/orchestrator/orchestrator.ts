import { bridgeService } from '../execution/bridge.js';
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
// Consolidation model:
//
//   All cycles from a match result are collected into "send actions". Actions
//   from the same sender (privateKey + srcChain) are consolidated into a
//   single bridge order with multiple receivers / amounts.
//
//   The first consolidated group is the "presiding" order: it generates fresh
//   secrets and returns hashlocks. Every subsequent order reuses the hashlock
//   from the cycle it belongs to, so the entire set of cycles is atomically
//   unlockable.
//
// Calls are sequential: the presiding order must settle before non-presiding
// orders can proceed (hashlocks dependency).
// ---------------------------------------------------------------------------

/** A single directed send extracted from a cycle. */
interface SendAction {
  privateKey: string;
  senderAddress: string;
  receiverAddress: string;
  srcChain: number;
  chainKey: string;
  amount: bigint;
  cycleIdx: number;
}

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
      try {
        await this.executeConsolidated(result.cycles, result.matchId);
      } catch (err) {
        console.error(
          `[Orchestrator] Consolidated execution failed (matchId=${result.matchId}):`,
          err,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Core consolidated execution
  // -------------------------------------------------------------------------

  private async executeConsolidated(
    cycles: CycleMatch[],
    matchId: string,
  ): Promise<void> {
    if (cycles.length === 0) return;

    // -- 1. Extract send actions from all cycles ----------------------------
    const sendActions: SendAction[] = [];

    for (let cycleIdx = 0; cycleIdx < cycles.length; cycleIdx++) {
      const cycle = cycles[cycleIdx];
      const { orders: cycleEntries, matchedAmount } = cycle;
      const n = cycleEntries.length;

      const resolvedOrders = cycleEntries.map((entry) => {
        const order = this.store.get(entry.orderId);
        if (!order)
          throw new Error(`[Orchestrator] Order not found: ${entry.orderId}`);
        return order;
      });

      for (let i = 0; i < n; i++) {
        const order = resolvedOrders[i];
        const receiverOrder = resolvedOrders[(i - 1 + n) % n];

        const chainKey = this.chainIdToKey.get(order.srcChain);
        if (!chainKey) {
          throw new Error(
            `[Orchestrator] No chain key for chainId=${order.srcChain}`,
          );
        }

        sendActions.push({
          privateKey: order.privateKey,
          senderAddress: order.userAddress,
          receiverAddress: receiverOrder.userAddress,
          srcChain: order.srcChain,
          chainKey,
          amount: BigInt(matchedAmount),
          cycleIdx,
        });
      }
    }

    // -- 2. Group by (privateKey, chainKey) ---------------------------------
    const groupKey = (a: SendAction) => `${a.privateKey}::${a.chainKey}`;
    const groups = new Map<string, SendAction[]>();
    for (const action of sendActions) {
      const key = groupKey(action);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(action);
    }

    const groupEntries = [...groups.entries()];

    // -- 3. Log matched cycle summary ---------------------------------------
    console.log(
      `[Orchestrator] matchId=${matchId} — ${cycles.length} cycle(s), consolidated into ${groupEntries.length} bridge order(s)`,
    );

    for (let i = 0; i < cycles.length; i++) {
      const cycle = cycles[i];
      const entry = cycle.orders[0];
      if (entry) {
        const src =
          this.chainIdToKey.get(entry.srcChain) ?? String(entry.srcChain);
        const des =
          this.chainIdToKey.get(entry.desChain) ?? String(entry.desChain);
        console.log(
          `[Orchestrator]   cycle ${i + 1}: ${src} <-> ${des} (${cycle.matchedAmount})`,
        );
      }
    }

    // -- 4. Execute presiding order (first group) ---------------------------
    const [presidingKey, presidingActions] = groupEntries[0];

    console.log(
      `[Orchestrator] Presiding order: ${presidingActions.length} fill(s) on ${presidingActions[0].chainKey}, ` +
        `receivers=[${presidingActions.map((a) => a.receiverAddress).join(', ')}]`,
    );

    const presidingResult = await bridgeService.createOrder({
      privateKey: presidingActions[0].privateKey,
      receivers: presidingActions.map((a) => a.receiverAddress),
      amounts: presidingActions.map((a) => a.amount),
      chain: presidingActions[0].chainKey,
      isPresiding: true,
    });

    console.log(
      `[Orchestrator] Presiding HTLC created — orderId=${presidingResult.orderId}, txHash=${presidingResult.htlcTxHash}`,
    );

    // -- 5. Build cycleIdx → hashlock map -----------------------------------
    const cycleHashlockMap = new Map<number, string>();
    for (let i = 0; i < presidingActions.length; i++) {
      cycleHashlockMap.set(
        presidingActions[i].cycleIdx,
        presidingResult.fills[i].hashlock,
      );
    }

    // -- 6. Execute non-presiding orders ------------------------------------
    for (const [key, actions] of groupEntries) {
      if (key === presidingKey) continue;

      // Sort by cycleIdx for deterministic hashlock alignment
      actions.sort((a, b) => a.cycleIdx - b.cycleIdx);

      const hashlocks = actions.map((a) => {
        const h = cycleHashlockMap.get(a.cycleIdx);
        if (!h)
          throw new Error(
            `[Orchestrator] No hashlock for cycleIdx=${a.cycleIdx}`,
          );
        return h;
      });

      console.log(
        `[Orchestrator] Non-presiding order: ${actions.length} fill(s) on ${actions[0].chainKey}, ` +
          `receivers=[${actions.map((a) => a.receiverAddress).join(', ')}]`,
      );

      const result = await bridgeService.createOrder({
        privateKey: actions[0].privateKey,
        receivers: actions.map((a) => a.receiverAddress),
        amounts: actions.map((a) => a.amount),
        chain: actions[0].chainKey,
        isPresiding: false,
        hashlocks,
      });

      console.log(
        `[Orchestrator] HTLC created — orderId=${result.orderId}, txHash=${result.htlcTxHash}`,
      );
    }

    console.log(
      `[Orchestrator] All ${groupEntries.length} consolidated order(s) on-chain`,
    );
  }
}

/** Application-level singleton. */
export const orchestrator = new Orchestrator(orderStore);
