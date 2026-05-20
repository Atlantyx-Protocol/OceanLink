import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectLpOrdersForUsers } from './lpSelector.js';
import type { IntentOrder } from '../matching/types.js';

const LP_ADDR = '0xLP';
const USER_ADDR = '0xUser';

function makeOrder(
  id: string,
  src: number,
  des: number,
  amount: string,
  userAddress: string
): IntentOrder {
  return {
    orderId: id,
    srcChain: src,
    desChain: des,
    amount,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    createdAt: Math.floor(Date.now() / 1000),
    status: 'QUEUED',
    userAddress,
  };
}

describe('selectLpOrdersForUsers', () => {
  const lpAddresses = new Set([LP_ADDR]);

  it('selects LP orders matching binary decomposition of user amount', () => {
    // user wants 10 on route 1->2, so LP needs reverse route 2->1.
    // binary decomposition of 10 = 8 + 2
    const userOrders = [makeOrder('user1', 1, 2, '10', USER_ADDR)];

    const allActive = [
      ...userOrders,
      makeOrder('lp1', 2, 1, '1', LP_ADDR),
      makeOrder('lp2', 2, 1, '2', LP_ADDR),
      makeOrder('lp4', 2, 1, '4', LP_ADDR),
      makeOrder('lp8', 2, 1, '8', LP_ADDR),
    ];

    const selected = selectLpOrdersForUsers(userOrders, allActive, lpAddresses);
    assert.equal(selected.length, 2);

    const amounts = selected.map((o) => Number(o.amount)).sort((a, b) => a - b);
    assert.deepEqual(amounts, [2, 8]);
  });

  it('returns empty when no LP orders match reverse route', () => {
    const userOrders = [makeOrder('user1', 1, 2, '10', USER_ADDR)];
    const allActive = [
      ...userOrders,
      makeOrder('lp1', 1, 2, '8', LP_ADDR), // same direction, not reverse
    ];

    const selected = selectLpOrdersForUsers(userOrders, allActive, lpAddresses);
    assert.equal(selected.length, 0);
  });

  it('does not reserve the same LP order for two users', () => {
    const userOrders = [
      makeOrder('user1', 1, 2, '8', USER_ADDR),
      makeOrder('user2', 1, 2, '8', '0xUser2'),
    ];

    const allActive = [
      ...userOrders,
      makeOrder('lp8', 2, 1, '8', LP_ADDR), // only one LP order of amount 8
    ];

    const selected = selectLpOrdersForUsers(userOrders, allActive, lpAddresses);
    // only one user can get it
    assert.equal(selected.length, 1);
  });

  it('skips PARTIAL LP orders', () => {
    const userOrders = [makeOrder('user1', 1, 2, '4', USER_ADDR)];
    const partialLp = makeOrder('lp4', 2, 1, '4', LP_ADDR);
    partialLp.status = 'PARTIAL';

    const allActive = [...userOrders, partialLp];

    const selected = selectLpOrdersForUsers(userOrders, allActive, lpAddresses);
    assert.equal(selected.length, 0);
  });

  it('handles exact power-of-2 user amount', () => {
    const userOrders = [makeOrder('user1', 1, 2, '16', USER_ADDR)];

    const allActive = [...userOrders, makeOrder('lp16', 2, 1, '16', LP_ADDR)];

    const selected = selectLpOrdersForUsers(userOrders, allActive, lpAddresses);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].amount, '16');
  });
});
