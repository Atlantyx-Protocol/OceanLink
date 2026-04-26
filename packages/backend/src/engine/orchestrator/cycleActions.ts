import type { OrderStore } from '../matching/store/orderStore.js';
import type { CycleMatch } from '../matching/types.js';
import { getAllChainConfigs } from '../../config/chains.js';

/** A single directed send extracted from a cycle. */
export interface SendAction {
  senderAddress: string;
  receiverAddress: string;
  srcChain: number;
  chainKey: string;
  amount: string;
  cycleIdx: number;
}

/** chainId → chain key string (e.g. 11155111 → 'sepolia') */
export function buildChainIdMap(): Map<number, string> {
  const map = new Map<number, string>();
  for (const [key, config] of Object.entries(getAllChainConfigs())) {
    map.set(config.chainId, key);
  }
  return map;
}

/**
 * Extracts send actions from matched cycles by resolving orders from the store
 * and determining sender/receiver relationships within each cycle.
 */
export function extractSendActionsFromCycles(
  cycles: CycleMatch[],
  store: OrderStore,
  chainIdToKey: Map<number, string>
): SendAction[] {
  const sendActions: SendAction[] = [];

  for (let cycleIdx = 0; cycleIdx < cycles.length; cycleIdx++) {
    const cycle = cycles[cycleIdx];
    const { orders: cycleEntries, matchedAmount } = cycle;
    const n = cycleEntries.length;

    const resolvedOrders = cycleEntries.map((entry) => {
      const order = store.get(entry.orderId);
      if (!order) throw new Error(`[Orchestrator] Order not found: ${entry.orderId}`);
      return order;
    });

    for (let i = 0; i < n; i++) {
      const order = resolvedOrders[i];
      const receiverOrder = resolvedOrders[(i - 1 + n) % n];

      const chainKey = chainIdToKey.get(order.srcChain);
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

/**
 * Groups send actions by chain key + sender address.
 * Same sender on the same chain → consolidated into one HTLC order (multiple fills).
 */
export function groupActionsByChainKey(sendActions: SendAction[]): [string, SendAction[]][] {
  const groups = new Map<string, SendAction[]>();
  for (const action of sendActions) {
    const key = `${action.chainKey}:${action.senderAddress}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(action);
  }
  return [...groups.entries()];
}

/**
 * Builds a mapping of cycleIdx → hashlock from presiding order fills.
 */
export function buildCycleHashlockMap(
  presidingActions: SendAction[],
  presidingResult: { fills: { hashlock: string }[] }
): Map<number, string> {
  const map = new Map<number, string>();
  for (let i = 0; i < presidingActions.length; i++) {
    map.set(presidingActions[i].cycleIdx, presidingResult.fills[i].hashlock);
  }
  return map;
}

/**
 * Builds a mapping of cycleIdx → secret from presiding order fills.
 */
export function buildCycleSecretMap(
  presidingActions: SendAction[],
  presidingResult: { fills: { secret?: string }[] }
): Map<number, string> {
  const map = new Map<number, string>();
  for (let i = 0; i < presidingActions.length; i++) {
    const secret = presidingResult.fills[i].secret;
    if (!secret) throw new Error(`[Orchestrator] No secret for presiding fill ${i}`);
    map.set(presidingActions[i].cycleIdx, secret);
  }
  return map;
}

/**
 * Logs a summary of matched cycles and their consolidation groups.
 */
export function logCycleSummary(
  cycles: CycleMatch[],
  matchId: string,
  groupEntries: [string, SendAction[]][],
  chainIdToKey: Map<number, string>
): void {
  console.log(
    `[Orchestrator] matchId=${matchId} — ${cycles.length} cycle(s), consolidated into ${groupEntries.length} bridge order(s)`
  );

  for (let i = 0; i < cycles.length; i++) {
    const cycle = cycles[i];
    const entry = cycle.orders[0];
    if (entry) {
      const src = chainIdToKey.get(entry.srcChain) ?? String(entry.srcChain);
      const des = chainIdToKey.get(entry.desChain) ?? String(entry.desChain);
      console.log(`[Orchestrator]   cycle ${i + 1}: ${src} <-> ${des} (${cycle.matchedAmount})`);
    }
  }
}
