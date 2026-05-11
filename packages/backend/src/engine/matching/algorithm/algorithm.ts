/**
 * Directed weighted graph — cycle-reduction algorithm.
 *
 * Given a directed weighted graph and a threshold x, the algorithm repeatedly:
 *   1. Finds a directed cycle using DFS, skipping any cycle already marked
 *      visited in this run.
 *   2. Computes  ratio = min_w / max_w  for that cycle.
 *   3. If ratio ≥ x:
 *        a. Records a snapshot of the cycle (original weights).
 *        b. Removes the edge with weight min_w from the graph.
 *        c. Subtracts min_w from every other edge in the cycle.
 *      Else (ratio < x): marks the cycle as visited and continues to the next
 *      cycle (the same cycle will not be returned again).
 *   4. Stops when findCycle returns no qualifying cycle.
 */

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** A directed, weighted edge. */
export interface Edge {
  id: number; // stable unique id (set at construction, never changed)
  u: number; // source vertex (0-indexed)
  v: number; // destination vertex (0-indexed)
  w: number; // current weight (mutated as the algorithm runs)
}

/** Immutable record of an edge captured at the time a cycle is stored. */
export interface EdgeSnapshot {
  u: number;
  v: number;
  w: number; // weight BEFORE the update step
}

// ---------------------------------------------------------------------------
// Cycle detection (DFS, three-colour marking)
// ---------------------------------------------------------------------------

/**
 * Canonical key for a cycle — sorted edge ids, joined.
 *
 * Two findCycle calls may return the same cycle in different traversal orders
 * (different starting vertex), so order-insensitive equality is needed when
 * tracking visited cycles. Edge ids are unique within a graph, so the sorted
 * id list uniquely identifies the cycle's edge set.
 */
function cycleKey(cycle: Edge[]): string {
  return cycle
    .map((e) => e.id)
    .sort((a, b) => a - b)
    .join(',');
}

/**
 * Finds one directed cycle in `graph` using depth-first search, skipping
 * cycles whose canonical key is in `visited`.
 *
 * Classic three-colour scheme:
 *   0 = white  — vertex not yet visited
 *   1 = gray   — vertex is on the current DFS path
 *   2 = black  — vertex fully processed (all descendants explored)
 *
 * A back-edge (to a gray vertex) signals a candidate cycle. If the candidate
 * is already in `visited`, DFS continues without returning so other cycles
 * still have a chance of being discovered.
 *
 * @returns The edges forming one non-visited cycle (in traversal order), or
 *          null if no such cycle exists.
 */
function findCycle(
  graph: Edge[],
  numVertices: number,
  visited: Set<string>
): Edge[] | null {
  const color = new Array<number>(numVertices).fill(0);

  // Adjacency list: outgoing edges per source vertex. Built once per call so
  // DFS avoids scanning the whole edge list at every node.
  const outEdges: Edge[][] = Array.from({ length: numVertices }, () => []);
  for (const edge of graph) outEdges[edge.u]!.push(edge);

  // Edges on the current DFS path; pushed when descending, popped on backtrack.
  const edgeStack: Edge[] = [];

  /**
   * DFS from `node`.
   * Returns the "back vertex" (the gray vertex reached by a back-edge) when a
   * non-visited cycle is detected, so the caller can slice edgeStack to
   * recover it. Returns null when no such cycle is reachable from `node`.
   */
  function dfs(node: number): number | null {
    color[node] = 1; // entering: mark gray

    for (const edge of outEdges[node]!) {
      if (color[edge.v] === 1) {
        // Back-edge → candidate cycle. Reconstruct it without mutating the
        // stack so we can keep searching if it turns out to be visited.
        const cycleStart = edgeStack.findIndex((e) => e.u === edge.v);
        const candidate = [...edgeStack.slice(cycleStart), edge];
        if (!visited.has(cycleKey(candidate))) {
          edgeStack.push(edge); // commit the closing back-edge
          return edge.v;
        }
        // Visited — drop this back-edge, keep iterating other outgoing edges.
        continue;
      }

      if (color[edge.v] === 0) {
        edgeStack.push(edge);
        const backVertex = dfs(edge.v);
        if (backVertex !== null) return backVertex; // propagate signal upward
        edgeStack.pop(); // no qualifying cycle on this branch — backtrack
      }
      // color === 2: cross/forward edge — ignore
    }

    color[node] = 2; // leaving: mark black
    return null;
  }

  // Launch DFS from every unvisited vertex to cover disconnected components.
  for (let v = 0; v < numVertices; v++) {
    if (color[v] !== 0) continue;
    const backVertex = dfs(v);
    if (backVertex !== null) {
      const cycleStart = edgeStack.findIndex((e) => e.u === backVertex);
      return edgeStack.slice(cycleStart);
    }
  }

  return null; // no non-visited cycle remains
}

