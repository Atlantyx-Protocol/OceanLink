// tests for the liquidity market service (node:test via tsx --test).
// covers seeding, refill, random-amount matching, all 6 routes, and e2e flow.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { OrderStore } from '../matching/store/orderStore.js';
import { MatchingService } from '../matching/service/matchingService.js';
import { LiquidityService, POWER_OF_TWO_AMOUNTS } from './liquidityService.js';
import type { LPConfig } from './liquidityService.js';

// the store persists to Postgres unless testing mode is on. these are pure
// in-memory tests, so turn it on before any order is created.
process.env.OCEAN_LINK_TESTING = '1';

// same chain IDs used by the service
const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const ARBITRUM_SEPOLIA = 421614;

// deterministic addresses, no real private keys needed
const TEST_LP_CONFIGS: LPConfig[] = [
  {
    name: 'B',
    address: '0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    srcChainId: SEPOLIA,
    desChainIds: [BASE_SEPOLIA, ARBITRUM_SEPOLIA],
  },
  {
    name: 'C',
    address: '0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    srcChainId: BASE_SEPOLIA,
    desChainIds: [SEPOLIA, ARBITRUM_SEPOLIA],
  },
  {
    name: 'D',
    address: '0xDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
    srcChainId: ARBITRUM_SEPOLIA,
    desChainIds: [SEPOLIA, BASE_SEPOLIA],
  },
];

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function futureDeadline(offset = 3600): number {
  return nowSec() + offset;
}

// fresh (store, service, liquidityService) triple, threshold = 0
function makeSetup() {
  const store = new OrderStore();
  const service = new MatchingService(store, undefined, 0);
  const liq = new LiquidityService(service, store, TEST_LP_CONFIGS);
  return { store, service, liq };
}

// expected order count: 3 LPs x 2 dest chains x 14 amounts = 84
const EXPECTED_TOTAL_ORDERS = TEST_LP_CONFIGS.length * 2 * POWER_OF_TWO_AMOUNTS.length;

describe('LiquidityService.seed', () => {
  it('creates the correct number of LP orders', () => {
    const { store, liq } = makeSetup();

    const { created, skipped } = liq.seed();

    assert.equal(created, EXPECTED_TOTAL_ORDERS, `should create ${EXPECTED_TOTAL_ORDERS} orders`);
    assert.equal(skipped, 0, 'nothing to skip on first seed');
    assert.equal(store.getActiveOrders().length, EXPECTED_TOTAL_ORDERS);
  });

  it('creates orders for each LP on each route with power-of-2 amounts', () => {
    const { store, liq } = makeSetup();
    liq.seed();

    for (const lp of TEST_LP_CONFIGS) {
      for (const des of lp.desChainIds) {
        const pairOrders = store.getByPair(lp.srcChainId, des);
        const amounts = pairOrders.map((o) => Number(o.amount)).sort((a, b) => a - b);

        assert.deepEqual(
          amounts,
          POWER_OF_TWO_AMOUNTS,
          `LP ${lp.name} route ${lp.srcChainId}->${des} should have all power-of-2 amounts`
        );

        // all should belong to the correct LP address
        for (const o of pairOrders) {
          assert.equal(o.userAddress, lp.address);
          assert.equal(o.status, 'QUEUED');
        }
      }
    }
  });

  it('does not create duplicates when seed is called twice', () => {
    const { store, liq } = makeSetup();

    liq.seed();
    const { created, skipped } = liq.seed();

    assert.equal(created, 0, 'second seed should create 0 new orders');
    assert.equal(skipped, EXPECTED_TOTAL_ORDERS, 'all should be skipped');
    assert.equal(store.getActiveOrders().length, EXPECTED_TOTAL_ORDERS);
  });
});

