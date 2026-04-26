import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAndCreateOrder } from './orderValidator.js';

const futureDeadline = Math.floor(Date.now() / 1000) + 3600;

describe('validateAndCreateOrder', () => {
  it('creates a valid order with all fields', () => {
    const result = validateAndCreateOrder({
      srcChain: 11155111,
      desChain: 84532,
      amount: '100',
      deadline: futureDeadline,
      userAddress: '0xUser',
    });

    assert.ok('order' in result);
    const { order } = result;
    assert.equal(order.srcChain, 11155111);
    assert.equal(order.desChain, 84532);
    assert.equal(order.amount, '100');
    assert.equal(order.status, 'QUEUED');
    assert.equal(order.userAddress, '0xUser');
    assert.ok(order.orderId);
  });

  it('rejects srcChain <= 0', () => {
    const result = validateAndCreateOrder({
      srcChain: 0,
      desChain: 84532,
      amount: '100',
      deadline: futureDeadline,
      userAddress: '0xUser',
    });
    assert.ok('error' in result);
    assert.ok(result.error.includes('srcChain'));
  });

  it('rejects desChain <= 0', () => {
    const result = validateAndCreateOrder({
      srcChain: 11155111,
      desChain: -1,
      amount: '100',
      deadline: futureDeadline,
      userAddress: '0xUser',
    });
    assert.ok('error' in result);
    assert.ok(result.error.includes('desChain'));
  });

  it('rejects amount <= 0', () => {
    const result = validateAndCreateOrder({
      srcChain: 11155111,
      desChain: 84532,
      amount: '0',
      deadline: futureDeadline,
      userAddress: '0xUser',
    });
    assert.ok('error' in result);
    assert.ok(result.error.includes('amount'));
  });

  it('rejects NaN amount', () => {
    const result = validateAndCreateOrder({
      srcChain: 11155111,
      desChain: 84532,
      amount: 'abc',
      deadline: futureDeadline,
      userAddress: '0xUser',
    });
    assert.ok('error' in result);
    assert.ok(result.error.includes('amount'));
  });

  it('rejects deadline in the past', () => {
    const result = validateAndCreateOrder({
      srcChain: 11155111,
      desChain: 84532,
      amount: '100',
      deadline: 1000,
      userAddress: '0xUser',
    });
    assert.ok('error' in result);
    assert.ok(result.error.includes('deadline'));
  });

  it('rejects missing userAddress', () => {
    const result = validateAndCreateOrder({
      srcChain: 11155111,
      desChain: 84532,
      amount: '100',
      deadline: futureDeadline,
      userAddress: '',
    });
    assert.ok('error' in result);
    assert.ok(result.error.includes('userAddress'));
  });

  it('adds incentiveFee to effective amount', () => {
    const result = validateAndCreateOrder({
      srcChain: 11155111,
      desChain: 84532,
      amount: '100',
      incentiveFee: '5',
      deadline: futureDeadline,
      userAddress: '0xUser',
    });
    assert.ok('order' in result);
    assert.equal(result.order.amount, '105');
    assert.equal(result.order.incentiveFee, '5');
  });

  it('rejects negative incentiveFee', () => {
    const result = validateAndCreateOrder({
      srcChain: 11155111,
      desChain: 84532,
      amount: '100',
      incentiveFee: '-1',
      deadline: futureDeadline,
      userAddress: '0xUser',
    });
    assert.ok('error' in result);
    assert.ok(result.error.includes('incentiveFee'));
  });

  it('treats incentiveFee of 0 as no fee', () => {
    const result = validateAndCreateOrder({
      srcChain: 11155111,
      desChain: 84532,
      amount: '100',
      incentiveFee: '0',
      deadline: futureDeadline,
      userAddress: '0xUser',
    });
    assert.ok('order' in result);
    assert.equal(result.order.amount, '100');
    assert.equal(result.order.incentiveFee, undefined);
  });

  it('accepts string inputs for srcChain, desChain, deadline', () => {
    const result = validateAndCreateOrder({
      srcChain: '11155111',
      desChain: '84532',
      amount: 100,
      deadline: String(futureDeadline),
      userAddress: '0xUser',
    });
    assert.ok('order' in result);
    assert.equal(result.order.srcChain, 11155111);
    assert.equal(result.order.desChain, 84532);
  });
});
