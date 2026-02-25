/**
 * Directed weighted graph — cycle-reduction algorithm.
 *
 * Given a directed weighted graph and a threshold x, the algorithm repeatedly:
 *   1. Finds any directed cycle using DFS.
 *   2. Computes  ratio = min_w / max_w  for that cycle.
 *   3. If ratio > x:
 *        a. Records a snapshot of the cycle (original weights).
 *        b. Removes the edge with weight min_w from the graph.
 *        c. Subtracts min_w from every other edge in the cycle.
 *   4. Stops when no cycle is found or the found cycle's ratio ≤ x (not > x).
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
 * Finds one directed cycle in `graph` using depth-first search.
 *
 * Classic three-colour scheme:
 *   0 = white  — vertex not yet visited
 *   1 = gray   — vertex is on the current DFS path
 *   2 = black  — vertex fully processed (all descendants explored)
 *
 * A back-edge (to a gray vertex) signals a cycle.  The function reconstructs
 * the cycle by maintaining a stack of edges on the current path.
 *
 * @returns The edges forming one cycle (in traversal order), or null if the
 *          graph is acyclic.
 */
function findCycle(graph: Edge[], numVertices: number): Edge[] | null {
  const color = new Array<number>(numVertices).fill(0);

  // Edges on the current DFS path; pushed when descending, popped on backtrack.
  const edgeStack: Edge[] = [];

  /**
   * DFS from `node`.
   * Returns the "back vertex" (the gray vertex reached by a back-edge) when a
   * cycle is detected, so the caller can slice edgeStack to recover the cycle.
   * Returns null when no cycle is reachable from `node`.
   */
  function dfs(node: number): number | null {
    color[node] = 1; // entering: mark gray

    for (const edge of graph) {
      if (edge.u !== node) continue; // only outgoing edges from this vertex

      if (color[edge.v] === 1) {
        // Back-edge → cycle closes here.
        edgeStack.push(edge); // include the closing back-edge
        return edge.v; // signal: cycle starts at this gray vertex
      }

      if (color[edge.v] === 0) {
        edgeStack.push(edge);
        const backVertex = dfs(edge.v);
        if (backVertex !== null) return backVertex; // propagate signal upward
        edgeStack.pop(); // no cycle on this branch — backtrack
      }
      // color === 2: cross/forward edge — ignore
    }

    color[node] = 2; // leaving: mark black
    return null;
  }

  // Launch DFS from every unvisited vertex to cover disconnected components.
  for (let v = 0; v < numVertices; v++) {
    if (color[v] !== 0) continue;
    // edgeStack is always empty here: every push on a no-cycle path is
    // matched by a pop, and we return immediately when a cycle is found.
    const backVertex = dfs(v);
    if (backVertex !== null) {
      // The cycle runs from backVertex (gray) back to itself via the back-edge.
      // Find the first edge in the stack whose source is backVertex.
      const cycleStart = edgeStack.findIndex((e) => e.u === backVertex);
      // cycleStart ≥ 0 because backVertex was gray (on the path), so it must
      // appear as the source of a pushed edge.
      return edgeStack.slice(cycleStart);
    }
  }

  return null; // graph is acyclic
}

// ---------------------------------------------------------------------------
// Main algorithm
// ---------------------------------------------------------------------------

/**
 * Runs the cycle-reduction algorithm on a mutable edge list.
 *
 * NOTE on termination:  The algorithm stops as soon as the first cycle it
 * finds does not satisfy ratio > x, i.e. ratio ≤ x (or no cycle exists at all).  Because DFS
 * returns "any" cycle, a non-qualifying cycle found before a qualifying one
 * would cause early termination — an acceptable trade-off given n < 10 and the
 * emphasis on simplicity over completeness.
 *
 * @param n     Number of vertices (vertices are 0 … n-1).
 * @param edges Mutable edge list — modified in place by the algorithm.
 * @param x     Threshold: a cycle is processed only when its ratio exceeds x.
 * @returns     Array of captured cycles; each cycle is a list of EdgeSnapshots
 *              recording (u, v, w) of every edge BEFORE it was modified.
 */
export function runAlgorithm(
  n: number,
  edges: Edge[],
  x: number,
): EdgeSnapshot[][] {
  const capturedCycles: EdgeSnapshot[][] = [];

  while (true) {
    // Step 1 — find any directed cycle.
    const cycle = findCycle(edges, n);
    if (!cycle) break; // acyclic → done

    // Step 2 — compute the ratio for this cycle.
    const weights = cycle.map((e) => e.w);
    const maxW = Math.max(...weights);
    const minW = Math.min(...weights);
    const ratio = minW / maxW;

    // Step 3 — check the threshold.
    if (ratio <= x) break; // cycle doesn't qualify → done

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
    console.log("No qualifying cycles found.");
    return;
  }
  cycles.forEach((cycle, i) => {
    const edgeStr = cycle
      .map((e) => `(${e.u} -> ${e.v}, w=${e.w})`)
      .join(", ");
    console.log(`Cycle ${i + 1}: [${edgeStr}]`);
  });
}
