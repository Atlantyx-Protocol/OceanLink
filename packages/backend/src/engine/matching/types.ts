// matching engine — shared types

// lifecycle states of an intent order.
export type OrderStatus = 'QUEUED' | 'PARTIAL' | 'MATCHED' | 'EXPIRED';

// an intent order submitted via POST /intent. lives in the queue until matched
// or expired.
export interface IntentOrder {
  orderId: string;
  srcChain: number; // source chainId (> 0)
  desChain: number; // destination chainId (> 0)
  amount: string; // effective USDC amount (= base + incentiveFee if any)
  incentiveFee?: string; // optional extra fee to boost match priority
  deadline: number; // unix epoch seconds — invalid after this
  createdAt: number; // unix epoch seconds — set at creation
  status: OrderStatus;
  userAddress: string; // EVM address — listed as receiver by counterpart orders
}

// one order's contribution to a MatchResult.
// MATCHED = full amount consumed, PARTIAL = remainder stays in the queue.
export interface MatchedOrderEntry {
  orderId: string;
  srcChain: number;
  desChain: number;
  matchedAmount: string; // amount consumed in this match event
  remainingAmount: string; // '0' if MATCHED, positive decimal string if PARTIAL
  status: 'MATCHED' | 'PARTIAL';
}

// one order's participation in a single matched cycle.
export interface CycleMatchEntry {
  orderId: string;
  srcChain: number;
  desChain: number;
  matchedAmount: string; // amount exchanged in this cycle (= minW of the cycle)
}

// a matched cycle: orders forming a directed cycle, exchanging matchedAmount.
export interface CycleMatch {
  matchedAmount: string; // volume exchanged in this cycle (= minW)
  orders: CycleMatchEntry[];
}

// one matching event produced by the scheduler tick.
export interface MatchResult {
  matchId: string;
  matchedAt: number; // unix epoch seconds
  orders: MatchedOrderEntry[];
  cycles: CycleMatch[];
  rawCycles: Array<Array<{ u: number; v: number; w: number }>>;
}

// validated body of POST /intent.
export interface CreateIntentInput {
  srcChain: number | string;
  desChain: number | string;
  amount: string | number;
  incentiveFee?: string | number; // optional fee added to amount to boost match priority
  deadline: number | string;
  userAddress: string;
}

// graph types consumed by the matching algorithm.

// a directed, weighted edge in the matching graph.
export interface Edge {
  id: number; // stable unique id (set at construction)
  u: number; // source vertex (0-indexed)
  v: number; // destination vertex (0-indexed)
  w: number; // current weight (mutated as the algorithm runs)
}

// immutable record of an edge captured when a cycle is stored.
export interface EdgeSnapshot {
  u: number;
  v: number;
  w: number; // weight BEFORE the cancellation step
}

// summary returned by a single scheduler tick (used for logging).
export interface TickStats {
  queuedBefore: number;
  expired: number;
  matchResults: MatchResult[];
  matchedOrders: number;
  partialOrders: number;
  queuedAfter: number;
}
