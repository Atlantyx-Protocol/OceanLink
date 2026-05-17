/**
 * Cycle-cancellation max-circulation matching.
 *
 * Same input/output contract as runAlgorithm (see algorithm.ts) so the two
 * implementations are interchangeable from MatchingService's perspective:
 *
 *   runMaxFlow(n, edges, x): EdgeSnapshot[][]
 *
 * Key differences vs the DFS-greedy runAlgorithm:
 *
 *   - Cycle patterns at the *chain* level are enumerated explicitly
 *     (O(n^2) two-cycles + O(n^3) three-cycles for n vertices). The combinatorial
 *     explosion in the original came from treating each order as a distinct
 *     parallel edge; this implementation iterates chain-cycle patterns and
 *     picks the best concrete (1-to-1) order assignment per pattern.
 *
 *   - At each step we pick the cycle with the LARGEST bottleneck (subject to
 *     ratio ≥ x) instead of the first one DFS happens to find. Greedy in this
 *     dimension closely tracks max-circulation: every cancellation removes
 *     the maximum amount of capacity allowed by the residual graph.
 *
 *   - One order per leg is preserved (no aggregation), so each captured cycle
 *     stays a clean 1-to-1 N-tuple — the orchestrator can still pair
 *     sender→receiver edge-by-edge for HTLC settlement.
 *
 * Phases:
 *   1. Exhaust all 2-cycles. They are cheaper, fully balanced (the standard
 *      P2P swap shape), and the orchestrator handles them in a single HTLC pair.
 *   2. Exhaust 3-cycles on the residual. Longer cycles aren't enumerated —
 *      4+ chains are rare in practice and the marginal coverage is tiny.
 */

import type { Edge, EdgeSnapshot } from './algorithm.js';

export type { Edge, EdgeSnapshot } from './algorithm.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cycleRatio(weights: number[]): number {
  const max = Math.max(...weights);
  if (max === 0) return 0;
  return Math.min(...weights) / max;
}

/**
 * Mimics runAlgorithm's mutation step on a captured cycle:
 *   - Identify the edge with weight equal to minW (first occurrence).
 *   - Splice that edge out of `edges`.
 *   - Subtract minW from every other edge's weight in-place.
 *
 * This is the only side effect on `edges`. The snapshot returned by the
 * caller captures pre-mutation weights so downstream interpretation
 * (matchingService + cycleMapper) keeps working unchanged.
 */
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

// ---------------------------------------------------------------------------
// 2-cycle search
// ---------------------------------------------------------------------------

/**
 * Finds the best qualifying 2-cycle (u → v → u) across all chain pairs.
 * "Best" = largest bottleneck (= matched volume contributed by this cycle).
 * Returns null if no pair (a, b) has min(a.w, b.w) > 0 and ratio ≥ threshold.
 */
function findBest2Cycle(edges: Edge[], n: number, threshold: number): [Edge, Edge] | null {
  // Group edges by (u, v) for O(1) leg lookup.
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

// ---------------------------------------------------------------------------
// 3-cycle search
// ---------------------------------------------------------------------------

/**
 * Enumerates 3-cycle chain patterns canonically. For vertices {0, 1, 2}, both
 * (0→1→2→0) and (0→2→1→0) are valid distinct cycles — we keep the rotation
 * starting at the smallest vertex to avoid emitting the same cycle three
 * times under cyclic shift.
 */
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
        // Early pruning — current best bottleneck must beat min(eAB.w, eBC.w).
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * See module-level docstring. Returns one EdgeSnapshot[] per captured cycle
 * with pre-mutation weights, matching the runAlgorithm output contract.
 */
export function runMaxFlow(
  n: number,
  edges: Edge[],
  threshold: number
): EdgeSnapshot[][] {
  const captured: EdgeSnapshot[][] = [];

  // Phase 1 — saturate 2-cycles.
  while (true) {
    const pair = findBest2Cycle(edges, n, threshold);
    if (!pair) break;
    const [a, b] = pair;
    const minW = a.w < b.w ? a.w : b.w;
    captured.push(snapshotOf([a, b]));
    applyCancellation(edges, [a, b], minW);
  }

  // Phase 2 — saturate 3-cycles on the residual graph.
  while (true) {
    const triple = findBest3Cycle(edges, n, threshold);
    if (!triple) break;
    const minW = Math.min(triple[0].w, triple[1].w, triple[2].w);
    captured.push(snapshotOf(triple));
    applyCancellation(edges, triple, minW);
  }

  return captured;
}
