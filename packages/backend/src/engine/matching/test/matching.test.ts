// matching engine integration tests. each test owns its own store/service
// for isolation. runner: node:test via tsx --test.

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { OrderStore } from '../store/orderStore.js';
import { MatchingService } from '../service/matchingService.js';
import type { AlgorithmFn } from '../service/matchingService.js';
import type { Edge, EdgeSnapshot } from '../types.js';

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function futureDeadline(offsetSeconds = 3600): number {
  return nowSec() + offsetSeconds;
}

function pastDeadline(offsetSeconds = 1): number {
  return nowSec() - offsetSeconds;
}

// fresh (store, service) pair per test.
function makeSetup(algorithmFn?: AlgorithmFn, threshold = 0.8) {
  const store = new OrderStore();
  const service = new MatchingService(store, algorithmFn, threshold);
  return { store, service };
}

// test 1 — create order ok
describe('MatchingService.createOrder', () => {
  it('returns a QUEUED order with a generated orderId when input is valid', () => {
    const { store, service } = makeSetup();

    const result = service.createOrder({
      srcChain: 1,
      desChain: 2,
      amount: '100',
      deadline: futureDeadline(),

      userAddress: '0x123',
    });

    assert.ok(
      !('error' in result),
      `Expected order, got error: ${(result as { error: string }).error}`
    );
    const { order } = result as { order: ReturnType<OrderStore['get']> & object };

    assert.ok(order, 'order should be defined');
    assert.match(order!.orderId, /^[0-9a-f-]{36}$/, 'orderId should be a UUID');
    assert.equal(order!.status, 'QUEUED');
    assert.equal(order!.srcChain, 1);
    assert.equal(order!.desChain, 2);
    assert.equal(order!.amount, '100');
    assert.equal(store.totalCount(), 1);

    // verify it is retrievable from the store
    const stored = store.get(order!.orderId);
    assert.ok(stored, 'order should be stored');
    assert.equal(stored!.status, 'QUEUED');
  });

  // test 2 — reject past deadline
  it('returns an error when deadline is in the past', () => {
    const { service } = makeSetup();

    const result = service.createOrder({
      srcChain: 1,
      desChain: 2,
      amount: '50',
      deadline: pastDeadline(60), // 60 seconds ago

      userAddress: '0x123',
    });

    assert.ok('error' in result, 'Should return an error for past deadline');
    assert.match(
      (result as { error: string }).error,
      /deadline/i,
      'Error message should mention "deadline"'
    );
  });

  it('returns an error when srcChain is zero or negative', () => {
    const { service } = makeSetup();
    const base = { desChain: 2, amount: '10', deadline: futureDeadline(), userAddress: '0x123' };

    const r1 = service.createOrder({ ...base, srcChain: 0 });
    assert.ok('error' in r1);

    const r2 = service.createOrder({ ...base, srcChain: -5 });
    assert.ok('error' in r2);
  });

  it('returns an error when amount is zero or negative', () => {
    const { service } = makeSetup();
    const base = { srcChain: 1, desChain: 2, deadline: futureDeadline(), userAddress: '0x123' };

    const r1 = service.createOrder({ ...base, amount: '0' });
    assert.ok('error' in r1);

    const r2 = service.createOrder({ ...base, amount: '-10' });
    assert.ok('error' in r2);
  });
});

// test 3 — scheduler expire order
describe('OrderStore.expireStale', () => {
  it('marks orders past their deadline as EXPIRED and removes from pair index', () => {
    const { store, service } = makeSetup();

    // add one order that is already expired
    const r = service.createOrder({
      srcChain: 10,
      desChain: 20,
      amount: '75',
      deadline: pastDeadline(1),

      userAddress: '0x123',
    });
    // createOrder rejects past deadlines, so we insert directly to simulate
    // an order whose deadline passes after creation.
    assert.ok('error' in r); // confirm service rejects it
    void r;

    // insert directly as if deadline just passed
    store.add({
      orderId: 'test-expired-order',
      srcChain: 10,
      desChain: 20,
      amount: '75',
      deadline: pastDeadline(1),
      createdAt: pastDeadline(120),
      status: 'QUEUED',

      userAddress: '0x123',
    });

    assert.equal(store.getActiveOrders().length, 1);

    const expiredCount = store.expireStale();

    assert.equal(expiredCount, 1, 'Should expire exactly 1 order');

    const order = store.get('test-expired-order');
    assert.equal(order?.status, 'EXPIRED', 'Order status should be EXPIRED');

    assert.equal(store.getActiveOrders().length, 0, 'No active orders after expiry');

    // pair index should be cleared
    assert.deepEqual(
      store.getByPair(10, 20),
      [],
      'Secondary pair index should be empty after expiry'
    );
  });

  it('tick also expires orders via runTick', () => {
    const { store, service } = makeSetup();

    store.add({
      orderId: 'tick-expired',
      srcChain: 1,
      desChain: 3,
      amount: '50',
      deadline: pastDeadline(5),
      createdAt: pastDeadline(600),
      status: 'QUEUED',

      userAddress: '0x123',
    });

    const stats = service.runTick();

    assert.equal(stats.expired, 1);
    assert.equal(store.get('tick-expired')?.status, 'EXPIRED');
  });
});

