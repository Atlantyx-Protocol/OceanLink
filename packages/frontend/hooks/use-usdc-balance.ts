'use client';

import { useMemo } from 'react';
import { useReadContract } from 'wagmi';
import { erc20Abi, formatUnits } from 'viem';
import { getChainId, getUsdcAddress, type SupportedChain } from '@/config/chains';
import { USDC_DECIMALS } from '@/config/constants';
import { formatUsdcNumber } from '@/lib/format';
import type { wagmiConfig } from '@/lib/wagmi';

type ConfiguredChainId = (typeof wagmiConfig)['chains'][number]['id'];

const REFETCH_INTERVAL_MS = 5_000;

interface Options {
  enabled?: boolean;
}

export interface UsdcBalance {
  raw: bigint | undefined;
  value: number | undefined;
  formatted: string | undefined;
  refetch: () => Promise<unknown>;
}

export function useUsdcBalance(
  chain: SupportedChain,
  address: `0x${string}` | undefined,
  { enabled = true }: Options = {}
): UsdcBalance {
  const chainId = getChainId(chain) as ConfiguredChainId;
  const usdcAddress = getUsdcAddress(chain);

  const { data: raw, refetch } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId,
    query: {
      enabled: enabled && !!address,
      refetchInterval: REFETCH_INTERVAL_MS,
    },
  });

  return useMemo<UsdcBalance>(() => {
    if (raw === undefined) {
      return { raw: undefined, value: undefined, formatted: undefined, refetch };
    }
    const value = parseFloat(formatUnits(raw, USDC_DECIMALS));
    return { raw, value, formatted: formatUsdcNumber(value), refetch };
  }, [raw, refetch]);
}
