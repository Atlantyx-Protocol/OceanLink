import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCycleMatches } from './cycleMapper.js';
import type { IntentOrder } from '../types.js';

function makeOrder(id: string, src: number, des: number, amount: string): IntentOrder {
  return {
    orderId: id,
    srcChain: src,
    desChain: des,
    amount,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    createdAt: Math.floor(Date.now() / 1000),
    status: 'QUEUED',
    userAddress: `0x${id}`,
  };
}

describe('buildCycleMatches', () => {
  it('maps a single cycle with 2 orders', () => {
    const orders = [
      makeOrder('A', 1, 2, '10'),
      makeOrder('B', 2, 1, '15'),
    ];

    const chainToVertex = new Map<number, number>([
      [1, 0],
      [2, 1],
    ]);

    // Simulate rawCycles: one cycle with edges u=0→v=1 w=10 and u=1→v=0 w=15
    const rawCycles = [
      [
        { u: 0, v: 1, w: 10 },
        { u: 1, v: 0, w: 15 },
      ],
    ];

    const result = buildCycleMatches(orders, chainToVertex, rawCycles);
    assert.equal(result.length, 1);
    assert.equal(result[0].matchedAmount, '10'); // minW
    assert.equal(result[0].orders.length, 2);
    assert.equal(result[0].orders[0].orderId, 'A');
    assert.equal(result[0].orders[1].orderId, 'B');
  });

  it('handles two cycles correctly with weight mutation replay', () => {
    const orders = [
      makeOrder('A', 1, 2, '10'),
      makeOrder('B', 2, 1, '30'),
      makeOrder('C', 1, 2, '20'),
    ];

    const chainToVertex = new Map<number, number>([
      [1, 0],
      [2, 1],
    ]);

    // First cycle: A(10) + B(30) → minW=10, B becomes 20
    // Second cycle: C(20) + B(20) → minW=20
    const rawCycles = [
      [
        { u: 0, v: 1, w: 10 },
        { u: 1, v: 0, w: 30 },
      ],
      [
        { u: 0, v: 1, w: 20 },
        { u: 1, v: 0, w: 20 },
      ],
    ];

    const result = buildCycleMatches(orders, chainToVertex, rawCycles);
    assert.equal(result.length, 2);

    // First cycle
    assert.equal(result[0].matchedAmount, '10');
    assert.equal(result[0].orders.length, 2);

    // Second cycle
    assert.equal(result[1].matchedAmount, '20');
    assert.equal(result[1].orders.length, 2);
  });

  it('returns empty array for no cycles', () => {
    const result = buildCycleMatches([], new Map(), []);
    assert.equal(result.length, 0);
  });
});
