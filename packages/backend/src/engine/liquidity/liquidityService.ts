import { Wallet } from 'ethers';
import type { MatchingService } from '../matching/service/matchingService.js';
import type { OrderStore } from '../matching/store/orderStore.js';
import type { IntentOrder, MatchResult, TickStats } from '../matching/types.js';
import { orchestrator } from '../orchestrator/orchestrator.js';
import { approvalService } from '../execution/approval.js';
import { getAllChainConfigs, getChainConfig } from '../../config/chains.js';
import {
  LP_DEADLINE_SECONDS,
  getMatchIntervalMs,
  getLpRefillIntervalMs,
} from '../../config/constants.js';
import { loadEnv } from '../../config/env.js';
import { selectLpOrdersForUsers } from './lpSelector.js';

// liquidity market service — seeds power-of-2 LP orders per route and
// refills them after matches/expiries. tick() filters LP orders to prevent
// LP<->LP self-matching.
//
// LP assignments (from env private keys):
//   B → Ethereum Sepolia   (orders TO Base & Arbitrum Sepolia)
//   C → Base Sepolia       (orders TO Ethereum & Arbitrum Sepolia)
//   D → Arbitrum Sepolia   (orders TO Ethereum & Base Sepolia)

// chain IDs derived from chain config
const SEPOLIA = getChainConfig('sepolia')!.chainId;
const BASE_SEPOLIA = getChainConfig('baseSepolia')!.chainId;
const ARBITRUM_SEPOLIA = getChainConfig('arbitrumSepolia')!.chainId;

// powers of 2 from 2^0 to 2^13 (all <= 10 000)
// sum = 16 383, so any integer amount in [1, 10 000] can be covered
export const POWER_OF_TWO_AMOUNTS = Array.from({ length: 14 }, (_, i) => 2 ** i);

export interface LPConfig {
  name: string;
  address: string;
  srcChainId: number;
  desChainIds: number[];
}

// build LP configs from env private keys; throws if any key is missing
export function loadLPConfigsFromEnv(): LPConfig[] {
  const keys = loadEnv().privateKeys;
  const defs = [
    { name: 'B', pk: keys.lpB, envKey: 'PRIVATE_KEY_B', src: SEPOLIA, des: [BASE_SEPOLIA, ARBITRUM_SEPOLIA] },
    { name: 'C', pk: keys.lpC, envKey: 'PRIVATE_KEY_C', src: BASE_SEPOLIA, des: [SEPOLIA, ARBITRUM_SEPOLIA] },
    { name: 'D', pk: keys.lpD, envKey: 'PRIVATE_KEY_D', src: ARBITRUM_SEPOLIA, des: [SEPOLIA, BASE_SEPOLIA] },
  ];

  return defs.map(({ name, pk, envKey, src, des }) => {
    if (!pk) throw new Error(`Missing env variable: ${envKey}`);
    return { name, address: new Wallet(pk).address, srcChainId: src, desChainIds: des };
  });
}

