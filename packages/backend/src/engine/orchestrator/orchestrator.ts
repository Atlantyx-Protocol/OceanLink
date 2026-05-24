import { bridgeService, type CreateOrderResult } from '../execution/bridge.js';
import { orderStore } from '../matching/store/orderStore.js';
import type { OrderStore } from '../matching/store/orderStore.js';
import type { CycleMatch, MatchResult } from '../matching/types.js';
import { orderEvents, type OrderEventType } from '../events/orderEvents.js';
import {
  type SendAction,
  buildChainIdMap,
  extractSendActionsFromCycles,
  groupActionsByChainKey,
  buildCycleHashlockMap,
  buildCycleSecretMap,
  logCycleSummary,
} from './cycleActions.js';
import {
  ExecutionStore,
  type ExecutionData,
  type ExecutionRecord,
  type ExecutionWithdraw,
} from './executionStore.js';

export type { ExecutionWithdraw, ExecutionData, ExecutionRecord };

// turns matched cycles into on-chain HTLC orders via bridgeService.
// cycles → "send actions" → grouped by (chain, sender) into bridge orders.
// the first group is the presiding order (generates fresh secrets); the rest
// reuse the same hashlocks so withdrawals unlock atomically.

type WithdrawTx = { chain: string; txHash: string };

interface NonPresidingResult {
  chainKey: string;
  orderId: string;
  htlcTxHash: string;
  fills: { fillId: string }[];
  actions: SendAction[];
}

export class Orchestrator {
  private readonly chainIdToKey: Map<number, string>;
  private readonly executionStore = new ExecutionStore();

  constructor(private readonly store: OrderStore) {
    this.chainIdToKey = buildChainIdMap();
  }

  async hydrate(): Promise<void> {
    await this.executionStore.hydrate();
  }

  getExecution(matchId: string): ExecutionRecord | undefined {
    return this.executionStore.get(matchId);
  }

  // entry point — called by the scheduler after each tick
  async handleMatchResults(matchResults: MatchResult[]): Promise<void> {
    for (const result of matchResults) {
      await this.handleSingleMatch(result);
    }
  }

