import { randomUUID } from 'node:crypto';
import type { IntentOrder, CreateIntentInput } from '../types.js';

// pure validator: returns { order } or { error }. no side effects.
export function validateAndCreateOrder(
  input: CreateIntentInput
): { order: IntentOrder } | { error: string } {
  const srcChain = Number(input.srcChain);
  const desChain = Number(input.desChain);
  const amount = String(input.amount);
  const deadline = Number(input.deadline);

  if (!Number.isInteger(srcChain) || srcChain <= 0) {
    return { error: 'srcChain must be a positive integer' };
  }
  if (!Number.isInteger(desChain) || desChain <= 0) {
    return { error: 'desChain must be a positive integer' };
  }
  const parsedAmount = Number(amount);
  if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
    return { error: 'amount must be a positive number' };
  }

  // validate and compute incentive fee
  let incentiveFee: string | undefined;
  if (input.incentiveFee !== undefined && input.incentiveFee !== null) {
    const parsedFee = Number(input.incentiveFee);
    if (Number.isNaN(parsedFee) || parsedFee < 0) {
      return { error: 'incentiveFee must be a non-negative number' };
    }
    if (parsedFee > 0) {
      incentiveFee = String(parsedFee);
    }
  }

  // effective amount = base amount + incentive fee
  const effectiveAmount = incentiveFee ? String(parsedAmount + Number(incentiveFee)) : amount;

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(deadline) || deadline < now) {
    return { error: 'deadline must be a Unix epoch timestamp (seconds) >= now' };
  }

  if (!input.userAddress) {
    return { error: 'userAddress is required' };
  }

  const order: IntentOrder = {
    orderId: randomUUID(),
    srcChain,
    desChain,
    amount: effectiveAmount,
    ...(incentiveFee !== undefined && { incentiveFee }),
    deadline,
    createdAt: now,
    status: 'QUEUED',
    userAddress: input.userAddress,
  };

  return { order };
}