// test 4 — scheduler calls the algorithm with the correct dataset
describe('MatchingService adapter', () => {
  it('calls the algorithm with n=unique chains, edges mapped from orders', () => {
    // capture what the adapter passes to the algorithm
    let capturedN: number | undefined;
    let capturedEdges: Edge[] | undefined;
    let capturedX: number | undefined;

    const mockAlgorithm: AlgorithmFn = (n, edges, x): EdgeSnapshot[][] => {
      capturedN = n;
      capturedEdges = edges.map((e) => ({ ...e })); // snapshot before mutation
      capturedX = x;
      return []; // no cycles — we only test the inputs here
    };

    const { store, service } = makeSetup(mockAlgorithm, 0.8);

    // two orders: chain 1 → chain 2 and chain 2 → chain 1
    store.add({
      orderId: 'order-a',
      srcChain: 1,
      desChain: 2,
      amount: '100',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x111',
    });
    store.add({
      orderId: 'order-b',
      srcChain: 2,
      desChain: 1,
      amount: '90',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x222',
    });

    service.runMatchingPass(store.getActiveOrders());

    assert.equal(capturedN, 2, 'n should be 2 (chains 1 and 2)');
    assert.ok(capturedEdges, 'edges should have been captured');
    assert.equal(capturedEdges!.length, 2, 'should have one edge per order');
    assert.equal(capturedX, 0.8, 'threshold should match configured value');

    // the two edges form a pair (u→v, v→u) with respective amounts
    const edgeA = capturedEdges!.find((e) => e.id === 0)!;
    const edgeB = capturedEdges!.find((e) => e.id === 1)!;

    assert.equal(edgeA.w, 100, 'order-a weight should be 100');
    assert.equal(edgeB.w, 90, 'order-b weight should be 90');
    // they should form opposite directions
    assert.equal(edgeA.u, edgeB.v, 'order-a src vertex == order-b dst vertex');
    assert.equal(edgeA.v, edgeB.u, 'order-a dst vertex == order-b src vertex');
  });
});

// test 5 — order status changes to MATCHED / PARTIAL when a match is found
describe('MatchingService.runMatchingPass — real algorithm', () => {
  it('marks the smaller order MATCHED and the larger order PARTIAL', () => {
    // real algorithm with threshold 0 so all cycles are captured.
    // A (chain1→chain2, 100) and B (chain2→chain1, 90) form cycle [A, B]:
    //   minW=90 (B), maxW=100 (A) → B MATCHED, A.w reduced to 10 (PARTIAL)
    const { store, service } = makeSetup(undefined, 0);

    store.add({
      orderId: 'order-x',
      srcChain: 1,
      desChain: 2,
      amount: '100',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x111',
    });
    store.add({
      orderId: 'order-y',
      srcChain: 2,
      desChain: 1,
      amount: '90',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x222',
    });

    const results = service.runMatchingPass(store.getActiveOrders());

    assert.equal(results.length, 1, 'Should produce one MatchResult');
    const result = results[0]!;
    assert.equal(result.orders.length, 2, 'Both orders should appear in the result');

    // order-y (90) is fully consumed — MATCHED
    const entryY = result.orders.find((o) => o.orderId === 'order-y');
    assert.ok(entryY, 'order-y should be in match result');
    assert.equal(entryY!.status, 'MATCHED');
    assert.equal(entryY!.matchedAmount, '90');
    assert.equal(entryY!.remainingAmount, '0');

    // order-x (100) is partially consumed — PARTIAL, remaining 10
    const entryX = result.orders.find((o) => o.orderId === 'order-x');
    assert.ok(entryX, 'order-x should be in match result');
    assert.equal(entryX!.status, 'PARTIAL');
    assert.equal(entryX!.matchedAmount, '90');
    assert.equal(entryX!.remainingAmount, '10');

    // verify store state
    assert.equal(store.get('order-y')?.status, 'MATCHED');
    assert.equal(store.get('order-x')?.status, 'PARTIAL');
    assert.equal(
      store.get('order-x')?.amount,
      '10',
      'Stored amount should be updated to remainder'
    );

    // MATCHED order should be removed from pair index
    const pair21 = store.getByPair(2, 1);
    assert.ok(
      !pair21.some((o) => o.orderId === 'order-y'),
      'MATCHED order should not be in pair index'
    );
  });

  it('equal-amount orders are both MATCHED (ratio = 1.0 > threshold 0)', () => {
    const { store, service } = makeSetup(undefined, 0);

    store.add({
      orderId: 'eq-a',
      srcChain: 3,
      desChain: 4,
      amount: '50',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x111',
    });
    store.add({
      orderId: 'eq-b',
      srcChain: 4,
      desChain: 3,
      amount: '50',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x222',
    });

    service.runMatchingPass(store.getActiveOrders());

    // both should be MATCHED because ratio = 1.0 > 0
    assert.equal(store.get('eq-a')?.status, 'MATCHED');
    assert.equal(store.get('eq-b')?.status, 'MATCHED');
  });

  it('does not match when ratio is below the threshold', () => {
    // threshold=0.95, ratio=50/100=0.5 < 0.95 → no match
    const { store, service } = makeSetup(undefined, 0.95);

    store.add({
      orderId: 'low-a',
      srcChain: 5,
      desChain: 6,
      amount: '100',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x111',
    });
    store.add({
      orderId: 'low-b',
      srcChain: 6,
      desChain: 5,
      amount: '50',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x222',
    });

    const results = service.runMatchingPass(store.getActiveOrders());
    assert.equal(results.length, 0, 'No match expected when ratio < threshold');
    assert.equal(store.get('low-a')?.status, 'QUEUED');
    assert.equal(store.get('low-b')?.status, 'QUEUED');
  });
});

