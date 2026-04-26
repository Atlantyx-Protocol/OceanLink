import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ERC20_ABI, HTLC_ABI } from './abi.js';

describe('ERC20_ABI', () => {
  it('should contain expected function signatures', () => {
    const signatures = ERC20_ABI.join('\n');
    assert.ok(signatures.includes('function approve'));
    assert.ok(signatures.includes('function allowance'));
    assert.ok(signatures.includes('function balanceOf'));
    assert.ok(signatures.includes('function decimals'));
    assert.ok(signatures.includes('function symbol'));
  });

  it('should have no duplicate entries', () => {
    const unique = new Set(ERC20_ABI);
    assert.equal(unique.size, ERC20_ABI.length, 'ERC20_ABI contains duplicates');
  });
});

describe('HTLC_ABI', () => {
  it('should contain write functions', () => {
    const signatures = HTLC_ABI.join('\n');
    assert.ok(signatures.includes('function newOrder'));
    assert.ok(signatures.includes('function withdraw'));
    assert.ok(signatures.includes('function refund'));
  });

  it('should contain read functions', () => {
    const signatures = HTLC_ABI.join('\n');
    assert.ok(signatures.includes('function getOrder'));
    assert.ok(signatures.includes('function getFill'));
    assert.ok(signatures.includes('function getOrderFills'));
    assert.ok(signatures.includes('function nextOrderId'));
    assert.ok(signatures.includes('function orderExistsCheck'));
    assert.ok(signatures.includes('function getClaimStatus'));
    assert.ok(signatures.includes('function allowWithdrawAfterExpiry'));
  });

  it('should contain events', () => {
    const signatures = HTLC_ABI.join('\n');
    assert.ok(signatures.includes('event OrderCreated'));
    assert.ok(signatures.includes('event FillCreated'));
    assert.ok(signatures.includes('event FillWithdrawn'));
    assert.ok(signatures.includes('event OrderRefunded'));
  });

  it('should have no duplicate entries', () => {
    const unique = new Set(HTLC_ABI);
    assert.equal(unique.size, HTLC_ABI.length, 'HTLC_ABI contains duplicates');
  });
});