export class LiquidityService {
  private readonly activeOrders = new Map<string, string>(); // key -> orderId
  private readonly lpAddresses: Set<string>;
  private matchTimer: ReturnType<typeof setInterval> | null = null;
  private refillTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly service: MatchingService,
    private readonly store: OrderStore,
    private readonly lpConfigs: LPConfig[],
    private readonly refillIntervalMs: number = getLpRefillIntervalMs()
  ) {
    this.lpAddresses = new Set(lpConfigs.map((lp) => lp.address));
  }

  private orderKey(address: string, src: number, des: number, amount: number): string {
    return `${address}-${src}-${des}-${amount}`;
  }

  private futureDeadline(): number {
    return Math.floor(Date.now() / 1000) + LP_DEADLINE_SECONDS;
  }

  // seed the full set of liquidity orders for every LP + route + amount
  seed(): { created: number; skipped: number } {
    let created = 0;
    let skipped = 0;

    for (const lp of this.lpConfigs) {
      for (const des of lp.desChainIds) {
        for (const amount of POWER_OF_TWO_AMOUNTS) {
          if (this.createIfMissing(lp.address, lp.srcChainId, des, amount)) {
            created++;
          } else {
            skipped++;
          }
        }
      }
    }
    return { created, skipped };
  }

  // recreate any consumed or expired slots
  refill(): number {
    let refilled = 0;
    for (const lp of this.lpConfigs) {
      for (const des of lp.desChainIds) {
        for (const amount of POWER_OF_TWO_AMOUNTS) {
          if (this.createIfMissing(lp.address, lp.srcChainId, des, amount)) {
            refilled++;
          }
        }
      }
    }
    if (refilled > 0) {
      console.log(`[LiquidityService] Refilled ${refilled} LP orders`);
    }
    return refilled;
  }

  // matching tick that only pairs user orders against LP counter-orders.
  // LP orders are picked via binary decomposition of each user amount
  // (A=10 -> 8+2) to minimize cycles. use this instead of runTick() when
  // liquidity is active.
  tick(): TickStats {
    const expired = this.store.expireStale();
    const allActive = this.store.getActiveOrders();
    const queuedBefore = allActive.length;

    // separate user orders from LP orders
    const userOrders = allActive.filter((o) => !this.lpAddresses.has(o.userAddress));

    let matchResults: MatchResult[] = [];

    if (userOrders.length > 0) {
      const selectedLpOrders = selectLpOrdersForUsers(userOrders, allActive, this.lpAddresses);
      matchResults = this.service.runMatchingPass([...userOrders, ...selectedLpOrders]);
    }

    // refill any LP orders that were consumed
    this.refill();

    const queuedAfter = this.store.getActiveOrders().length;
    const matchedOrders = matchResults.flatMap((r) =>
      r.orders.filter((o) => o.status === 'MATCHED')
    ).length;
    const partialOrders = matchResults.flatMap((r) =>
      r.orders.filter((o) => o.status === 'PARTIAL')
    ).length;

    return { queuedBefore, expired, matchResults, matchedOrders, partialOrders, queuedAfter };
  }

  // verify every LP has a near-max USDC allowance for the HTLC contract on
  // its source chain. throws listing all missing pairs — approvals must be
  // pre-arranged since admin cannot approve on the LP's behalf.
  async verifyApprovals(): Promise<void> {
    const chainIdToKey = new Map<number, string>();
    for (const [key, cfg] of Object.entries(getAllChainConfigs())) {
      chainIdToKey.set(cfg.chainId, key);
    }

    // 2^200 sits well below MaxUint256 but above any plausible total pull,
    // so anything >= MIN_ALLOWANCE counts as "approved max"
    const MIN_ALLOWANCE = 2n ** 200n;
    const missing: string[] = [];

    for (const lp of this.lpConfigs) {
      const chainKey = chainIdToKey.get(lp.srcChainId);
      if (!chainKey) {
        missing.push(`${lp.name}: unknown chainId=${lp.srcChainId}`);
        continue;
      }
      try {
        const { allowance } = await approvalService.getAllowance(chainKey, lp.address);
        if (BigInt(allowance) < MIN_ALLOWANCE) {
          missing.push(`${lp.name}@${chainKey} (allowance=${allowance})`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        missing.push(`${lp.name}@${chainKey} (allowance check failed: ${msg})`);
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `[LiquidityService] Pre-approval missing for: ${missing.join('; ')}. ` +
          `Run approve-max for each LP on its source chain before starting the service.`
      );
    }

    console.log(`[LiquidityService] Verified approvals for ${this.lpConfigs.length} LP(s)`);
  }

  // verify approvals, seed all orders, then start the matching + refill loops
  async start(): Promise<void> {
    await this.verifyApprovals();

    const { created } = this.seed();
    console.log(`[LiquidityService] Seeded ${created} LP orders`);

    const matchIntervalMs = getMatchIntervalMs();

    if (this.matchTimer === null) {
      this.matchTimer = setInterval(() => {
        const stats = this.tick();
        if (stats.matchResults.length > 0) {
          const summary = stats.matchResults
            .flatMap((r) => r.orders)
            .map(
              (o) =>
                `  ${o.orderId.slice(0, 8)}… [${o.status}] matched=${o.matchedAmount} remaining=${o.remainingAmount}`
            )
            .join('\n');
          console.log(
            `[LiquidityService] Tick — matched: ${stats.matchedOrders}, partial: ${stats.partialOrders}\n${summary}`
          );

          void orchestrator.handleMatchResults(stats.matchResults);
        }
      }, matchIntervalMs);
    }

    // separate refill loop for expired orders, runs independently of matching
    if (this.refillTimer === null) {
      this.refillTimer = setInterval(() => this.refill(), this.refillIntervalMs);
    }

    console.log(
      `[LiquidityService] Started — match=${matchIntervalMs}ms, refill=${this.refillIntervalMs}ms`
    );
  }

  stop(): void {
    if (this.matchTimer !== null) {
      clearInterval(this.matchTimer);
      this.matchTimer = null;
    }
    if (this.refillTimer !== null) {
      clearInterval(this.refillTimer);
      this.refillTimer = null;
    }
    console.log('[LiquidityService] Stopped');
  }

  isLPAddress(address: string): boolean {
    return this.lpAddresses.has(address);
  }

  // creates an LP order if the slot isn't currently covered; returns true on create
  private createIfMissing(address: string, src: number, des: number, amount: number): boolean {
    const key = this.orderKey(address, src, des, amount);
    const existingId = this.activeOrders.get(key);

    if (existingId) {
      const existing = this.store.get(existingId);
      // only skip if the order is still QUEUED at its original amount.
      // PARTIAL orders no longer cover the slot, so recreate at full amount.
      if (existing && existing.status === 'QUEUED') {
        return false;
      }
    }

    const result = this.service.createOrder({
      srcChain: src,
      desChain: des,
      amount: String(amount),
      deadline: this.futureDeadline(),
      userAddress: address,
    });

    if ('order' in result) {
      this.activeOrders.set(key, result.order.orderId);
      return true;
    }

    console.error(
      `[LiquidityService] Order creation failed: ${(result as { error: string }).error}`
    );
    return false;
  }

  get trackedCount(): number {
    return this.activeOrders.size;
  }
}
