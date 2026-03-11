/**
 * Unit tests for the cycle-reduction algorithm.
 * Run with:  npx tsx --test src/engine/matching/algorithm.test.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, runAlgorithm, type EdgeSnapshot } from './algorithm.js';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Deep-compare a captured cycle against expected (u,v,w) triples. */
function assertCycle(actual: EdgeSnapshot[], expected: [number, number, number][], label: string) {
  assert.equal(actual.length, expected.length, `${label}: edge count mismatch`);
  actual.forEach((e, i) => {
    const [eu, ev, ew] = expected[i]!;
    assert.equal(e.u, eu, `${label} edge[${i}].u`);
    assert.equal(e.v, ev, `${label} edge[${i}].v`);
    assert.equal(e.w, ew, `${label} edge[${i}].w`);
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('runAlgorithm', () => {
  // -------------------------------------------------------------------------
  it('acyclic graph — no cycles captured', () => {
    // 0 → 1 → 2  (simple path, no cycle)
    const edges = buildGraph([
      [0, 1, 5],
      [1, 2, 3],
    ]);
    const result = runAlgorithm(3, edges, 0.5);
    assert.equal(result.length, 0, 'should capture no cycles');
    // graph unchanged
    assert.equal(edges.length, 2);
  });

  // -------------------------------------------------------------------------
  it('single cycle below threshold — not captured', () => {
    // Triangle 0→1(5) → 1→2(4) → 2→0(3)
    // ratio = min/max = 3/5 = 0.6  ≤  x=0.7  → not processed
    const edges = buildGraph([
      [0, 1, 5],
      [1, 2, 4],
      [2, 0, 3],
    ]);
    const result = runAlgorithm(3, edges, 0.7);
    assert.equal(result.length, 0, 'ratio 0.6 ≤ 0.7 should not be captured');
    // edges untouched
    assert.equal(edges.length, 3);
    assert.equal(edges[0]!.w, 5);
    assert.equal(edges[1]!.w, 4);
    assert.equal(edges[2]!.w, 3);
  });

  // -------------------------------------------------------------------------
  it('single qualifying cycle — captured once, min edge removed', () => {
    // Triangle 0→1(10) → 1→2(2) → 2→0(6)
    // ratio = min/max = 2/10 = 0.2  >  x=0.1  → process
    //   snapshot: [(0→1,10),(1→2,2),(2→0,6)]
    //   remove edge 1→2 (w=2), subtract 2 from others: 0→1→8, 2→0→4
    //   remaining graph: 0→1(8), 2→0(4)  — acyclic (1→2 gone) → stop
    const edges = buildGraph([
      [0, 1, 10],
      [1, 2, 2],
      [2, 0, 6],
    ]);
    const result = runAlgorithm(3, edges, 0.1);

    assert.equal(result.length, 1, 'should capture exactly one cycle');
    assertCycle(
      result[0]!,
      [
        [0, 1, 10],
        [1, 2, 2],
        [2, 0, 6],
      ],
      'cycle 0'
    );

    // min-weight edge (1→2) removed
    assert.equal(edges.length, 2, 'one edge removed');
    assert.ok(!edges.find((e) => e.u === 1 && e.v === 2), '1→2 removed');

    // remaining edges have reduced weights
    const e01 = edges.find((e) => e.u === 0 && e.v === 1)!;
    const e20 = edges.find((e) => e.u === 2 && e.v === 0)!;
    assert.equal(e01.w, 8, '0→1 weight after subtract');
    assert.equal(e20.w, 4, '2→0 weight after subtract');
  });

  // -------------------------------------------------------------------------
  it('two qualifying cycles in sequence — both captured', () => {
    // Graph: 0→1(10), 1→0(2), 1→2(8), 2→1(4),  x=0.1
    //
    // Iteration 1 — DFS finds 0→1→0 first:
    //   ratio = min/max = 2/10 = 0.2 > 0.1  → process
    //   snapshot: [(0→1,10),(1→0,2)]
    //   remove 1→0 (min), subtract 2 from 0→1 → 0→1(8)
    //   remaining: 0→1(8), 1→2(8), 2→1(4)
    //
    // Iteration 2 — DFS finds 1→2→1:
    //   ratio = min/max = 4/8 = 0.5 > 0.1  → process
    //   snapshot: [(1→2,8),(2→1,4)]
    //   remove 2→1 (min), subtract 4 from 1→2 → 1→2(4)
    //   remaining: 0→1(8), 1→2(4)  — acyclic → stop
    const edges = buildGraph([
      [0, 1, 10],
      [1, 0, 2],
      [1, 2, 8],
      [2, 1, 4],
    ]);
    const result = runAlgorithm(4, edges, 0.1);

    assert.equal(result.length, 2, 'should capture two cycles');
    assertCycle(
      result[0]!,
      [
        [0, 1, 10],
        [1, 0, 2],
      ],
      'cycle 0'
    );
    assertCycle(
      result[1]!,
      [
        [1, 2, 8],
        [2, 1, 4],
      ],
      'cycle 1'
    );

    assert.equal(edges.length, 2);
    assert.equal(edges.find((e) => e.u === 0 && e.v === 1)!.w, 8);
    assert.equal(edges.find((e) => e.u === 1 && e.v === 2)!.w, 4);
  });

  // -------------------------------------------------------------------------
  it('self-loop — ratio is always 1, never captured', () => {
    // Self-loop 0→0(7): max=min=7, ratio=min/max=1  <  x=2  → never processed
    const edges = buildGraph([[0, 0, 7]]);
    const result = runAlgorithm(1, edges, 2);
    assert.equal(result.length, 0, 'self-loop ratio=1 should never qualify');
    assert.equal(edges.length, 1, 'edge untouched');
  });

  // -------------------------------------------------------------------------
  it('all edges in cycle have equal weight — ratio 1, never captured', () => {
    // 0→1(5) → 1→2(5) → 2→0(5): ratio = min/max = 1  <  x=2  → not processed
    const edges = buildGraph([
      [0, 1, 5],
      [1, 2, 5],
      [2, 0, 5],
    ]);
    const result = runAlgorithm(3, edges, 2);
    assert.equal(result.length, 0);
    assert.equal(edges.length, 3);
  });

  // -------------------------------------------------------------------------
  it('disconnected graph — cycle in second component captured', () => {
    // Component A: 0→1 (no cycle)
    // Component B: 2→3(9), 3→2(1)  ratio=min/max=1/9 ≈ 0.11 > 0.05  → process
    const edges = buildGraph([
      [0, 1, 4],
      [2, 3, 9],
      [3, 2, 1],
    ]);
    const result = runAlgorithm(4, edges, 0.05);

    assert.equal(result.length, 1, 'one cycle from component B');
    // cycle is 2→3→2
    const cycle = result[0]!;
    assert.equal(cycle.length, 2);
    const has23 = cycle.some((e) => e.u === 2 && e.v === 3 && e.w === 9);
    const has32 = cycle.some((e) => e.u === 3 && e.v === 2 && e.w === 1);
    assert.ok(has23, 'should contain edge 2→3 w=9');
    assert.ok(has32, 'should contain edge 3→2 w=1');

    // min edge 3→2 removed; 2→3 weight reduced to 9−1=8
    assert.ok(!edges.find((e) => e.u === 3 && e.v === 2), '3→2 removed');
    assert.equal(edges.find((e) => e.u === 2 && e.v === 3)!.w, 8);
  });

  // -------------------------------------------------------------------------
  it('x=0 — every cycle with unequal weights is captured', () => {
    // Any ratio > 0 qualifies when x=0.
    // Triangle 0→1(3), 1→2(1), 2→0(2)  ratio=min/max=1/3 ≈ 0.33 > 0
    const edges = buildGraph([
      [0, 1, 3],
      [1, 2, 1],
      [2, 0, 2],
    ]);
    const result = runAlgorithm(3, edges, 0);
    assert.equal(result.length, 1);
    assertCycle(
      result[0]!,
      [
        [0, 1, 3],
        [1, 2, 1],
        [2, 0, 2],
      ],
      'cycle 0'
    );
  });

  // -------------------------------------------------------------------------
  it('snapshot preserves original weights, not post-update weights', () => {
    // 0→1(6), 1→0(2)  ratio=min/max=2/6 ≈ 0.33 > 0.2  → process
    // After: remove 1→0(2), 0→1 becomes 4.
    // Snapshot must still show w=6 and w=2, not 4.
    const edges = buildGraph([
      [0, 1, 6],
      [1, 0, 2],
    ]);
    const result = runAlgorithm(2, edges, 0.2);
    assert.equal(result.length, 1);
    const snap = result[0]!;
    const e01 = snap.find((e) => e.u === 0 && e.v === 1)!;
    const e10 = snap.find((e) => e.u === 1 && e.v === 0)!;
    assert.equal(e01.w, 6, 'snapshot should store original w=6');
    assert.equal(e10.w, 2, 'snapshot should store original w=2');
    // live edge should now be 4
    assert.equal(edges.find((e) => e.u === 0 && e.v === 1)!.w, 4);
  });
});
