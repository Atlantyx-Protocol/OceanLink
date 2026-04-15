// ---------------------------------------------------------------------------
// Matching Engine — shared types
// ---------------------------------------------------------------------------

/** Lifecycle states of an intent order. */
export type OrderStatus = 'QUEUED' | 'PARTIAL' | 'MATCHED' | 'EXPIRED';

/**
 * An intent order submitted by a user via POST /intent.
 * Stored in the in-memory queue until matched or expired.
 */
export interface IntentOrder {
  orderId: string;
  srcChain: number; // source chainId (> 0)
  desChain: number; // destination chainId (> 0)
  amount: string; // effective USDC amount (= base amount + incentiveFee if any)
  incentiveFee?: string; // optional extra fee to boost match priority
  deadline: number; // Unix epoch in seconds — order is invalid after this
  createdAt: number; // Unix epoch in seconds — set at creation
  status: OrderStatus;
  userAddress: string; // EVM address of the user — listed as receiver by counterpart orders
}

/**
 * One order's contribution to a MatchResult.
 * status is MATCHED when the full amount was consumed, PARTIAL when only
 * part of the amount was consumed and the rest remains in the queue.
 */
export interface MatchedOrderEntry {
  orderId: string;
  srcChain: number;
  desChain: number;
  matchedAmount: string; // amount consumed in this match event
  remainingAmount: string; // '0' if MATCHED, positive decimal string if PARTIAL
  status: 'MATCHED' | 'PARTIAL';
}

/**
 * One order's participation in a single matched cycle.
 */
export interface CycleMatchEntry {
  orderId: string;
  srcChain: number;
  desChain: number;
  matchedAmount: string; // amount exchanged in this cycle (= minW of the cycle)
}

/**
 * A single matched cycle: a set of orders that form a directed cycle in the
 * graph, exchanging `matchedAmount` units between them.
 */
export interface CycleMatch {
  matchedAmount: string; // volume exchanged in this cycle (= minW)
  orders: CycleMatchEntry[];
}

/**
 * One matching event produced by the scheduler tick.
 * Contains all orders affected in this event, a per-cycle breakdown, and the
 * raw cycle snapshots returned by the underlying graph algorithm.
 */
export interface MatchResult {
  matchId: string;
  matchedAt: number; // Unix epoch in seconds
  orders: MatchedOrderEntry[];
  cycles: CycleMatch[];
  rawCycles: Array<Array<{ u: number; v: number; w: number }>>;
}

/** Validated body of POST /intent. */
export interface CreateIntentInput {
  srcChain: number | string;
  desChain: number | string;
  amount: string | number;
  incentiveFee?: string | number; // optional extra fee added to amount to boost match priority
  deadline: number | string;
  userAddress: string;
}

/** Summary returned by a single scheduler tick (used for logging). */
export interface TickStats {
  queuedBefore: number;
  expired: number;
  matchResults: MatchResult[];
  matchedOrders: number;
  partialOrders: number;
  queuedAfter: number;
}
