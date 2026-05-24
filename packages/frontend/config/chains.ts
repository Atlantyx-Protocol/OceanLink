import { sepolia, arbitrumSepolia, baseSepolia, type Chain } from 'viem/chains';

export const SUPPORTED_CHAINS = {
  ETHEREUM: 'ethereum-sepolia',
  ARBITRUM: 'arbitrum-sepolia',
  BASE: 'base-sepolia',
} as const;

export type SupportedChain = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];

const CHAIN_MAP: Record<SupportedChain, Chain> = {
  [SUPPORTED_CHAINS.ETHEREUM]: sepolia,
  [SUPPORTED_CHAINS.ARBITRUM]: arbitrumSepolia,
  [SUPPORTED_CHAINS.BASE]: baseSepolia,
};

const USDC_ADDRESSES: Record<SupportedChain, `0x${string}` | undefined> = {
  [SUPPORTED_CHAINS.ETHEREUM]: process.env.NEXT_PUBLIC_USDC_ADDRESS_SEPOLIA as
    | `0x${string}`
    | undefined,
  [SUPPORTED_CHAINS.ARBITRUM]: process.env.NEXT_PUBLIC_USDC_ADDRESS_ARBITRUM_SEPOLIA as
    | `0x${string}`
    | undefined,
  [SUPPORTED_CHAINS.BASE]: process.env.NEXT_PUBLIC_USDC_ADDRESS_BASE_SEPOLIA as
    | `0x${string}`
    | undefined,
};

// addresses must match backend chain config — verify via GET /api/usdc/chains
// if values diverge.
const HTLC_ADDRESSES: Record<SupportedChain, `0x${string}` | undefined> = {
  [SUPPORTED_CHAINS.ETHEREUM]: process.env.NEXT_PUBLIC_HTLC_ADDRESS_SEPOLIA as
    | `0x${string}`
    | undefined,
  [SUPPORTED_CHAINS.ARBITRUM]: process.env.NEXT_PUBLIC_HTLC_ADDRESS_ARBITRUM_SEPOLIA as
    | `0x${string}`
    | undefined,
  [SUPPORTED_CHAINS.BASE]: process.env.NEXT_PUBLIC_HTLC_ADDRESS_BASE_SEPOLIA as
    | `0x${string}`
    | undefined,
};

const CHAIN_ID_TO_SUPPORTED: Record<number, SupportedChain> = {
  [sepolia.id]: SUPPORTED_CHAINS.ETHEREUM,
  [arbitrumSepolia.id]: SUPPORTED_CHAINS.ARBITRUM,
  [baseSepolia.id]: SUPPORTED_CHAINS.BASE,
};

export function getChain(id: SupportedChain): Chain {
  const chain = CHAIN_MAP[id];
  if (!chain) throw new Error(`Unsupported chain: ${id}`);
  return chain;
}

export function getChainId(id: SupportedChain): number {
  return getChain(id).id;
}

export function getUsdcAddress(id: SupportedChain): `0x${string}` {
  const addr = USDC_ADDRESSES[id];
  if (!addr) throw new Error(`Missing NEXT_PUBLIC_USDC_ADDRESS_* env for chain: ${id}`);
  return addr;
}

export function getHtlcAddress(id: SupportedChain): `0x${string}` {
  const addr = HTLC_ADDRESSES[id];
  if (!addr) throw new Error(`Missing NEXT_PUBLIC_HTLC_ADDRESS_* env for chain: ${id}`);
  return addr;
}

export function chainIdToSupported(chainId: number): SupportedChain | undefined {
  return CHAIN_ID_TO_SUPPORTED[chainId];
}
