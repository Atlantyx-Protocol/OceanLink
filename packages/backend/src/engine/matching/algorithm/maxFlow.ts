// cycle-cancellation max-circulation matching.
// enumerates 2-cycles then 3-cycles, greedily picking the largest bottleneck
// per pattern (ratio ≥ x). one order per leg, no aggregation, so cycles stay
// clean N-tuples for HTLC settlement. 4+ chain cycles are skipped (rare).

import type { Edge, EdgeSnapshot } from '../types.js';

export type { Edge, EdgeSnapshot } from '../types.js';

// splice out the min-weight edge and subtract minW from the rest in-place.
// pre-mutation weights are captured by the caller's snapshot.
function applyCancellation(edges: Edge[], cycle: Edge[], minW: number): void {
  const minIdx = cycle.findIndex((e) => e.w === minW);
  const minEdge = cycle[minIdx]!;

  for (let i = 0; i < cycle.length; i++) {
    if (i !== minIdx) cycle[i]!.w -= minW;
  }

  const edgeIdx = edges.indexOf(minEdge);
  if (edgeIdx >= 0) edges.splice(edgeIdx, 1);
}

function snapshotOf(cycle: Edge[]): EdgeSnapshot[] {
  return cycle.map((e) => ({ u: e.u, v: e.v, w: e.w }));
}

// finds the largest-bottleneck 2-cycle satisfying the ratio threshold.
function findBest2Cycle(edges: Edge[], n: number, threshold: number): [Edge, Edge] | null {
  // group edges by (u, v) for O(1) leg lookup.
  const byUV = new Map<number, Edge[]>();
  for (const e of edges) {
    if (e.w <= 0) continue;
    const key = e.u * n + e.v;
    const list = byUV.get(key);
    if (list) list.push(e);
    else byUV.set(key, [e]);
  }

  let best: { a: Edge; b: Edge; bottleneck: number } | null = null;

  for (let u = 0; u < n; u++) {
    for (let v = u + 1; v < n; v++) {
      const ab = byUV.get(u * n + v);
      const ba = byUV.get(v * n + u);
      if (!ab || !ba) continue;

      for (const a of ab) {
        for (const b of ba) {
          const min = a.w < b.w ? a.w : b.w;
          const max = a.w > b.w ? a.w : b.w;
          if (min <= 0) continue;
          if (min / max < threshold) continue;
          if (!best || min > best.bottleneck) {
            best = { a, b, bottleneck: min };
          }
        }
      }
    }
  }

  return best ? [best.a, best.b] : null;
}

// enumerates 3-cycle patterns canonically (rotation starts at smallest vertex
// to avoid emitting the same cycle thrice).
function enumerate3CyclePatterns(n: number): number[][] {
  const patterns: number[][] = [];
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (b === a) continue;
      for (let c = 0; c < n; c++) {
        if (c === a || c === b) continue;
        if (a < b && a < c) patterns.push([a, b, c]); // canonical rotation
      }
    }
  }
  return patterns;
}

function findBest3Cycle(edges: Edge[], n: number, threshold: number): [Edge, Edge, Edge] | null {
  const byUV = new Map<number, Edge[]>();
  for (const e of edges) {
    if (e.w <= 0) continue;
    const key = e.u * n + e.v;
    const list = byUV.get(key);
    if (list) list.push(e);
    else byUV.set(key, [e]);
  }

  let best: { ab: Edge; bc: Edge; ca: Edge; bottleneck: number } | null = null;

  for (const [a, b, c] of enumerate3CyclePatterns(n)) {
    const legAB = byUV.get(a * n + b);
    const legBC = byUV.get(b * n + c);
    const legCA = byUV.get(c * n + a);
    if (!legAB || !legBC || !legCA) continue;

    for (const eAB of legAB) {
      for (const eBC of legBC) {
        // early pruning — current best bottleneck must beat min(eAB.w, eBC.w).
        const partialMin = eAB.w < eBC.w ? eAB.w : eBC.w;
        if (best && partialMin <= best.bottleneck) continue;

        for (const eCA of legCA) {
          const min = Math.min(eAB.w, eBC.w, eCA.w);
          if (min <= 0) continue;
          const max = Math.max(eAB.w, eBC.w, eCA.w);
          if (min / max < threshold) continue;
          if (!best || min > best.bottleneck) {
            best = { ab: eAB, bc: eBC, ca: eCA, bottleneck: min };
          }
        }
      }
    }
  }

  return best ? [best.ab, best.bc, best.ca] : null;
}

// returns one EdgeSnapshot[] per captured cycle with pre-mutation weights.
export function runMaxFlow(
  n: number,
  edges: Edge[],
  threshold: number
): EdgeSnapshot[][] {
  const captured: EdgeSnapshot[][] = [];

  // phase 1 — saturate 2-cycles.
  while (true) {
    const pair = findBest2Cycle(edges, n, threshold);
    if (!pair) break;
    const [a, b] = pair;
    const minW = a.w < b.w ? a.w : b.w;
    captured.push(snapshotOf([a, b]));
    applyCancellation(edges, [a, b], minW);
  }

  // phase 2 — saturate 3-cycles on the residual graph.
  while (true) {
    const triple = findBest3Cycle(edges, n, threshold);
    if (!triple) break;
    const minW = Math.min(triple[0].w, triple[1].w, triple[2].w);
    captured.push(snapshotOf(triple));
    applyCancellation(edges, triple, minW);
  }

  return captured;
}
