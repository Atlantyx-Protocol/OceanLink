import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  groupActionsByChainKey,
  buildCycleHashlockMap,
  buildCycleSecretMap,
  type SendAction,
} from './cycleActions.js';

describe('groupActionsByChainKey', () => {
  it('groups actions by chain key + sender', () => {
    const actions: SendAction[] = [
      { senderAddress: '0xA', receiverAddress: '0xB', srcChain: 1, chainKey: 'sepolia', amount: '10', cycleIdx: 0 },
      { senderAddress: '0xA', receiverAddress: '0xC', srcChain: 1, chainKey: 'sepolia', amount: '10', cycleIdx: 1 },
      { senderAddress: '0xB', receiverAddress: '0xA', srcChain: 2, chainKey: 'arbitrumSepolia', amount: '10', cycleIdx: 0 },
    ];

    const groups = groupActionsByChainKey(actions);
    assert.equal(groups.length, 2);

    // First group: 0xA on sepolia (2 actions)
    assert.equal(groups[0][0], 'sepolia:0xA');
    assert.equal(groups[0][1].length, 2);

    // Second group: 0xB on arbitrumSepolia (1 action)
    assert.equal(groups[1][0], 'arbitrumSepolia:0xB');
    assert.equal(groups[1][1].length, 1);
  });

  it('returns empty array for empty input', () => {
    const groups = groupActionsByChainKey([]);
    assert.equal(groups.length, 0);
  });

  it('separates different senders on the same chain', () => {
    const actions: SendAction[] = [
      { senderAddress: '0xA', receiverAddress: '0xB', srcChain: 1, chainKey: 'sepolia', amount: '10', cycleIdx: 0 },
      { senderAddress: '0xC', receiverAddress: '0xD', srcChain: 1, chainKey: 'sepolia', amount: '10', cycleIdx: 1 },
    ];

    const groups = groupActionsByChainKey(actions);
    assert.equal(groups.length, 2);
  });
});

describe('buildCycleHashlockMap', () => {
  it('maps cycleIdx to hashlock from fills', () => {
    const actions: SendAction[] = [
      { senderAddress: '0xA', receiverAddress: '0xB', srcChain: 1, chainKey: 'sepolia', amount: '10', cycleIdx: 0 },
      { senderAddress: '0xA', receiverAddress: '0xC', srcChain: 1, chainKey: 'sepolia', amount: '10', cycleIdx: 1 },
    ];
    const result = { fills: [{ hashlock: '0xhash0' }, { hashlock: '0xhash1' }] };

    const map = buildCycleHashlockMap(actions, result);
    assert.equal(map.get(0), '0xhash0');
    assert.equal(map.get(1), '0xhash1');
    assert.equal(map.size, 2);
  });
});

describe('buildCycleSecretMap', () => {
  it('maps cycleIdx to secret from fills', () => {
    const actions: SendAction[] = [
      { senderAddress: '0xA', receiverAddress: '0xB', srcChain: 1, chainKey: 'sepolia', amount: '10', cycleIdx: 0 },
    ];
    const result = { fills: [{ secret: '0xsecret0' }] };

    const map = buildCycleSecretMap(actions, result);
    assert.equal(map.get(0), '0xsecret0');
  });

  it('throws when secret is missing', () => {
    const actions: SendAction[] = [
      { senderAddress: '0xA', receiverAddress: '0xB', srcChain: 1, chainKey: 'sepolia', amount: '10', cycleIdx: 0 },
    ];
    const result = { fills: [{ secret: undefined }] };

    assert.throws(() => buildCycleSecretMap(actions, result), /No secret for presiding fill 0/);
  });
});
