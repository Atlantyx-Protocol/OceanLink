import {
  createPublicClient,
  http,
  parseUnits,
  erc20Abi,
  type Chain,
  type PublicClient,
} from 'viem';
import type { UseWalletClientReturnType } from 'wagmi';
import { getChain, getUsdcAddress, getHtlcAddress, type SupportedChain } from '@/config/chains';
import { USDC_DECIMALS } from '@/config/constants';

export type ConnectedWalletClient = NonNullable<UseWalletClientReturnType['data']>;

// L2 testnet base fees can move between the wallet's gas estimate and the
// actual submit; pad the cap so the tx isn't rejected for being just below.
const GAS_BUFFER_MULTIPLIER = BigInt(2);

const INTENT_SUBMIT_TIMEOUT_MS = 30_000;

/** Everything derived from the source chain + amount, shared across steps. */
export interface SrcContext {
  chain: Chain;
  publicClient: PublicClient;
  usdcAddress: `0x${string}`;
  htlcAddress: `0x${string}`;
  amountWei: bigint;
}

/** Resolve chain config and a read-only client for the source chain. */
export function createSrcContext(srcChain: SupportedChain, amount: string): SrcContext {
  const chain = getChain(srcChain);
  return {
    chain,
    publicClient: createPublicClient({ chain, transport: http() }) as PublicClient,
    usdcAddress: getUsdcAddress(srcChain),
    htlcAddress: getHtlcAddress(srcChain),
    amountWei: parseUnits(amount, USDC_DECIMALS),
  };
}

/** Current USDC allowance the user has granted to the HTLC contract. */
export function checkAllowance(ctx: SrcContext, userAddress: `0x${string}`): Promise<bigint> {
  return ctx.publicClient.readContract({
    address: ctx.usdcAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [userAddress, ctx.htlcAddress],
  });
}

/** Submit the USDC approve tx (gas-padded) and return its hash. Does not wait. */
export function sendApproval(
  ctx: SrcContext,
  wc: ConnectedWalletClient,
  userAddress: `0x${string}`
): Promise<`0x${string}`> {
  return ctx.publicClient.estimateFeesPerGas().then((fees) =>
    wc.writeContract({
      address: ctx.usdcAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [ctx.htlcAddress, ctx.amountWei],
      chain: ctx.chain,
      account: userAddress,
      maxFeePerGas: fees.maxFeePerGas ? fees.maxFeePerGas * GAS_BUFFER_MULTIPLIER : undefined,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas
        ? fees.maxPriorityFeePerGas * GAS_BUFFER_MULTIPLIER
        : undefined,
    })
  );
}

/** Wait for the approval receipt; throw if the tx reverted on-chain. */
export async function waitForApproval(
  publicClient: PublicClient,
  txHash: `0x${string}`
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status === 'reverted') {
    throw new Error('USDC approval transaction reverted');
  }
}

export interface IntentBody {
  srcChain: number;
  desChain: number;
  amount: string;
  deadline: number;
  userAddress: string;
  incentiveFee?: string;
}

/** POST the intent to the BFF proxy and return the created orderId (or null). */
export async function submitIntent(body: IntentBody): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INTENT_SUBMIT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('/api/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Intent submission timed out — please try again');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json().catch(() => ({ error: 'Invalid response' }));
  if (!res.ok) {
    throw new Error(data.error || `Intent submission failed (${res.status})`);
  }

  return data.order?.orderId ?? null;
}
