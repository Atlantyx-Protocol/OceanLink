import { eq } from 'drizzle-orm';
import { db, schema, logDbError } from '../../db/client.js';

// ---------------------------------------------------------------------------
// Execution state — stored per matchId so the API can expose it.
// In-memory map mirrors the `executions` table; writes are fire-and-forget,
// hydrate() rebuilds the map from the DB on startup.
// ---------------------------------------------------------------------------

export interface ExecutionWithdraw {
  fillId: string;
  secret: string;
  receiverAddress: string;
}

export interface ExecutionData {
  presidingOrder: {
    orderId: string;
    chain: string;
    withdraws: ExecutionWithdraw[];
  };
  respondingWithdraws: Array<{
    orderId: string;
    fillId: string;
    chain: string;
    secret: string;
    receiverAddress: string;
  }>;
}

export interface ExecutionRecord {
  status: 'pending' | 'done' | 'error';
  data?: ExecutionData;
  error?: string;
}

export class ExecutionStore {
  private readonly records = new Map<string, ExecutionRecord>();

  async hydrate(): Promise<void> {
    const rows = await db.select().from(schema.executions);
    for (const row of rows) {
      this.records.set(row.matchId, {
        status: row.status,
        data: row.data ?? undefined,
        error: row.error ?? undefined,
      });
    }
  }

  get(matchId: string): ExecutionRecord | undefined {
    return this.records.get(matchId);
  }

  set(matchId: string, record: ExecutionRecord): void {
    this.records.set(matchId, record);

    void db
      .insert(schema.executions)
      .values({
        matchId,
        status: record.status,
        data: record.data ?? null,
        error: record.error ?? null,
      })
      .onConflictDoUpdate({
        target: schema.executions.matchId,
        set: {
          status: record.status,
          data: record.data ?? null,
          error: record.error ?? null,
        },
      })
      .catch((err) => logDbError('executions.set', err));
  }
}
