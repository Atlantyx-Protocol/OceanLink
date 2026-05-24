import { bridgeService, type CreateOrderResult } from '../execution/bridge.js';
import { orderStore } from '../matching/store/orderStore.js';
import type { OrderStore } from '../matching/store/orderStore.js';
import type { CycleMatch, MatchResult } from '../matching/types.js';
import { orderEvents } from '../events/orderEvents.js';
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

// re-export types for consumers
export type { ExecutionWithdraw, ExecutionData, ExecutionRecord };

// turns matched cycles into on-chain HTLC orders via bridgeService.createOrder().
// cycles become "send actions"; actions on the same chain are consolidated
// into one bridge order with multiple receivers. the first group is the
// "presiding" order that generates fresh secrets; the rest reuse hashlocks
// for atomic unlocking.

export class Orchestrator {
  private readonly chainIdToKey: Map<number, string>;
  private readonly executionStore = new ExecutionStore();

  constructor(private readonly store: OrderStore) {
    this.chainIdToKey = buildChainIdMap();
  }

  // loads persisted execution records into memory; call once on boot
  async hydrate(): Promise<void> {
    await this.executionStore.hydrate();
  }

  getExecution(matchId: string): ExecutionRecord | undefined {
    return this.executionStore.get(matchId);
  }

  // entry point — called by the scheduler after each tick
  async handleMatchResults(matchResults: MatchResult[]): Promise<void> {
    for (const result of matchResults) {
      this.executionStore.set(result.matchId, { status: 'pending' });
      const orderIds = result.orders.map((o) => o.orderId);
      try {
        await this.executeConsolidated(result.cycles, result.matchId, orderIds);

        // flip each order's status to COMPLETED so the activity feed reflects
        // on-chain settlement (matchingService only sets MATCHED, which means
        // "engine matched", not "settled").
        for (const orderId of orderIds) {
          this.store.update(orderId, { status: 'COMPLETED' });
        }

        orderEvents.publishMany(orderIds, {
          type: 'done',
          message: 'Bridge execution completed',
          data: { matchId: result.matchId },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.executionStore.set(result.matchId, { status: 'error', error: msg });

        for (const orderId of orderIds) {
          this.store.update(orderId, { status: 'FAILED' });
        }

        console.error(
          `[Orchestrator] Consolidated execution failed (matchId=${result.matchId}):`,
          err
        );

        orderEvents.publishMany(orderIds, {
          type: 'error',
          message: `Bridge execution failed: ${msg}`,
          data: { matchId: result.matchId },
        });
      }
    }
  }

  // core consolidated execution
  private async executeConsolidated(
    cycles: CycleMatch[],
    matchId: string,
    orderIds: string[]
  ): Promise<void> {
    if (cycles.length === 0) return;

    const sendActions = extractSendActionsFromCycles(cycles, this.store, this.chainIdToKey);
    const groupEntries = groupActionsByChainKey(sendActions);

    logCycleSummary(cycles, matchId, groupEntries, this.chainIdToKey);

    orderEvents.publishMany(orderIds, {
      type: 'plan',
      message: `Execution plan: ${cycles.length} cycle(s), ${groupEntries.length} HTLC group(s) — expect ${groupEntries.length} htlc_created and ${groupEntries.length} withdrawal(s)`,
      data: {
        matchId,
        cycles: cycles.length,
        groups: groupEntries.map(([key, actions]) => ({
          key,
          chain: actions[0].chainKey,
          sender: actions[0].senderAddress,
          receivers: actions.map((a) => a.receiverAddress),
          fills: actions.length,
        })),
      },
    });

    const [presidingKey, presidingActions] = groupEntries[0];
    const presidingChainKey = presidingActions[0].chainKey; // actual chain, separate from group key
    const presidingResult = await this.executePresidingOrder(presidingActions);

    orderEvents.publishMany(orderIds, {
      type: 'htlc_created',
      message: `HTLC created on ${presidingChainKey} (presiding)`,
      data: {
        chain: presidingChainKey,
        orderId: presidingResult.orderId,
        txHash: presidingResult.htlcTxHash,
      },
    });

    const cycleHashlockMap = buildCycleHashlockMap(presidingActions, presidingResult);
    const cycleSecretMap = buildCycleSecretMap(presidingActions, presidingResult);

    const nonPresidingResults = await this.executeNonPresidingOrders(
      groupEntries,
      presidingKey,
      cycleHashlockMap
    );

    for (const r of nonPresidingResults) {
      orderEvents.publishMany(orderIds, {
        type: 'htlc_created',
        message: `HTLC created on ${r.chainKey} (txHash=${r.htlcTxHash})`,
        data: { chain: r.chainKey, orderId: r.orderId, txHash: r.htlcTxHash },
      });
    }

    const withdrawTxs = await this.verifyAndWithdrawOrders(
      presidingChainKey,
      presidingActions,
      presidingResult,
      nonPresidingResults,
      cycleSecretMap
    );

    orderEvents.publishMany(orderIds, {
      type: 'withdrawn',
      message:
        `${withdrawTxs.length} withdrawal(s) completed — ` +
        withdrawTxs.map((w) => `${w.chain}:${w.txHash}`).join(', '),
      data: { withdrawals: withdrawTxs },
    });

    console.log(`[Orchestrator] All ${groupEntries.length} consolidated order(s) on-chain`);

    // build and store execution record for API access
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

    this.executionStore.set(matchId, { status: 'done', data: executionData });
  }

  private async executePresidingOrder(presidingActions: SendAction[]): Promise<CreateOrderResult> {
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

  private async executeNonPresidingOrders(
    groupEntries: [string, SendAction[]][],
    presidingKey: string,
    cycleHashlockMap: Map<number, string>
  ): Promise<
    {
      chainKey: string;
      orderId: string;
      htlcTxHash: string;
      fills: { fillId: string }[];
      actions: SendAction[];
    }[]
  > {
    const results: {
      chainKey: string;
      orderId: string;
      htlcTxHash: string;
      fills: { fillId: string }[];
      actions: SendAction[];
    }[] = [];

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
        htlcTxHash: result.htlcTxHash,
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
    nonPresidingResults: {
      chainKey: string;
      orderId: string;
      fills: { fillId: string }[];
      actions: SendAction[];
    }[],
    cycleSecretMap: Map<number, string>
  ): Promise<{ chain: string; txHash: string }[]> {
    const withdrawTxs: { chain: string; txHash: string }[] = [];

    // verify and withdraw presiding order
    await this.verifyOrder(presidingKey, presidingResult.orderId, 'presiding');
    for (let i = 0; i < presidingResult.fills.length; i++) {
      const preimage = presidingResult.fills[i].secret;
      if (!preimage) throw new Error(`[Orchestrator] No preimage for presiding fill ${i}`);
      const txHash = await this.withdrawFill(
        presidingKey,
        presidingResult.orderId,
        presidingResult.fills[i].fillId,
        preimage
      );
      withdrawTxs.push({ chain: presidingKey, txHash });
    }

    // verify and withdraw each non-presiding order
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
    const result = await bridgeService.withdraw({
      orderId,
      fillId,
      preimage,
      chain: chainKey,
    });
    console.log(
      `[Orchestrator] Withdrew from order ${orderId} fill ${fillId} on ${chainKey} — txHash=${result.txHash}`
    );
    return result.txHash;
  }
}

// application-level singleton
export const orchestrator = new Orchestrator(orderStore);