describe('LiquidityService.refill', () => {
  it('recreates orders that have been matched', () => {
    const { store, service, liq } = makeSetup();
    liq.seed();

    // user wants Base->Sepolia, matched against LP B (Sepolia->Base)
    const userResult = service.createOrder({
      srcChain: BASE_SEPOLIA,
      desChain: SEPOLIA,
      amount: '1024',
      deadline: futureDeadline(),
      userAddress: '0xUSER',
    });
    assert.ok('order' in userResult);

    // run LP-filtered matching (prevents LP<->LP self-matching)
    liq.tick();

    // verify the user order was matched
    const userOrder = store.get((userResult as { order: { orderId: string } }).order.orderId);
    assert.equal(userOrder?.status, 'MATCHED', 'user order should be matched');

    // after tick (which includes refill), the 1024 slot should be covered again
    const afterRefill = store.getByPair(SEPOLIA, BASE_SEPOLIA);
    const restored = afterRefill.some((o) => Number(o.amount) === 1024 && o.status === 'QUEUED');
    assert.ok(restored, '1024 order should be restored after refill');
  });

  it('recreates expired orders', () => {
    const { store, liq } = makeSetup();
    liq.seed();

    // manually expire one order by setting its deadline to the past
    const pairOrders = store.getByPair(SEPOLIA, BASE_SEPOLIA);
    const target = pairOrders.find((o) => Number(o.amount) === 512);
    assert.ok(target, 'should find a 512 order');

    store.update(target!.orderId, { deadline: nowSec() - 10 });
    store.expireStale();

    assert.equal(store.get(target!.orderId)?.status, 'EXPIRED');

    const refilled = liq.refill();
    assert.ok(refilled >= 1, 'should refill the expired order');

    const after = store.getByPair(SEPOLIA, BASE_SEPOLIA);
    const has512 = after.some((o) => Number(o.amount) === 512 && o.status === 'QUEUED');
    assert.ok(has512, '512 order should be restored');
  });

  it('does not refill active orders (no duplicates)', () => {
    const { liq } = makeSetup();
    liq.seed();

    const refilled = liq.refill();
    assert.equal(refilled, 0, 'nothing should be refilled when all orders are active');
  });
});

describe('Matching coverage — random amounts', () => {
  it('fully matches random user amounts in [1, 10000] on a single route', () => {
    // route: user sends Base->Sepolia, matched against LP B (Sepolia->Base)
    const amounts = [1, 7, 42, 100, 255, 1000, 1298, 5000, 7777, 9999, 10000];

    for (const userAmount of amounts) {
      const { store, service, liq } = makeSetup();
      liq.seed();

      const result = service.createOrder({
        srcChain: BASE_SEPOLIA,
        desChain: SEPOLIA,
        amount: String(userAmount),
        deadline: futureDeadline(),
        userAddress: '0xUSER',
      });
      assert.ok('order' in result, `order creation should succeed for amount ${userAmount}`);

      const stats = liq.tick();

      const userOrder = store.get((result as { order: { orderId: string } }).order.orderId);
      assert.equal(
        userOrder?.status,
        'MATCHED',
        `user order for amount ${userAmount} should be MATCHED (got ${userOrder?.status})`
      );

      // verify match result records the full amount
      const totalMatched = stats.matchResults
        .flatMap((r) => r.orders)
        .filter((o) => o.orderId === userOrder!.orderId)
        .reduce((sum, o) => sum + Number(o.matchedAmount), 0);

      assert.equal(
        totalMatched,
        userAmount,
        `total matched amount should equal ${userAmount} (got ${totalMatched})`
      );
    }
  });

  it('matches 20 random amounts between 1 and 10000', () => {
    // deterministic "random" using a simple LCG
    let seed = 12345;
    const nextRand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed % 10000) + 1; // [1, 10000]
    };

    for (let i = 0; i < 20; i++) {
      const userAmount = nextRand();
      const { store, service, liq } = makeSetup();
      liq.seed();

      const result = service.createOrder({
        srcChain: ARBITRUM_SEPOLIA,
        desChain: SEPOLIA,
        amount: String(userAmount),
        deadline: futureDeadline(),
        userAddress: '0xUSER',
      });
      assert.ok('order' in result);

      liq.tick();

      const userOrder = store.get((result as { order: { orderId: string } }).order.orderId);
      assert.equal(
        userOrder?.status,
        'MATCHED',
        `random amount ${userAmount} (iteration ${i}) should be MATCHED (got ${userOrder?.status})`
      );
    }
  });
});

