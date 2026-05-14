import { randomUUID } from 'node:crypto';
import { runMaxFlow } from '../algorithm/maxFlow.js';
import type { Edge, EdgeSnapshot } from '../algorithm/algorithm.js';
import { orderStore } from '../store/orderStore.js';
import type { OrderStore } from '../store/orderStore.js';
import { orderEvents } from '../../events/orderEvents.js';
import { getMatchThreshold } from '../../../config/constants.js';
import { validateAndCreateOrder } from './orderValidator.js';
import { buildCycleMatches } from './cycleMapper.js';
import type {
  IntentOrder,
  MatchResult,
  MatchedOrderEntry,
  CycleMatch,
  CycleMatchEntry,
  CreateIntentInput,
  TickStats,
} from '../types.js';

// ---------------------------------------------------------------------------
// runAlgorithm adapter — design notes
//
// runAlgorithm(n, edges, x): EdgeSnapshot[][]
//   n      — number of distinct vertices (chain indices, 0-based)
//   edges  — directed weighted edge list, MUTATED IN PLACE by the algorithm
//   x      — threshold ratio: a cycle is matched only when min_w/max_w > x
//
// Mapping  IntentOrder  →  Edge:
//   edge.id  = index of the order in the snapshot array passed to the algorithm
//   edge.u   = chainToVertex[order.srcChain]
//   edge.v   = chainToVertex[order.desChain]
//   edge.w   = Number(order.amount)
//
//   ⚠ Precision note: amount is stored as a decimal string; converting to
//   Number() is safe for USDC values up to ~9 × 10^15 micro-units
//   (≈ 9 quadrillion micro-USDC, or 9 billion USDC).  For amounts beyond
//   that, replace with a BigInt-aware graph implementation.
//
// Interpreting the mutation after the algorithm runs:
//   • edge.id no longer in the surviving edge list  →  order FULLY MATCHED
//     (its edge was the minimum-weight edge in a cycle and was splice-d out)
//   • edge.id still present but edge.w < originalWeight  →  order PARTIAL
//     (minW was subtracted from it; the remainder stays in the queue)
//
// If the runAlgorithm signature ever changes, update the adapter below and
// mark the old adapter with a TODO: ADAPTER UPDATE REQUIRED comment.
// ---------------------------------------------------------------------------

/** Type alias so tests can inject a mock without importing the concrete fn. */
export type AlgorithmFn = (n: number, edges: Edge[], x: number) => EdgeSnapshot[][];

export class MatchingService {
  constructor(
    private readonly store: OrderStore,
    /**
     * The matching algorithm to use.  Defaults to the built-in runAlgorithm.
     * Pass a mock here in tests to verify the adapter contract.
     */
    private readonly algorithmFn: AlgorithmFn = runMaxFlow,
    /**
     * Ratio threshold for the algorithm.  A cycle is only matched when
     *   min_amount / max_amount  >  threshold
     * ENV: MATCH_THRESHOLD (default 0)
     */
    private readonly threshold: number = getMatchThreshold()
  ) {}

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Validates input, creates an IntentOrder, stores it, and returns it.
   * Returns { error } on validation failure.
   */
  createOrder(input: CreateIntentInput): { order: IntentOrder } | { error: string } {
    const result = validateAndCreateOrder(input);
    if ('error' in result) return result;

    const { order } = result;
    this.store.add(order);

    orderEvents.publish({
      orderId: order.orderId,
      type: 'queued',
      message: `Order queued (${order.srcChain} → ${order.desChain}, amount=${order.amount})`,
      data: { srcChain: order.srcChain, desChain: order.desChain, amount: order.amount },
    });

    return { order };
  }

  /**
   * Executes one full matching tick:
   *   1. Expire stale orders (deadline < now).
   *   2. Collect active orders (QUEUED + PARTIAL).
   *   3. Build graph input for runAlgorithm.
   *   4. Run the algorithm; interpret mutations to determine MATCHED / PARTIAL.
   *   5. Persist MatchResult records; update order statuses.
   *   6. Return TickStats for the caller (scheduler) to log.
   */
  runTick(): TickStats {
    const expired = this.store.expireStale();
    const activeOrders = this.store.getActiveOrders();
    const queuedBefore = activeOrders.length;

    const matchResults = this.runMatchingPass(activeOrders);

    const queuedAfter = this.store.getActiveOrders().length;
    const matchedOrders = matchResults.flatMap((r) =>
      r.orders.filter((o) => o.status === 'MATCHED')
    ).length;
    const partialOrders = matchResults.flatMap((r) =>
      r.orders.filter((o) => o.status === 'PARTIAL')
    ).length;

    return {
      queuedBefore,
      expired,
      matchResults,
      matchedOrders,
      partialOrders,
      queuedAfter,
    };
  }

  // -------------------------------------------------------------------------
  // Internal — matching pass (also used in tests)
  // -------------------------------------------------------------------------