// ---------------------------------------------------------------------------
// Main algorithm
// ---------------------------------------------------------------------------

/**
 * Runs the cycle-reduction algorithm on a mutable edge list.
 *
 * Termination:
 *   Each iteration either captures a qualifying cycle (which removes one edge
 *   from the graph) or marks a non-qualifying cycle as visited (which strictly
 *   grows the visited set). Both monotonic, both finite — the loop exits when
 *   findCycle can no longer return a non-visited cycle.
 *
 *   Compared to the original behaviour (break on first non-qualifying cycle),
 *   this finds significantly more matches when the graph contains a mix of
 *   high- and low-ratio cycles — at the cost of enumerating low-ratio cycles
 *   too. With small n (vertices = chains, < 10 in practice) the cycle space
 *   stays small enough that the extra cost is negligible.
 *
 * @param n     Number of vertices (vertices are 0 … n-1).
 * @param edges Mutable edge list — modified in place by the algorithm.
 * @param x     Threshold: a cycle is processed only when its ratio ≥ x.
 * @returns     Array of captured cycles; each cycle is a list of EdgeSnapshots
 *              recording (u, v, w) of every edge BEFORE it was modified.
 */
export function runAlgorithm(n: number, edges: Edge[], x: number): EdgeSnapshot[][] {
  const capturedCycles: EdgeSnapshot[][] = [];
  const visitedCycles = new Set<string>();

  // Safety cap on inner iterations. With many low-ratio cycles in a dense
  // graph (e.g. 1000+ orders), the visited set can otherwise grow to
  // tens of thousands of cycles per outer step. The cap bounds runtime; in
  // practice the algorithm exits via findCycle returning null long before.
  const MAX_ITERS = 200_000;
  let iters = 0;

  while (true) {
    if (++iters > MAX_ITERS) {
      // eslint-disable-next-line no-console
      console.warn(
        `[runAlgorithm] iteration cap hit (${MAX_ITERS}); ` +
          `${capturedCycles.length} cycles captured, |visited|=${visitedCycles.size}`
      );
      break;
    }
    // Step 1 — find any directed cycle that has not been visited yet.
    const cycle = findCycle(edges, n, visitedCycles);
    if (!cycle) break; // no non-visited cycle remains → done

    // Step 2 — compute the ratio for this cycle.
    const weights = cycle.map((e) => e.w);
    const maxW = Math.max(...weights);
    const minW = Math.min(...weights);
    const ratio = minW / maxW;

    // Step 3 — non-qualifying cycle: mark visited and continue searching.
    if (ratio < x) {
      visitedCycles.add(cycleKey(cycle));
      continue;
    }

    // Step 4a — snapshot original weights before any mutation.
    const snapshot: EdgeSnapshot[] = cycle.map((e) => ({
      u: e.u,
      v: e.v,
      w: e.w,
    }));
    capturedCycles.push(snapshot);

    // Step 4b — find the edge with minimum weight (first occurrence if tied).
    const minEdgeIndex = cycle.findIndex((e) => e.w === minW);
    const minEdge = cycle[minEdgeIndex];

    // Step 4c — subtract minW from every OTHER edge in the cycle.
    for (let i = 0; i < cycle.length; i++) {
      if (i !== minEdgeIndex) {
        cycle[i].w -= minW;
      }
    }

    // Step 4d — remove the minimum-weight edge from the graph entirely.
    const graphIdx = edges.indexOf(minEdge);
    edges.splice(graphIdx, 1);

    // The graph mutated. Visited cycles that don't share any edge with this
    // captured cycle still have unchanged weights and stay correctly
    // rejected. Visited cycles that DO share an edge may now qualify (if the
    // shared edge was the cycle's max, the ratio increased) — we drop those
    // so the next findCycle re-evaluates them.
    const touchedIds = new Set(cycle.map((e) => e.id));
    for (const key of visitedCycles) {
      const ids = key.split(',').map(Number);
      if (ids.some((id) => touchedIds.has(id))) {
        visitedCycles.delete(key);
      }
    }
  }

  return capturedCycles;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Constructs an Edge array from a compact list of [u, v, w] triples.
 * The array index becomes the edge's stable id.
 */
export function buildGraph(triples: [number, number, number][]): Edge[] {
  return triples.map(([u, v, w], id) => ({ id, u, v, w }));
}

/** Pretty-prints all captured cycles to stdout. */
export function printResults(cycles: EdgeSnapshot[][]): void {
  if (cycles.length === 0) {
    console.log('No qualifying cycles found.');
    return;
  }
  cycles.forEach((cycle, i) => {
    const edgeStr = cycle.map((e) => `(${e.u} -> ${e.v}, w=${e.w})`).join(', ');
    console.log(`Cycle ${i + 1}: [${edgeStr}]`);
  });
}