// test 6 — incentiveFee
describe('MatchingService.createOrder — incentiveFee', () => {
  it('creates order without incentiveFee (backward compatible)', () => {
    const { store, service } = makeSetup();

    const result = service.createOrder({
      srcChain: 1,
      desChain: 2,
      amount: '100',
      deadline: futureDeadline(),

      userAddress: '0x123',
    });

    assert.ok(!('error' in result));
    const { order } = result as { order: NonNullable<ReturnType<OrderStore['get']>> };
    assert.equal(order.amount, '100', 'amount should stay 100 without fee');
    assert.equal(order.incentiveFee, undefined, 'incentiveFee should be undefined');
  });

  it('adds incentiveFee to amount when provided', () => {
    const { store, service } = makeSetup();

    const result = service.createOrder({
      srcChain: 1,
      desChain: 2,
      amount: '100',
      incentiveFee: '10',
      deadline: futureDeadline(),

      userAddress: '0x123',
    });

    assert.ok(!('error' in result));
    const { order } = result as { order: NonNullable<ReturnType<OrderStore['get']>> };
    assert.equal(order.amount, '110', 'effective amount should be 100 + 10 = 110');
    assert.equal(order.incentiveFee, '10', 'incentiveFee should be stored');
  });

  it('rejects negative incentiveFee', () => {
    const { service } = makeSetup();

    const result = service.createOrder({
      srcChain: 1,
      desChain: 2,
      amount: '100',
      incentiveFee: '-5',
      deadline: futureDeadline(),

      userAddress: '0x123',
    });

    assert.ok('error' in result);
    assert.match((result as { error: string }).error, /incentiveFee/i);
  });

  it('incentiveFee of 0 is treated as no fee', () => {
    const { service } = makeSetup();

    const result = service.createOrder({
      srcChain: 1,
      desChain: 2,
      amount: '100',
      incentiveFee: '0',
      deadline: futureDeadline(),

      userAddress: '0x123',
    });

    assert.ok(!('error' in result));
    const { order } = result as { order: NonNullable<ReturnType<OrderStore['get']>> };
    assert.equal(order.amount, '100', 'amount unchanged when fee is 0');
    assert.equal(order.incentiveFee, undefined, 'no incentiveFee stored for 0');
  });
});

// test 7 — incentiveFee improves matching
describe('IncentiveFee — matching behavior', () => {
  it('order with incentiveFee has higher effective amount in matching', () => {
    // threshold=0.95 — 100 vs 50 would NOT match (ratio 0.5).
    // fee=50 on the 50-order → effective=100, ratio=1.0 > 0.95 → matches.
    const { store, service } = makeSetup(undefined, 0.95);

    store.add({
      orderId: 'fee-a',
      srcChain: 7,
      desChain: 8,
      amount: '100',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x111',
    });

    // this order has effective amount = 50 + 50 = 100 (fee already folded in)
    store.add({
      orderId: 'fee-b',
      srcChain: 8,
      desChain: 7,
      amount: '100', // effective amount after fee
      incentiveFee: '50',
      deadline: futureDeadline(),
      createdAt: nowSec(),
      status: 'QUEUED',

      userAddress: '0x222',
    });

    const results = service.runMatchingPass(store.getActiveOrders());
    assert.equal(results.length, 1, 'Should match with boosted amount');
    assert.equal(store.get('fee-a')?.status, 'MATCHED');
    assert.equal(store.get('fee-b')?.status, 'MATCHED');
  });
});
