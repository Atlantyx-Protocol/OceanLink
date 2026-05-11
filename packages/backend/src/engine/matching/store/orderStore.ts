import { eq } from 'drizzle-orm';
import type { IntentOrder, MatchResult } from '../types.js';
import { db, schema, logDbError } from '../../../db/client.js';
import { isTestingMode } from '../../../config/constants.js';

// ---------------------------------------------------------------------------
// OrderStore — in-memory cache for intent orders and match results, with
// write-through persistence to Postgres.
//
// The matching tick still runs against the in-memory maps for speed; every
// mutation is mirrored asynchronously to the database (fire-and-forget with
// an error log). On boot, hydrate() rebuilds the in-memory state from the DB.
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
  // Hydration
  // -------------------------------------------------------------------------

  /**
   * Loads all persisted orders and match results into memory. Called once
   * on process startup, before the matching scheduler starts. Active orders
   * (QUEUED|PARTIAL) are added to the pair index.
   */
  async hydrate(): Promise<void> {
    const [orderRows, matchRows] = await Promise.all([
      db.select().from(schema.intentOrders),
      db.select().from(schema.matchResults).orderBy(schema.matchResults.matchedAt),
    ]);

    for (const row of orderRows) {
      const order: IntentOrder = {
        orderId: row.orderId,
        srcChain: row.srcChain,
        desChain: row.desChain,
        amount: row.amount,
        incentiveFee: row.incentiveFee ?? undefined,
        deadline: row.deadline,
        createdAt: row.createdAt,
        status: row.status,
        userAddress: row.userAddress,
      };
      this.orders.set(order.orderId, order);
      if (order.status === 'QUEUED' || order.status === 'PARTIAL') {
        const key = this.pairKey(order.srcChain, order.desChain);
        if (!this.pairIndex.has(key)) this.pairIndex.set(key, new Set());
        this.pairIndex.get(key)!.add(order.orderId);
      }
    }

    for (const row of matchRows) {
      this.matchResults.push({
        matchId: row.matchId,
        matchedAt: row.matchedAt,
        orders: row.orders,
        cycles: row.cycles,
        rawCycles: row.rawCycles,
      });
    }
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

    if (!isTestingMode()) {
      void db
        .insert(schema.intentOrders)
        .values({
          orderId: order.orderId,
          srcChain: order.srcChain,
          desChain: order.desChain,
          amount: order.amount,
          incentiveFee: order.incentiveFee ?? null,
          deadline: order.deadline,
          createdAt: order.createdAt,
          status: order.status,
          userAddress: order.userAddress,
        })
        .onConflictDoNothing()
        .catch((err) => logDbError('orders.add', err));
    }
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

    if (!isTestingMode()) {
      void db
        .update(schema.intentOrders)
        .set({
          amount: order.amount,
          incentiveFee: order.incentiveFee ?? null,
          status: order.status,
          deadline: order.deadline,
        })
        .where(eq(schema.intentOrders.orderId, orderId))
        .catch((err) => logDbError('orders.update', err));
    }
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
    const expiredIds: string[] = [];
    for (const order of this.orders.values()) {
      if ((order.status === 'QUEUED' || order.status === 'PARTIAL') && order.deadline < now) {
        order.status = 'EXPIRED';
        this.pairIndex.get(this.pairKey(order.srcChain, order.desChain))?.delete(order.orderId);
        expiredIds.push(order.orderId);
        count++;
      }
    }
    if (!isTestingMode()) {
      for (const id of expiredIds) {
        void db
          .update(schema.intentOrders)
          .set({ status: 'EXPIRED' })
          .where(eq(schema.intentOrders.orderId, id))
          .catch((err) => logDbError('orders.expire', err));
      }
    }
    return count;
  }

  // -------------------------------------------------------------------------
  // Match results
  // -------------------------------------------------------------------------

  addMatchResult(result: MatchResult): void {
    this.matchResults.push(result);

    if (!isTestingMode()) {
      void db
        .insert(schema.matchResults)
        .values({
          matchId: result.matchId,
          matchedAt: result.matchedAt,
          orders: result.orders,
          cycles: result.cycles,
          rawCycles: result.rawCycles,
        })
        .onConflictDoNothing()
        .catch((err) => logDbError('matchResults.add', err));
    }
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

  /** Wipes in-memory state — intended for tests only. Does not touch the DB. */
  clear(): void {
    this.orders.clear();
    this.pairIndex.clear();
    this.matchResults.length = 0;
  }
}

/** Module-level singleton used throughout the application. */
export const orderStore = new OrderStore();
