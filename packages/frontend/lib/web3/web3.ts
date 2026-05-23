import { sepolia, arbitrumSepolia, baseSepolia, type Chain } from 'viem/chains';

// supported chains
export const SUPPORTED_CHAINS = {
  ETHEREUM: 'ethereum-sepolia',
  ARBITRUM: 'arbitrum-sepolia',
  BASE: 'base-sepolia',
} as const;

export type SupportedChain = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];

// chain config lookups
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

export function getChain(id: SupportedChain): Chain {
  const chain = CHAIN_MAP[id];
  if (!chain) throw new Error(`Unsupported chain: ${id}`);
  return chain;
}

export function getUsdcAddress(id: SupportedChain): `0x${string}` {
  const addr = USDC_ADDRESSES[id];
  if (!addr) throw new Error(`Missing NEXT_PUBLIC_USDC_ADDRESS_* env for chain: ${id}`);
  return addr;
}

export function getChainId(id: SupportedChain): number {
  return getChain(id).id;
}

// OceanLink HTLC contract addresses (from env — must match backend config)
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

export function getHtlcAddress(id: SupportedChain): `0x${string}` {
  const addr = HTLC_ADDRESSES[id];
  if (!addr) throw new Error(`Missing NEXT_PUBLIC_HTLC_ADDRESS_* env for chain: ${id}`);
  return addr;
}

// chain ID → SupportedChain reverse lookup
const CHAIN_ID_TO_SUPPORTED: Record<number, SupportedChain> = {
  [sepolia.id]: SUPPORTED_CHAINS.ETHEREUM,
  [arbitrumSepolia.id]: SUPPORTED_CHAINS.ARBITRUM,
  [baseSepolia.id]: SUPPORTED_CHAINS.BASE,
};

export function chainIdToSupported(chainId: number): SupportedChain | undefined {
  return CHAIN_ID_TO_SUPPORTED[chainId];
}
