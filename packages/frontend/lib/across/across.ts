import { createPublicClient, http, parseUnits } from 'viem';
import type { PublicClient, WalletClient } from 'viem';
import {
  getChain,
  getChainId,
  getUsdcAddress,
  SUPPORTED_CHAINS,
  type SupportedChain,
} from '@/config/chains';
import { USDC_DECIMALS } from '@/config/constants';
import { env } from '@/config/env';

// raw quote response from the Across swap/approval endpoint
export interface AcrossQuote {
  expectedOutputAmount?: string;
  swapTx?: { to: string; data: string; value?: string; gas?: string };
  approvalTxns?: Array<{ to: string; data: string }>;
}

interface LabeledQuote {
  quote: AcrossQuote;
  label: string;
}

// Across perps USDC token address (Hypercore destination)
const USDC_PERPS_TOKEN_ADDRESS = '0x2100000000000000000000000000000000000000';

// picks the quote with the highest expectedOutputAmount; quotes without swapTx are discarded
function bestQuote(quotes: LabeledQuote[]): AcrossQuote {
  const valid = quotes.filter(({ quote, label }) => {
    if (!quote.swapTx) {
      console.warn(`[across] ${label} quote has no swapTx, skipping`);
      return false;
    }
    return true;
  });

  if (valid.length === 0) {
    const summary = quotes
      .map(({ label, quote }) => `${label}=${JSON.stringify(quote)}`)
      .join(', ');
    throw new Error(`All quotes failed: ${summary}`);
  }

  return valid.reduce((best, current) => {
    const bestOutput = BigInt(best.quote.expectedOutputAmount ?? '0');
    const currentOutput = BigInt(current.quote.expectedOutputAmount ?? '0');
    return currentOutput > bestOutput ? current : best;
  }).quote;
}

async function fetchQuote(params: URLSearchParams, label: string): Promise<LabeledQuote> {
  try {
    const res = await fetch(`/api/across/quote?${params}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[across] ${label} quote request failed: ${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`
      );
      return { quote: {} as AcrossQuote, label };
    }
    return { quote: (await res.json()) as AcrossQuote, label };
  } catch (err) {
    console.warn(`[across] ${label} quote fetch error:`, err);
    return { quote: {} as AcrossQuote, label };
  }
}

// viem PublicClient for the origin chain — uses configured RPC, falls back to chain default
export function createOriginPublicClient(originChain: SupportedChain): PublicClient {
  const originChainConfig = getChain(originChain);
  const httpEndpoint =
    originChain === SUPPORTED_CHAINS.ETHEREUM ? env.rpc.ethereum : env.rpc.arbitrum;
  return createPublicClient({
    chain: originChainConfig,
    transport: http(httpEndpoint || undefined),
  }) as PublicClient;
}

// fetches the best Across quote — queries Spot-USDC and Perps-USDC in parallel and picks the higher output
export async function getQuote(
  inputAmount: string,
  chains: {
    originChain: SupportedChain;
    destinationChain: SupportedChain;
  },
  depositor: string,
  recipient: string
): Promise<AcrossQuote> {
  const { originChain, destinationChain } = chains;
  const originChainConfig = getChain(originChain);
  const originUsdcAddress = getUsdcAddress(originChain);
  const destinationUsdcAddress = getUsdcAddress(destinationChain);

  // Hypercore is not natively supported by viem — hardcode its chain ID
  const destinationChainId = getChainId(destinationChain);

  const amountValue = parseUnits(inputAmount, USDC_DECIMALS).toString();

  const baseParams: Record<string, string> = {
    tradeType: 'exactInput',
    originChainId: originChainConfig.id.toString(),
    destinationChainId: destinationChainId.toString(),
    inputToken: originUsdcAddress,
    amount: amountValue,
    depositor,
    recipient,
    integratorId: env.across.integratorId,
  };

  const usdcSpotParams = new URLSearchParams({
    ...baseParams,
    outputToken: destinationUsdcAddress,
  });

  const usdcPerpsParams = new URLSearchParams({
    ...baseParams,
    outputToken: USDC_PERPS_TOKEN_ADDRESS,
  });

  const quotes = await Promise.all([
    fetchQuote(usdcSpotParams, 'Spot'),
    fetchQuote(usdcPerpsParams, 'Perps'),
  ]);

  return bestQuote(quotes);
}

// sends any ERC-20 approvals required by the quote — no-ops when none are needed
export async function executeApproval(
  quote: AcrossQuote,
  walletClient: WalletClient,
  publicClient: PublicClient
): Promise<void> {
  if (!quote.approvalTxns?.length) return;

  const chain = walletClient.chain!;

  for (const approvalTx of quote.approvalTxns) {
    const hash = await walletClient.sendTransaction({
      to: approvalTx.to as `0x${string}`,
      data: approvalTx.data as `0x${string}`,
      chain,
      account: walletClient.account!,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status === 'reverted') {
      throw new Error(`Approval transaction reverted (hash: ${hash})`);
    }
  }
}

// executes the bridge swap tx from the quote, returns the tx hash
export async function executeQuote(
  quote: AcrossQuote,
  walletClient: WalletClient,
  publicClient: PublicClient
): Promise<`0x${string}`> {
  if (!quote.swapTx) {
    throw new Error('Quote has no swapTx — cannot execute');
  }

  const chain = walletClient.chain!;

  const hash = await walletClient.sendTransaction({
    to: quote.swapTx.to as `0x${string}`,
    data: quote.swapTx.data as `0x${string}`,
    value: quote.swapTx.value ? BigInt(quote.swapTx.value) : BigInt(0),
    gas: quote.swapTx.gas ? BigInt(quote.swapTx.gas) : undefined,
    chain,
    account: walletClient.account!,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status === 'reverted') {
    throw new Error(`Bridge transaction reverted (hash: ${hash})`);
  }

  return hash;
}
