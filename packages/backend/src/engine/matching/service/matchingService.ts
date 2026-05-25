import { randomUUID } from 'node:crypto';
import { runCycleReduction } from '../algorithm/cycleReduction.js';
import type { Edge, EdgeSnapshot } from '../types.js';
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
  CreateIntentInput,
  TickStats,
} from '../types.js';

export type AlgorithmFn = (n: number, edges: Edge[], x: number) => EdgeSnapshot[][];

export class MatchingService {
  constructor(
    private readonly store: OrderStore,
    private readonly algorithmFn: AlgorithmFn = runCycleReduction,
    private readonly threshold: number = getMatchThreshold() // cycle matched only when min/max > threshold
  ) {}

  // validates input, creates an IntentOrder, stores it
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

  // one full matching tick: expire stale, run algorithm, persist results.
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

  // core matching logic. takes an explicit order list so tests can control input.
  runMatchingPass(activeOrders: IntentOrder[]): MatchResult[] {
    if (activeOrders.length === 0) return [];

    // map chainId → vertex index (0-based)
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

    // build Edge[] from orders. edge.id === index into activeOrders for mapping back.
    const edges: Edge[] = activeOrders.map((order, idx) => ({
      id: idx,
      u: chainToVertex.get(order.srcChain)!,
      v: chainToVertex.get(order.desChain)!,
      w: Number(order.amount), // see precision note at top of file
    }));

    // snapshot original state before the algorithm mutates edges
    const originalWeights = new Map<number, number>(edges.map((e) => [e.id, e.w]));
    const originalIds = new Set(edges.map((e) => e.id));

    // run algorithm (mutates edges)
    const rawCycles = this.algorithmFn(n, edges, this.threshold);

    if (rawCycles.length === 0) return [];

    // build per-cycle breakdown BEFORE mutating store amounts — cycleMapper
    // reads activeOrders[i].amount to match snapshot edges to orders, and
    // store.update() (via Object.assign) overwrites those amounts with residuals.
    const cycles = buildCycleMatches(activeOrders, chainToVertex, rawCycles);

    // interpret mutations to determine order outcomes
    const remainingIds = new Set(edges.map((e) => e.id));

    const matchedEntries: MatchedOrderEntry[] = [];

    for (const id of originalIds) {
      const order = activeOrders[id];
      const originalW = originalWeights.get(id)!;

      if (!remainingIds.has(id)) {
        // edge was splice-d out → order fully MATCHED
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
        // edge survived — check whether its weight was reduced
        const survivingEdge = edges.find((e) => e.id === id)!;
        if (survivingEdge.w < originalW) {
          const consumed = originalW - survivingEdge.w;

          if (survivingEdge.w === 0) {
            // weight reduced to exactly 0 → fully consumed, treat as MATCHED.
            // happens when two equal-weight edges share a cycle.
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
            // weight reduced but still > 0 → genuinely partial
            matchedEntries.push({
              orderId: order.orderId,
              srcChain: order.srcChain,
              desChain: order.desChain,
              matchedAmount: String(consumed),
              remainingAmount: String(survivingEdge.w),
              status: 'PARTIAL',
            });
            // update stored amount to remainder so the next tick sees the reduced weight.
            this.store.update(order.orderId, {
              status: 'PARTIAL',
              amount: String(survivingEdge.w),
            });
          }
        }
      }
    }

    if (matchedEntries.length === 0) return [];

    // build and persist the MatchResult
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

// app-level singleton.
export const matchingService = new MatchingService(orderStore);
