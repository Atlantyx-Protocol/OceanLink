/**
 * One-shot pre-approval for liquidity providers.
 *
 * Each LP signs an approve(MaxUint256) against the HTLC contract on its OWN
 * source chain — only the source chain, because that's the only chain from
 * which its tokens will ever be pulled.
 *
 * Keys are read from PRIVATE_KEY_B / PRIVATE_KEY_C / PRIVATE_KEY_D.
 * Run from packages/backend via: `pnpm approve-lps`.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });

import { approvalService } from '../src/engine/execution/approval.js';
import { getAllChainConfigs } from '../src/config/chains.js';

const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const ARBITRUM_SEPOLIA = 421614;

// Must match the definitions in loadLPConfigsFromEnv.
const LP_DEFS = [
  { name: 'B', envKey: 'PRIVATE_KEY_B', srcChainId: SEPOLIA },
  { name: 'C', envKey: 'PRIVATE_KEY_C', srcChainId: BASE_SEPOLIA },
  { name: 'D', envKey: 'PRIVATE_KEY_D', srcChainId: ARBITRUM_SEPOLIA },
];

// Treat any allowance above this as "already at max" and skip.
const ALREADY_APPROVED_THRESHOLD = 2n ** 200n;

async function main(): Promise<void> {
  const chainIdToKey = new Map<number, string>();
  for (const [key, cfg] of Object.entries(getAllChainConfigs())) {
    chainIdToKey.set(cfg.chainId, key);
  }

  let approved = 0;
  let skipped = 0;
  let failed = 0;

  for (const lp of LP_DEFS) {
    const pk = process.env[lp.envKey];
    if (!pk) {
      console.error(`[${lp.name}] missing env ${lp.envKey} — skipping`);
      failed++;
      continue;
    }

    const chainKey = chainIdToKey.get(lp.srcChainId);
    if (!chainKey) {
      console.error(`[${lp.name}] no chain config for chainId=${lp.srcChainId}`);
      failed++;
      continue;
    }

    const address = approvalService.addressFromKey(pk);
    const tag = `[${lp.name}@${chainKey} ${address}]`;

    try {
      const { allowance, htlcAddress } = await approvalService.getAllowance(chainKey, address);
      if (BigInt(allowance) >= ALREADY_APPROVED_THRESHOLD) {
        console.log(`${tag} already approved (allowance=${allowance}) — skipped`);
        skipped++;
        continue;
      }

      console.log(`${tag} approving MaxUint256 → htlc=${htlcAddress} ...`);
      const { txHash } = await approvalService.approve(chainKey, pk);
      console.log(`${tag} approved — tx=${txHash}`);
      approved++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} FAILED: ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone. approved=${approved} skipped=${skipped} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
