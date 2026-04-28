import { pgTable, text, integer, jsonb } from 'drizzle-orm/pg-core';
import type {
  MatchedOrderEntry,
  CycleMatch,
  OrderStatus,
} from '../engine/matching/types.js';
import type { ExecutionData } from '../engine/orchestrator/executionStore.js';

// ---------------------------------------------------------------------------
// intent_orders — one row per IntentOrder.
// Amounts are stored as text to preserve full precision (USDC uses 6
// decimals, but the matching layer handles arbitrary integer strings).
// ---------------------------------------------------------------------------
export const intentOrders = pgTable('intent_orders', {
  orderId: text('order_id').primaryKey(),
  srcChain: integer('src_chain').notNull(),
  desChain: integer('des_chain').notNull(),
  amount: text('amount').notNull(),
  incentiveFee: text('incentive_fee'),
  deadline: integer('deadline').notNull(),
  createdAt: integer('created_at').notNull(),
  status: text('status').notNull().$type<OrderStatus>(),
  userAddress: text('user_address').notNull(),
});

// ---------------------------------------------------------------------------
// match_results — append-only log of matching events.
// orders / cycles / raw_cycles are stored as JSONB blobs; the matching
// engine never queries inside them, it only reads the whole record back.
// ---------------------------------------------------------------------------
export const matchResults = pgTable('match_results', {
  matchId: text('match_id').primaryKey(),
  matchedAt: integer('matched_at').notNull(),
  orders: jsonb('orders').notNull().$type<MatchedOrderEntry[]>(),
  cycles: jsonb('cycles').notNull().$type<CycleMatch[]>(),
  rawCycles: jsonb('raw_cycles')
    .notNull()
    .$type<Array<Array<{ u: number; v: number; w: number }>>>(),
});

// ---------------------------------------------------------------------------
// executions — current execution state per matchId.
// Updated in place as the orchestrator transitions pending → done|error.
// ---------------------------------------------------------------------------
export const executions = pgTable('executions', {
  matchId: text('match_id').primaryKey(),
  status: text('status').notNull().$type<'pending' | 'done' | 'error'>(),
  data: jsonb('data').$type<ExecutionData>(),
  error: text('error'),
});
