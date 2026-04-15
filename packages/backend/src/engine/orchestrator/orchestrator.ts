import { bridgeService, type CreateOrderResult } from '../execution/bridge.js';
import { orderStore } from '../matching/store/orderStore.js';
import type { OrderStore } from '../matching/store/orderStore.js';
import type { CycleMatch, MatchResult } from '../matching/types.js';
import { getAllChainConfigs } from '../../config/chains.js';

// ---------------------------------------------------------------------------
// Execution state — stored per matchId so the API can expose it
// ---------------------------------------------------------------------------

export interface ExecutionWithdraw {
  fillId: string;
  secret: string;
  receiverAddress: string;
}

export interface ExecutionData {
  presidingOrder: {
    orderId: string;
    chain: string;
    withdraws: ExecutionWithdraw[];
  };
  respondingWithdraws: Array<{
    orderId: string;
    fillId: string;
    chain: string;
    secret: string;
    receiverAddress: string;
  }>;
}

export interface ExecutionRecord {
  status: 'pending' | 'done' | 'error';
  data?: ExecutionData;
  error?: string;
}

// ---------------------------------------------------------------------------
// Orchestrator
//
// Converts matched cycles from the matching engine into on-chain HTLC orders
// via bridgeService.createOrder().
//
// Consolidation model:
//
//   All cycles from a match result are collected into "send actions". Actions
//   on the same chain are consolidated into a single bridge order with
//   multiple receivers / amounts. Uses PRIVATE_KEY_ADMIN from env to sign.
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
  senderAddress: string;
  receiverAddress: string;
  srcChain: number;
  chainKey: string;
  amount: string;
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
  private readonly executions = new Map<string, ExecutionRecord>();

  constructor(private readonly store: OrderStore) {
    this.chainIdToKey = buildChainIdMap();
  }

  getExecution(matchId: string): ExecutionRecord | undefined {
    return this.executions.get(matchId);
  }

  // -------------------------------------------------------------------------
  // Entry point — called by the scheduler after each tick
  // -------------------------------------------------------------------------

  async handleMatchResults(matchResults: MatchResult[]): Promise<void> {
    for (const result of matchResults) {
      this.executions.set(result.matchId, { status: 'pending' });
      try {
        await this.executeConsolidated(result.cycles, result.matchId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.executions.set(result.matchId, { status: 'error', error: msg });
        console.error(
          `[Orchestrator] Consolidated execution failed (matchId=${result.matchId}):`,
          err
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Core consolidated execution
  // -------------------------------------------------------------------------

  private async executeConsolidated(cycles: CycleMatch[], matchId: string): Promise<void> {
    if (cycles.length === 0) return;

    const sendActions = this.extractSendActionsFromCycles(cycles);
    const groupEntries = this.groupActionsByChainKey(sendActions);

    this.logCycleSummary(cycles, matchId, groupEntries);

    const [presidingKey, presidingActions] = groupEntries[0];
    const presidingChainKey = presidingActions[0].chainKey; // actual chain, separate from group key
    const presidingResult = await this.executePresidingOrder(presidingActions);
    const cycleHashlockMap = this.buildCycleHashlockMap(presidingActions, presidingResult);
    const cycleSecretMap = this.buildCycleSecretMap(presidingActions, presidingResult);

    const nonPresidingResults = await this.executeNonPresidingOrders(
      groupEntries,
      presidingKey,
      cycleHashlockMap
    );

    await this.verifyAndWithdrawOrders(
      presidingChainKey,
      presidingActions,
      presidingResult,
      nonPresidingResults,
      cycleSecretMap
    );

    console.log(`[Orchestrator] All ${groupEntries.length} consolidated order(s) on-chain`);

    // Build and store execution record for API access
    const executionData: ExecutionData = {
      presidingOrder: {
        orderId: presidingResult.orderId,
        chain: presidingChainKey,
        withdraws: presidingResult.fills.map((fill, i) => ({
          fillId: fill.fillId,
          secret: fill.secret!,
          receiverAddress: presidingActions[i].receiverAddress,
        })),
      },
      respondingWithdraws: nonPresidingResults.flatMap(({ chainKey, orderId, fills, actions }) =>
        fills.map((fill, i) => ({
          orderId,
          fillId: fill.fillId,
          chain: chainKey,
          secret: cycleSecretMap.get(actions[i].cycleIdx)!,
          receiverAddress: actions[i].receiverAddress,
        }))
      ),
    };

    this.executions.set(matchId, { status: 'done', data: executionData });
  }

  private extractSendActionsFromCycles(cycles: CycleMatch[]): SendAction[] {
    const sendActions: SendAction[] = [];

    for (let cycleIdx = 0; cycleIdx < cycles.length; cycleIdx++) {
      const cycle = cycles[cycleIdx];
      const { orders: cycleEntries, matchedAmount } = cycle;
      const n = cycleEntries.length;

      const resolvedOrders = cycleEntries.map((entry) => {
        const order = this.store.get(entry.orderId);
        if (!order) throw new Error(`[Orchestrator] Order not found: ${entry.orderId}`);
        return order;
      });

      for (let i = 0; i < n; i++) {
        const order = resolvedOrders[i];
        const receiverOrder = resolvedOrders[(i - 1 + n) % n];

        const chainKey = this.chainIdToKey.get(order.srcChain);
        if (!chainKey) {
          throw new Error(`[Orchestrator] No chain key for chainId=${order.srcChain}`);
        }

        sendActions.push({
          senderAddress: order.userAddress,
          receiverAddress: receiverOrder.userAddress,
          srcChain: order.srcChain,
          chainKey,
          amount: matchedAmount,
          cycleIdx,
        });
      }
    }

    return sendActions;
  }

  private groupActionsByChainKey(sendActions: SendAction[]): [string, SendAction[]][] {
    const groups = new Map<string, SendAction[]>();
    for (const action of sendActions) {
      // Key by chain + sender: same sender on same chain → one order (multiple fills)
      // different sender on same chain → separate orders
      const key = `${action.chainKey}:${action.senderAddress}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(action);
    }
    return [...groups.entries()];
  }

  private logCycleSummary(
    cycles: CycleMatch[],
    matchId: string,
    groupEntries: [string, SendAction[]][]
  ): void {
    console.log(
      `[Orchestrator] matchId=${matchId} — ${cycles.length} cycle(s), consolidated into ${groupEntries.length} bridge order(s)`
    );

    for (let i = 0; i < cycles.length; i++) {
      const cycle = cycles[i];
      const entry = cycle.orders[0];
      if (entry) {
        const src = this.chainIdToKey.get(entry.srcChain) ?? String(entry.srcChain);
        const des = this.chainIdToKey.get(entry.desChain) ?? String(entry.desChain);
        console.log(`[Orchestrator]   cycle ${i + 1}: ${src} <-> ${des} (${cycle.matchedAmount})`);
      }
    }
  }

  private async executePresidingOrder(
    presidingActions: SendAction[]
  ): Promise<CreateOrderResult> {
    console.log(
      `[Orchestrator] Presiding order: ${presidingActions.length} fill(s) on ${presidingActions[0].chainKey}, ` +
        `receivers=[${presidingActions.map((a) => a.receiverAddress).join(', ')}]`
    );

    const result = await bridgeService.createOrder({
      receivers: presidingActions.map((a) => a.receiverAddress),
      amounts: presidingActions.map((a) => a.amount),
      chain: presidingActions[0].chainKey,
      isPresiding: true,
      onBehalfOf: presidingActions[0].senderAddress,
    });

    console.log(
      `[Orchestrator] Presiding HTLC created — orderId=${result.orderId}, txHash=${result.htlcTxHash}`
    );

    return result;
  }

  private buildCycleHashlockMap(
    presidingActions: SendAction[],
    presidingResult: { fills: { hashlock: string }[] }
  ): Map<number, string> {
    const cycleHashlockMap = new Map<number, string>();
    for (let i = 0; i < presidingActions.length; i++) {
      cycleHashlockMap.set(presidingActions[i].cycleIdx, presidingResult.fills[i].hashlock);
    }
    return cycleHashlockMap;
  }

  private buildCycleSecretMap(
    presidingActions: SendAction[],
    presidingResult: { fills: { secret?: string }[] }
  ): Map<number, string> {
    const cycleSecretMap = new Map<number, string>();
    for (let i = 0; i < presidingActions.length; i++) {
      const secret = presidingResult.fills[i].secret;
      if (!secret) throw new Error(`[Orchestrator] No secret for presiding fill ${i}`);
      cycleSecretMap.set(presidingActions[i].cycleIdx, secret);
    }
    return cycleSecretMap;
  }

  private async executeNonPresidingOrders(
    groupEntries: [string, SendAction[]][],
    presidingKey: string,
    cycleHashlockMap: Map<number, string>
  ): Promise<{ chainKey: string; orderId: string; fills: { fillId: string }[]; actions: SendAction[] }[]> {
    const results: { chainKey: string; orderId: string; fills: { fillId: string }[]; actions: SendAction[] }[] =
      [];

    for (const [key, actions] of groupEntries) {
      if (key === presidingKey) continue;

      actions.sort((a, b) => a.cycleIdx - b.cycleIdx);

      const hashlocks = actions.map((a) => {
        const h = cycleHashlockMap.get(a.cycleIdx);
        if (!h) throw new Error(`[Orchestrator] No hashlock for cycleIdx=${a.cycleIdx}`);
        return h;
      });

      console.log(
        `[Orchestrator] Non-presiding order: ${actions.length} fill(s) on ${actions[0].chainKey}, ` +
          `sender=${actions[0].senderAddress}, receivers=[${actions.map((a) => a.receiverAddress).join(', ')}]`
      );

      const result = await bridgeService.createOrder({
        receivers: actions.map((a) => a.receiverAddress),
        amounts: actions.map((a) => a.amount),
        chain: actions[0].chainKey,
        isPresiding: false,
        hashlocks,
        onBehalfOf: actions[0].senderAddress,
      });

      console.log(
        `[Orchestrator] HTLC created — orderId=${result.orderId}, txHash=${result.htlcTxHash}`
      );

      results.push({
        chainKey: actions[0].chainKey,
        orderId: result.orderId,
        fills: result.fills.map((f) => ({ fillId: f.fillId })),
        actions,
      });
    }

    return results;
  }

  private async verifyAndWithdrawOrders(
    presidingKey: string,
    presidingActions: SendAction[],
    presidingResult: { orderId: string; fills: { fillId: string; secret?: string }[] },
    nonPresidingResults: { chainKey: string; orderId: string; fills: { fillId: string }[]; actions: SendAction[] }[],
    cycleSecretMap: Map<number, string>
  ): Promise<void> {
    // Verify and withdraw presiding order
    await this.verifyOrder(presidingKey, presidingResult.orderId, 'presiding');
    for (let i = 0; i < presidingResult.fills.length; i++) {
      const preimage = presidingResult.fills[i].secret;
      if (!preimage) throw new Error(`[Orchestrator] No preimage for presiding fill ${i}`);
      await this.withdrawFill(
        presidingKey,
        presidingResult.orderId,
        presidingResult.fills[i].fillId,
        preimage
      );
    }

    // Verify and withdraw each non-presiding order
    for (const { chainKey, orderId, fills, actions } of nonPresidingResults) {
      await this.verifyOrder(chainKey, orderId, `non-presiding (${chainKey})`);
      for (let i = 0; i < fills.length; i++) {
        const preimage = cycleSecretMap.get(actions[i].cycleIdx);
        if (!preimage) throw new Error(`[Orchestrator] No preimage for cycle ${actions[i].cycleIdx}`);
        await this.withdrawFill(chainKey, orderId, fills[i].fillId, preimage);
      }
    }
  }

  private async verifyOrder(chainKey: string, orderId: string, label: string): Promise<void> {
    const order = await bridgeService.getOrder({ orderId, chain: chainKey });
    if (order.status !== 1) {
      throw new Error(
        `[Orchestrator] Order ${orderId} on ${chainKey} (${label}) is not OPEN: status=${order.status}`
      );
    }
    console.log(
      `[Orchestrator] Verified ${label} — orderId=${orderId}, status=OPEN, fillCount=${order.fillCount}`
    );
  }

  private async withdrawFill(
    chainKey: string,
    orderId: string,
    fillId: string,
    preimage: string
  ): Promise<void> {
    const result = await bridgeService.withdraw({
      orderId,
      fillId,
      preimage,
      chain: chainKey,
    });
    console.log(
      `[Orchestrator] Withdrew from order ${orderId} fill ${fillId} on ${chainKey} — txHash=${result.txHash}`
    );
  }
}

/** Application-level singleton. */
export const orchestrator = new Orchestrator(orderStore);