  /**
   * Core matching logic.  Accepts an explicit order list so tests can
   * control exactly which orders are fed into the algorithm.
   *
   * @returns array of MatchResult produced (one per qualifying cycle group).
   */
  runMatchingPass(activeOrders: IntentOrder[]): MatchResult[] {
    if (activeOrders.length === 0) return [];

    // -- Step 1: map chainId → vertex index (0-based) ---------------------
    const chainToVertex = new Map<number, number>();
    for (const order of activeOrders) {
      if (!chainToVertex.has(order.srcChain)) {
        chainToVertex.set(order.srcChain, chainToVertex.size);
      }
      if (!chainToVertex.has(order.desChain)) {
        chainToVertex.set(order.desChain, chainToVertex.size);
      }
    }
    const n = chainToVertex.size;

    // -- Step 2: build Edge[] from orders ---------------------------------
    // IMPORTANT: edge.id === index into activeOrders so we can map back after
    const edges: Edge[] = activeOrders.map((order, idx) => ({
      id: idx,
      u: chainToVertex.get(order.srcChain)!,
      v: chainToVertex.get(order.desChain)!,
      w: Number(order.amount), // see precision note at top of file
    }));

    // Snapshot original state before the algorithm mutates edges
    const originalWeights = new Map<number, number>(edges.map((e) => [e.id, e.w]));
    const originalIds = new Set(edges.map((e) => e.id));

    // -- Step 3: run algorithm (MUTATES edges) ----------------------------
    // TODO: ADAPTER UPDATE REQUIRED if runAlgorithm signature changes
    const rawCycles = this.algorithmFn(n, edges, this.threshold);

    if (rawCycles.length === 0) return [];

    // -- Step 4: build per-cycle breakdown FIRST ---------------------------
    // cycleMapper reads activeOrders[i].amount to identify which order each
    // snapshot edge corresponds to. Once we start mutating store amounts via
    // `this.store.update(..., { amount: ... })` below, those amounts get
    // overwritten with residuals (Object.assign in OrderStore.update mutates
    // the same object reference activeOrders holds), so the snapshot ↔ order
    // lookup would fail for any order participating in multiple cycles. Call
    // cycleMapper here while amounts still reflect the pre-tick originals.
    const cycles = buildCycleMatches(activeOrders, chainToVertex, rawCycles);

    // -- Step 5: interpret mutations to determine order outcomes ----------
    const remainingIds = new Set(edges.map((e) => e.id));

    const matchedEntries: MatchedOrderEntry[] = [];

    for (const id of originalIds) {
      const order = activeOrders[id];
      const originalW = originalWeights.get(id)!;

      if (!remainingIds.has(id)) {
        // Edge was splice-d out → order FULLY MATCHED
        matchedEntries.push({
          orderId: order.orderId,
          srcChain: order.srcChain,
          desChain: order.desChain,
          matchedAmount: String(originalW),
          remainingAmount: '0',
          status: 'MATCHED',
        });
        this.store.update(order.orderId, { status: 'MATCHED' });
        this.store.removeFromPairIndex(order.orderId);
      } else {
        // Edge survived — check whether its weight was reduced
        const survivingEdge = edges.find((e) => e.id === id)!;
        if (survivingEdge.w < originalW) {
          const consumed = originalW - survivingEdge.w;

          if (survivingEdge.w === 0) {
            // Weight reduced to exactly 0 → fully consumed, same as MATCHED.
            // This happens when two equal-weight edges are in a cycle: the
            // algorithm removes the first (by findIndex) and zeroes the second.
            matchedEntries.push({
              orderId: order.orderId,
              srcChain: order.srcChain,
              desChain: order.desChain,
              matchedAmount: String(consumed),
              remainingAmount: '0',
              status: 'MATCHED',
            });
            this.store.update(order.orderId, { status: 'MATCHED' });
            this.store.removeFromPairIndex(order.orderId);
          } else {
            // Weight reduced but still > 0 → genuinely partial
            matchedEntries.push({
              orderId: order.orderId,
              srcChain: order.srcChain,
              desChain: order.desChain,
              matchedAmount: String(consumed),
              remainingAmount: String(survivingEdge.w),
              status: 'PARTIAL',
            });
            // Update stored amount to remaining so the next tick uses the
            // correct (reduced) weight for this order.
            this.store.update(order.orderId, {
              status: 'PARTIAL',
              amount: String(survivingEdge.w),
            });
          }
        }
      }
    }

    if (matchedEntries.length === 0) return [];

    // -- Step 6: build and persist the MatchResult -----------------------
    const result: MatchResult = {
      matchId: randomUUID(),
      matchedAt: Math.floor(Date.now() / 1000),
      orders: matchedEntries,
      cycles,
      rawCycles,
    };
    this.store.addMatchResult(result);

    for (const entry of matchedEntries) {
      orderEvents.publish({
        orderId: entry.orderId,
        type: 'matched',
        message: `Order matched (${entry.status}, matchedAmount=${entry.matchedAmount})`,
        data: {
          matchId: result.matchId,
          status: entry.status,
          matchedAmount: entry.matchedAmount,
          remainingAmount: entry.remainingAmount,
        },
      });
    }

    return [result];
  }
}

/** Application-level singleton. */
export const matchingService = new MatchingService(orderStore);
