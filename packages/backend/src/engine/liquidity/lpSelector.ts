import type { IntentOrder } from '../matching/types.js';
import { POWER_OF_TWO_AMOUNTS } from './liquidityService.js';

/**
 * For each user order, pick LP counter-orders whose amounts are the binary
 * decomposition of the user's amount (largest bit first). Reserves picked
 * LP orders so two user orders in the same tick cannot claim the same slot.
 *
 * Only QUEUED LP orders with exact power-of-2 amounts are considered — a
 * PARTIAL LP order has a non-power-of-2 remainder that wouldn't fit any bit.
 */
export function selectLpOrdersForUsers(
  userOrders: IntentOrder[],
  allActive: IntentOrder[],
  lpAddresses: Set<string>
): IntentOrder[] {
  // route key = `${src}-${des}` → amount → QUEUED LP orders
  const lpByRouteAmount = new Map<string, Map<number, IntentOrder[]>>();
  for (const o of allActive) {
    if (!lpAddresses.has(o.userAddress)) continue;
    if (o.status !== 'QUEUED') continue;
    const route = `${o.srcChain}-${o.desChain}`;
    const amount = Number(o.amount);
    let byAmount = lpByRouteAmount.get(route);
    if (!byAmount) {
      byAmount = new Map();
      lpByRouteAmount.set(route, byAmount);
    }
    let pool = byAmount.get(amount);
    if (!pool) {
      pool = [];
      byAmount.set(amount, pool);
    }
    pool.push(o);
  }

  const selected: IntentOrder[] = [];
  const reserved = new Set<string>();

  for (const user of userOrders) {
    const reverseRoute = `${user.desChain}-${user.srcChain}`;
    const byAmount = lpByRouteAmount.get(reverseRoute);
    if (!byAmount) continue;

    const amount = Number(user.amount);
    for (let i = POWER_OF_TWO_AMOUNTS.length - 1; i >= 0; i--) {
      const pow = POWER_OF_TWO_AMOUNTS[i];
      if ((amount & pow) === 0) continue;

      const pool = byAmount.get(pow);
      const pick = pool?.find((o) => !reserved.has(o.orderId));
      if (pick) {
        reserved.add(pick.orderId);
        selected.push(pick);
      }
    }
  }

  return selected;
}
