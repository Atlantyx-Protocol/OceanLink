import type { IntentOrder, MatchResult } from '../types.js';

// ---------------------------------------------------------------------------
// OrderStore — in-memory cache for intent orders and match results
//
// Primary index : Map<orderId, IntentOrder>
//   → O(1) lookup by order id.
//
// Secondary index : Map<`${srcChain}-${desChain}`, Set<orderId>>
//   → O(1) lookup of all active orders for a given chain pair.
//   → Entries are removed when an order is MATCHED or EXPIRED.
//
// Match results : MatchResult[] (append-only, newest-first on query)
// ---------------------------------------------------------------------------

export class OrderStore {
  private readonly orders = new Map<string, IntentOrder>();
  private readonly pairIndex = new Map<string, Set<string>>();
  private readonly matchResults: MatchResult[] = [];

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private pairKey(srcChain: number, desChain: number): string {
    return `${srcChain}-${desChain}`;
  }

  // -------------------------------------------------------------------------
  // Order CRUD
  // -------------------------------------------------------------------------

  add(order: IntentOrder): void {
    this.orders.set(order.orderId, order);
    const key = this.pairKey(order.srcChain, order.desChain);
    if (!this.pairIndex.has(key)) {
      this.pairIndex.set(key, new Set());
    }
    this.pairIndex.get(key)!.add(order.orderId);
  }

  get(orderId: string): IntentOrder | undefined {
    return this.orders.get(orderId);
  }

  /**
   * Applies partial updates to an existing order.
   * Returns false when the order is not found.
   */
  update(orderId: string, updates: Partial<IntentOrder>): boolean {
    const order = this.orders.get(orderId);
    if (!order) return false;
    Object.assign(order, updates);
    return true;
  }

  /**
   * All orders whose status is QUEUED or PARTIAL — these are candidates for
   * the next matching pass.
   */
  getActiveOrders(): IntentOrder[] {
    return [...this.orders.values()].filter((o) => o.status === 'QUEUED' || o.status === 'PARTIAL');
  }

  /** Quick lookup of active orders for a specific chain pair. */
  getByPair(srcChain: number, desChain: number): IntentOrder[] {
    const key = this.pairKey(srcChain, desChain);
    const ids = this.pairIndex.get(key);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.orders.get(id))
      .filter((o): o is IntentOrder => o !== undefined);
  }

  /**
   * Removes an order from the secondary pair index.
   * Call this after an order transitions to MATCHED (so it is no longer
   * a candidate for future matching passes).
   * Expired orders are handled automatically by expireStale().
   */
  removeFromPairIndex(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) return;
    this.pairIndex.get(this.pairKey(order.srcChain, order.desChain))?.delete(orderId);
  }

  // -------------------------------------------------------------------------
  // Garbage collection
  // -------------------------------------------------------------------------

  /**
   * Marks all active (QUEUED or PARTIAL) orders whose deadline has passed
   * as EXPIRED, and removes them from the pair index.
   *
   * @returns number of orders that were newly expired.
   */
  expireStale(): number {
    const now = Math.floor(Date.now() / 1000);
    let count = 0;
    for (const order of this.orders.values()) {
      if ((order.status === 'QUEUED' || order.status === 'PARTIAL') && order.deadline < now) {
        order.status = 'EXPIRED';
        this.pairIndex.get(this.pairKey(order.srcChain, order.desChain))?.delete(order.orderId);
        count++;
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Match results
  // -------------------------------------------------------------------------

  addMatchResult(result: MatchResult): void {
    this.matchResults.push(result);
  }

  /**
   * Returns match results in reverse-chronological order (newest first),
   * with simple page/pageSize pagination.
   */
  getMatchResults(
    page: number,
    pageSize: number
  ): { data: MatchResult[]; total: number; page: number; pageSize: number } {
    const total = this.matchResults.length;
    const start = (page - 1) * pageSize;
    const data = [...this.matchResults].reverse().slice(start, start + pageSize);
    return { data, total, page, pageSize };
  }

  // -------------------------------------------------------------------------
  // Diagnostics / testing helpers
  // -------------------------------------------------------------------------

  totalCount(): number {
    return this.orders.size;
  }

  /** Wipes all state — intended for use in tests only. */
  clear(): void {
    this.orders.clear();
    this.pairIndex.clear();
    this.matchResults.length = 0;
  }
}

/** Module-level singleton used throughout the application. */
export const orderStore = new OrderStore();
