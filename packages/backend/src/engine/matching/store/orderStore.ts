import { eq } from 'drizzle-orm';
import type { IntentOrder, MatchResult } from '../types.js';
import { db, schema, logDbError } from '../../../db/client.js';
import { isTestingMode } from '../../../config/constants.js';

// OrderStore — in-memory cache with write-through persistence to Postgres.
// matching tick runs against in-memory maps; mutations are mirrored async
// (fire-and-forget). hydrate() rebuilds state from the DB on boot.
//   orders     : Map<orderId, IntentOrder>            — O(1) lookup by id
//   pairIndex  : Map<`${src}-${des}`, Set<orderId>>   — active orders per pair
//   matchResults: MatchResult[]                       — append-only

export class OrderStore {
  private readonly orders = new Map<string, IntentOrder>();
  private readonly pairIndex = new Map<string, Set<string>>();
  private readonly matchResults: MatchResult[] = [];

  private pairKey(srcChain: number, desChain: number): string {
    return `${srcChain}-${desChain}`;
  }

  // loads persisted orders and match results into memory at boot.
  // active orders (QUEUED|PARTIAL) get added to the pair index.
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

  // applies partial updates. returns false when the order is not found.
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

  // candidates for the next matching pass (QUEUED or PARTIAL).
  getActiveOrders(): IntentOrder[] {
    return [...this.orders.values()].filter((o) => o.status === 'QUEUED' || o.status === 'PARTIAL');
  }

  // quick lookup of active orders for a specific chain pair.
  getByPair(srcChain: number, desChain: number): IntentOrder[] {
    const key = this.pairKey(srcChain, desChain);
    const ids = this.pairIndex.get(key);
    if (!ids) return [];
    return [...ids]
      .map((id) => this.orders.get(id))
      .filter((o): o is IntentOrder => o !== undefined);
  }

  // call after an order transitions to MATCHED so it stops being a candidate.
  // expired orders are handled by expireStale().
  removeFromPairIndex(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) return;
    this.pairIndex.get(this.pairKey(order.srcChain, order.desChain))?.delete(orderId);
  }

  // marks past-deadline active orders as EXPIRED, drops them from the pair index.
  // returns the count of newly-expired orders.
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

  // newest-first paginated list of match results.
  getMatchResults(
    page: number,
    pageSize: number
  ): { data: MatchResult[]; total: number; page: number; pageSize: number } {
    const total = this.matchResults.length;
    const start = (page - 1) * pageSize;
    const data = [...this.matchResults].reverse().slice(start, start + pageSize);
    return { data, total, page, pageSize };
  }

  totalCount(): number {
    return this.orders.size;
  }

  // wipes in-memory state — tests only, does not touch the DB.
  clear(): void {
    this.orders.clear();
    this.pairIndex.clear();
    this.matchResults.length = 0;
  }
}

// module-level singleton.
export const orderStore = new OrderStore();