describe('Matching coverage — all chain pairs', () => {
  const ALL_PAIRS = [
    { userSrc: BASE_SEPOLIA, userDes: SEPOLIA, label: 'Base->Sepolia' },
    { userSrc: ARBITRUM_SEPOLIA, userDes: SEPOLIA, label: 'Arb->Sepolia' },
    { userSrc: SEPOLIA, userDes: BASE_SEPOLIA, label: 'Sepolia->Base' },
    { userSrc: ARBITRUM_SEPOLIA, userDes: BASE_SEPOLIA, label: 'Arb->Base' },
    { userSrc: SEPOLIA, userDes: ARBITRUM_SEPOLIA, label: 'Sepolia->Arb' },
    { userSrc: BASE_SEPOLIA, userDes: ARBITRUM_SEPOLIA, label: 'Base->Arb' },
  ];

  for (const { userSrc, userDes, label } of ALL_PAIRS) {
    it(`matches user intent on route ${label}`, () => {
      const { store, service, liq } = makeSetup();
      liq.seed();

      const amount = 3333;
      const result = service.createOrder({
        srcChain: userSrc,
        desChain: userDes,
        amount: String(amount),
        deadline: futureDeadline(),
        userAddress: '0xUSER',
      });
      assert.ok('order' in result);

      liq.tick();

      const userOrder = store.get((result as { order: { orderId: string } }).order.orderId);
      assert.equal(
        userOrder?.status,
        'MATCHED',
        `user order on ${label} should be MATCHED (got ${userOrder?.status})`
      );
    });
  }
});

describe('E2E — full lifecycle', () => {
  it('seed -> user match -> refill -> second user match', () => {
    const { store, service, liq } = makeSetup();

    // seed liquidity
    liq.seed();
    const initialActive = store.getActiveOrders().length;
    assert.equal(initialActive, EXPECTED_TOTAL_ORDERS);

    // user intent — consumes some LP orders
    const user1 = service.createOrder({
      srcChain: ARBITRUM_SEPOLIA,
      desChain: BASE_SEPOLIA,
      amount: '5000',
      deadline: futureDeadline(),
      userAddress: '0xUSER1',
    });
    assert.ok('order' in user1);

    // tick() runs filtered matching + auto-refill
    liq.tick();

    const u1Order = store.get((user1 as { order: { orderId: string } }).order.orderId);
    assert.equal(u1Order?.status, 'MATCHED', 'first user should be fully matched');

    // second user on the SAME route should also match — tick's refill already
    // recreated the consumed LP orders
    const user2 = service.createOrder({
      srcChain: ARBITRUM_SEPOLIA,
      desChain: BASE_SEPOLIA,
      amount: '5000',
      deadline: futureDeadline(),
      userAddress: '0xUSER2',
    });
    assert.ok('order' in user2);

    liq.tick();

    const u2Order = store.get((user2 as { order: { orderId: string } }).order.orderId);
    assert.equal(u2Order?.status, 'MATCHED', 'second user should match after refill');
  });

  it('exact power-of-2 amount matches and is refilled correctly', () => {
    const { store, service, liq } = makeSetup();
    liq.seed();

    // match exactly 4096 on Sepolia->Arb route
    const result = service.createOrder({
      srcChain: SEPOLIA,
      desChain: ARBITRUM_SEPOLIA,
      amount: '4096',
      deadline: futureDeadline(),
      userAddress: '0xUSER',
    });
    assert.ok('order' in result);

    liq.tick();

    const order = store.get((result as { order: { orderId: string } }).order.orderId);
    assert.equal(order?.status, 'MATCHED');

    // verify the LP 4096 slot on ArbSepolia->Sepolia is restored (refill runs inside tick)
    const pairOrders = store.getByPair(ARBITRUM_SEPOLIA, SEPOLIA);
    const has4096 = pairOrders.some(
      (o) => Number(o.amount) === 4096 && (o.status === 'QUEUED' || o.status === 'PARTIAL')
    );
    assert.ok(has4096, '4096 LP order should exist after refill');
  });

  it('no duplicate active orders after multiple seed + refill cycles', () => {
    const { store, liq } = makeSetup();

    liq.seed();
    liq.refill();
    liq.seed();
    liq.refill();

    // count orders per (address, src, des, amount) — each should appear exactly once
    const seen = new Map<string, number>();
    for (const order of store.getActiveOrders()) {
      const key = `${order.userAddress}-${order.srcChain}-${order.desChain}-${order.amount}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    for (const [key, count] of seen) {
      assert.equal(count, 1, `duplicate active order found: ${key} (count=${count})`);
    }
  });
});
