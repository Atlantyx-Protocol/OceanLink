import type { IntentOrder, CycleMatch, CycleMatchEntry } from '../types.js';

/**
 * Replays the algorithm's weight-mutation steps to map each EdgeSnapshot
 * back to a concrete IntentOrder, producing one CycleMatch per raw cycle.
 *
 * The algorithm mutates the edge list in place (splice + subtract), so we
 * maintain a parallel `simEdges` map that mirrors those mutations as we
 * iterate through each captured cycle.
 */
export function buildCycleMatches(
  activeOrders: IntentOrder[],
  chainToVertex: Map<number, number>,
  rawCycles: Array<Array<{ u: number; v: number; w: number }>>
): CycleMatch[] {
  // Working copy of edge weights keyed by order index (= edge.id).
  const simEdges = new Map<number, { u: number; v: number; w: number }>(
    activeOrders.map((order, idx) => [
      idx,
      {
        u: chainToVertex.get(order.srcChain)!,
        v: chainToVertex.get(order.desChain)!,
        w: Number(order.amount),
      },
    ])
  );

  return rawCycles.map((snapshot) => {
    const minW = Math.min(...snapshot.map((s) => s.w));
    const minSnapIdx = snapshot.findIndex((s) => s.w === minW);

    // Map each snapshot entry {u, v, w} to the matching edge id in simEdges.
    const usedIds = new Set<number>();
    const matchedIds: (number | undefined)[] = snapshot.map(({ u, v, w }) => {
      for (const [id, edge] of simEdges) {
        if (!usedIds.has(id) && edge.u === u && edge.v === v && edge.w === w) {
          usedIds.add(id);
          return id;
        }
      }
      return undefined;
    });

    // Build the per-cycle order entries.
    const orders: CycleMatchEntry[] = matchedIds
      .map((id) => {
        if (id === undefined) return null;
        const order = activeOrders[id]!;
        return {
          orderId: order.orderId,
          srcChain: order.srcChain,
          desChain: order.desChain,
          matchedAmount: String(minW),
        };
      })
      .filter((e): e is CycleMatchEntry => e !== null);

    // Replay the algorithm's mutation so the next cycle sees updated weights.
    for (let i = 0; i < matchedIds.length; i++) {
      const id = matchedIds[i];
      if (id === undefined) continue;
      if (i === minSnapIdx) {
        simEdges.delete(id);
      } else {
        simEdges.get(id)!.w -= minW;
      }
    }

    return { matchedAmount: String(minW), orders };
  });
}