  private async handleSingleMatch(result: MatchResult): Promise<void> {
    const { matchId, cycles } = result;
    const orderIds = result.orders.map((o) => o.orderId);

    this.executionStore.set(matchId, { status: 'pending' });

    try {
      await this.executeConsolidated(cycles, matchId, orderIds);
      this.markOrdersCompleted(orderIds);
      this.publish(orderIds, 'done', 'Bridge execution completed', { matchId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.executionStore.set(matchId, { status: 'error', error: msg });
      this.markOrdersFailed(orderIds);
      console.error(
        `[Orchestrator] Consolidated execution failed (matchId=${matchId}):`,
        err
      );
      this.publish(orderIds, 'error', `Bridge execution failed: ${msg}`, { matchId });
    }
  }

  private markOrdersCompleted(orderIds: string[]): void {
    for (const id of orderIds) this.store.update(id, { status: 'COMPLETED' });
  }

  private markOrdersFailed(orderIds: string[]): void {
    for (const id of orderIds) this.store.update(id, { status: 'FAILED' });
  }

  private publish(
    orderIds: string[],
    type: OrderEventType,
    message: string,
    data: Record<string, unknown>
  ): void {
    orderEvents.publishMany(orderIds, { type, message, data });
  }

  private async executeConsolidated(
    cycles: CycleMatch[],
    matchId: string,
    orderIds: string[]
  ): Promise<void> {
    if (cycles.length === 0) return;

    const sendActions = extractSendActionsFromCycles(cycles, this.store, this.chainIdToKey);
    const groupEntries = groupActionsByChainKey(sendActions);

    logCycleSummary(cycles, matchId, groupEntries, this.chainIdToKey);
    this.publishExecutionPlan(orderIds, matchId, cycles.length, groupEntries);

    const [presidingKey, presidingActions] = groupEntries[0];
    const presidingChainKey = presidingActions[0].chainKey;
    const presidingResult = await this.executePresidingOrder(presidingActions);

    this.publish(orderIds, 'htlc_created', `HTLC created on ${presidingChainKey} (presiding)`, {
      chain: presidingChainKey,
      orderId: presidingResult.orderId,
      txHash: presidingResult.htlcTxHash,
    });

    const cycleHashlockMap = buildCycleHashlockMap(presidingActions, presidingResult);
    const cycleSecretMap = buildCycleSecretMap(presidingActions, presidingResult);

    const nonPresidingResults = await this.executeNonPresidingOrders(
      groupEntries,
      presidingKey,
      cycleHashlockMap
    );

    for (const r of nonPresidingResults) {
      this.publish(orderIds, 'htlc_created', `HTLC created on ${r.chainKey} (txHash=${r.htlcTxHash})`, {
        chain: r.chainKey,
        orderId: r.orderId,
        txHash: r.htlcTxHash,
      });
    }

    const withdrawTxs = await this.verifyAndWithdrawAll(
      presidingChainKey,
      presidingResult,
      nonPresidingResults,
      cycleSecretMap
    );

    this.publish(orderIds, 'withdrawn',
      `${withdrawTxs.length} withdrawal(s) completed — ` +
        withdrawTxs.map((w) => `${w.chain}:${w.txHash}`).join(', '),
      { withdrawals: withdrawTxs }
    );

    console.log(`[Orchestrator] All ${groupEntries.length} consolidated order(s) on-chain`);

    const executionData = buildExecutionData(
      presidingChainKey,
      presidingActions,
      presidingResult,
      nonPresidingResults,
      cycleSecretMap
    );

    this.executionStore.set(matchId, { status: 'done', data: executionData });
  }

  private publishExecutionPlan(
    orderIds: string[],
    matchId: string,
    cycleCount: number,
    groupEntries: [string, SendAction[]][]
  ): void {
    this.publish(orderIds, 'plan',
      `Execution plan: ${cycleCount} cycle(s), ${groupEntries.length} HTLC group(s) — expect ${groupEntries.length} htlc_created and ${groupEntries.length} withdrawal(s)`,
      {
        matchId,
        cycles: cycleCount,
        groups: groupEntries.map(([key, actions]) => ({
          key,
          chain: actions[0].chainKey,
          sender: actions[0].senderAddress,
          receivers: actions.map((a) => a.receiverAddress),
          fills: actions.length,
        })),
      }
    );
  }

  private async executePresidingOrder(actions: SendAction[]): Promise<CreateOrderResult> {
    const chain = actions[0].chainKey;
    console.log(
      `[Orchestrator] Presiding order: ${actions.length} fill(s) on ${chain}, ` +
        `receivers=[${actions.map((a) => a.receiverAddress).join(', ')}]`
    );

    const result = await bridgeService.createOrder({
      receivers: actions.map((a) => a.receiverAddress),
      amounts: actions.map((a) => a.amount),
      chain,
      isPresiding: true,
      onBehalfOf: actions[0].senderAddress,
    });

    console.log(
      `[Orchestrator] Presiding HTLC created — orderId=${result.orderId}, txHash=${result.htlcTxHash}`
    );
    return result;
  }

  private async executeNonPresidingOrders(
    groupEntries: [string, SendAction[]][],
    presidingKey: string,
    cycleHashlockMap: Map<number, string>
  ): Promise<NonPresidingResult[]> {
    const results: NonPresidingResult[] = [];

    for (const [key, actions] of groupEntries) {
      if (key === presidingKey) continue;
      actions.sort((a, b) => a.cycleIdx - b.cycleIdx);

      const hashlocks = actions.map((a) => {
        const h = cycleHashlockMap.get(a.cycleIdx);
        if (!h) throw new Error(`[Orchestrator] No hashlock for cycleIdx=${a.cycleIdx}`);
        return h;
      });

      const chain = actions[0].chainKey;
      console.log(
        `[Orchestrator] Non-presiding order: ${actions.length} fill(s) on ${chain}, ` +
          `sender=${actions[0].senderAddress}, receivers=[${actions.map((a) => a.receiverAddress).join(', ')}]`
      );

      const result = await bridgeService.createOrder({
        receivers: actions.map((a) => a.receiverAddress),
        amounts: actions.map((a) => a.amount),
        chain,
        isPresiding: false,
        hashlocks,
        onBehalfOf: actions[0].senderAddress,
      });

      console.log(
        `[Orchestrator] HTLC created — orderId=${result.orderId}, txHash=${result.htlcTxHash}`
      );

      results.push({
        chainKey: chain,
        orderId: result.orderId,
        htlcTxHash: result.htlcTxHash,
        fills: result.fills.map((f) => ({ fillId: f.fillId })),
        actions,
      });
    }

    return results;
  }

  private async verifyAndWithdrawAll(
    presidingChainKey: string,
    presidingResult: CreateOrderResult,
    nonPresidingResults: NonPresidingResult[],
    cycleSecretMap: Map<number, string>
  ): Promise<WithdrawTx[]> {
    const withdrawTxs: WithdrawTx[] = [];

    await this.verifyOrder(presidingChainKey, presidingResult.orderId, 'presiding');
    for (let i = 0; i < presidingResult.fills.length; i++) {
      const preimage = presidingResult.fills[i].secret;
      if (!preimage) throw new Error(`[Orchestrator] No preimage for presiding fill ${i}`);
      const txHash = await this.withdrawFill(
        presidingChainKey,
        presidingResult.orderId,
        presidingResult.fills[i].fillId,
        preimage
      );
      withdrawTxs.push({ chain: presidingChainKey, txHash });
    }

    for (const { chainKey, orderId, fills, actions } of nonPresidingResults) {
      await this.verifyOrder(chainKey, orderId, `non-presiding (${chainKey})`);
      for (let i = 0; i < fills.length; i++) {
        const preimage = cycleSecretMap.get(actions[i].cycleIdx);
        if (!preimage)
          throw new Error(`[Orchestrator] No preimage for cycle ${actions[i].cycleIdx}`);
        const txHash = await this.withdrawFill(chainKey, orderId, fills[i].fillId, preimage);
        withdrawTxs.push({ chain: chainKey, txHash });
      }
    }

    return withdrawTxs;
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
  ): Promise<string> {
    const result = await bridgeService.withdraw({ orderId, fillId, preimage, chain: chainKey });
    console.log(
      `[Orchestrator] Withdrew from order ${orderId} fill ${fillId} on ${chainKey} — txHash=${result.txHash}`
    );
    return result.txHash;
  }
}

function buildExecutionData(
  presidingChainKey: string,
  presidingActions: SendAction[],
  presidingResult: CreateOrderResult,
  nonPresidingResults: NonPresidingResult[],
  cycleSecretMap: Map<number, string>
): ExecutionData {
  return {
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
}

export const orchestrator = new Orchestrator(orderStore);
