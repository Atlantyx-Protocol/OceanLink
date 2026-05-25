import { eq, sql, desc } from 'drizzle-orm';
import type { IntentOrder, MatchResult } from '../types.js';
import { db, schema, logDbError } from '../../../db/client.js';
import { isTestingMode } from '../../../config/constants.js';

type OrderRow = typeof schema.intentOrders.$inferSelect;
type MatchRow = typeof schema.matchResults.$inferSelect;

const ACTIVE_STATUSES = new Set<IntentOrder['status']>(['QUEUED', 'PARTIAL']);

function rowToOrder(row: OrderRow): IntentOrder {
  return {
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
}

function rowToMatchResult(row: MatchRow): MatchResult {
  return {
    matchId: row.matchId,
    matchedAt: row.matchedAt,
    orders: row.orders,
    cycles: row.cycles,
    rawCycles: row.rawCycles,
  };
}

function pairKey(srcChain: number, desChain: number): string {
  return `${srcChain}-${desChain}`;
}

export class OrderStore {
  private readonly orders = new Map<string, IntentOrder>();
  private readonly pairIndex = new Map<string, Set<string>>();
  private readonly matchResults: MatchResult[] = [];

  // loads persisted orders and match results into memory at boot.
  // active orders (QUEUED|PARTIAL) get added to the pair index.
  async hydrate(): Promise<void> {
    const [orderRows, matchRows] = await Promise.all([
      db.select().from(schema.intentOrders),
      db.select().from(schema.matchResults).orderBy(schema.matchResults.matchedAt),
    ]);

    for (const row of orderRows) {
      const order = rowToOrder(row);
      this.orders.set(order.orderId, order);
      if (ACTIVE_STATUSES.has(order.status)) {
        this.indexAdd(order);
      }
    }

    for (const row of matchRows) {
      this.matchResults.push(rowToMatchResult(row));
    }
  }

  add(order: IntentOrder): void {
    this.orders.set(order.orderId, order);
    this.indexAdd(order);
    this.persistInsert(order);
  }

  get(orderId: string): IntentOrder | undefined {
    return this.orders.get(orderId);
  }

  // applies partial updates. returns false when the order is not found.
  update(orderId: string, updates: Partial<IntentOrder>): boolean {
    const order = this.orders.get(orderId);
    if (!order) return false;
    Object.assign(order, updates);
    this.persistUpdate(order);
    return true;
  }

  // candidates for the next matching pass (QUEUED or PARTIAL).
  getActiveOrders(): IntentOrder[] {
    return [...this.orders.values()].filter((o) => ACTIVE_STATUSES.has(o.status));
  }

  // quick lookup of active orders for a specific chain pair.
  getByPair(srcChain: number, desChain: number): IntentOrder[] {
    const ids = this.pairIndex.get(pairKey(srcChain, desChain));
    if (!ids) return [];
    const out: IntentOrder[] = [];
    for (const id of ids) {
      const order = this.orders.get(id);
      if (order) out.push(order);
    }
    return out;
  }

  // call after an order transitions to MATCHED so it stops being a candidate.
  // expired orders are handled by expireStale().
  removeFromPairIndex(orderId: string): void {
    const order = this.orders.get(orderId);
    if (!order) return;
    this.pairIndex.get(pairKey(order.srcChain, order.desChain))?.delete(orderId);
  }

  // marks past-deadline active orders as EXPIRED, drops them from the pair index.
  // returns the count of newly-expired orders.
  expireStale(): number {
    const now = Math.floor(Date.now() / 1000);
    const expiredIds: string[] = [];

    for (const order of this.orders.values()) {
      if (ACTIVE_STATUSES.has(order.status) && order.deadline < now) {
        order.status = 'EXPIRED';
        this.pairIndex.get(pairKey(order.srcChain, order.desChain))?.delete(order.orderId);
        expiredIds.push(order.orderId);
      }
    }

    if (expiredIds.length > 0) this.persistExpire(expiredIds);
    return expiredIds.length;
  }

  addMatchResult(result: MatchResult): void {
    this.matchResults.push(result);
    this.persistMatchResult(result);
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

  // returns a user's orders newest-first, paginated. queries DB directly so the
  // list survives in-memory cache eviction and includes historic completed orders.
  async getOrdersByUser(
    userAddress: string,
    page: number,
    pageSize: number
  ): Promise<{ data: IntentOrder[]; total: number; page: number; pageSize: number }> {
    const normalized = userAddress.toLowerCase();
    const offset = (page - 1) * pageSize;

    // case-insensitive match — frontend may send checksummed addresses while
    // the DB stores whatever the client passed in.
    const where = sql`lower(${schema.intentOrders.userAddress}) = ${normalized}`;

    const [rows, totalRow] = await Promise.all([
      db
        .select()
        .from(schema.intentOrders)
        .where(where)
        .orderBy(desc(schema.intentOrders.createdAt))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.intentOrders)
        .where(where),
    ]);

    return {
      data: rows.map(rowToOrder),
      total: totalRow[0]?.count ?? 0,
      page,
      pageSize,
    };
  }

  // wipes in-memory state — tests only, does not touch the DB.
  clear(): void {
    this.orders.clear();
    this.pairIndex.clear();
    this.matchResults.length = 0;
  }

  private indexAdd(order: IntentOrder): void {
    const key = pairKey(order.srcChain, order.desChain);
    let set = this.pairIndex.get(key);
    if (!set) {
      set = new Set();
      this.pairIndex.set(key, set);
    }
    set.add(order.orderId);
  }

  private persistInsert(order: IntentOrder): void {
    if (isTestingMode()) return;
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

  private persistUpdate(order: IntentOrder): void {
    if (isTestingMode()) return;
    void db
      .update(schema.intentOrders)
      .set({
        amount: order.amount,
        incentiveFee: order.incentiveFee ?? null,
        status: order.status,
        deadline: order.deadline,
      })
      .where(eq(schema.intentOrders.orderId, order.orderId))
      .catch((err) => logDbError('orders.update', err));
  }

  private persistExpire(orderIds: string[]): void {
    if (isTestingMode()) return;
    for (const id of orderIds) {
      void db
        .update(schema.intentOrders)
        .set({ status: 'EXPIRED' })
        .where(eq(schema.intentOrders.orderId, id))
        .catch((err) => logDbError('orders.expire', err));
    }
  }

  private persistMatchResult(result: MatchResult): void {
    if (isTestingMode()) return;
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

// module-level singleton.
export const orderStore = new OrderStore();
