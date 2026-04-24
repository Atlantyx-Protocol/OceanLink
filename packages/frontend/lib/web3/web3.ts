import { sepolia, arbitrumSepolia, baseSepolia, type Chain } from 'viem/chains';

// ---------------------------------------------------------------------------
// Supported chains
// ---------------------------------------------------------------------------

export const SUPPORTED_CHAINS = {
  ETHEREUM: 'ethereum-sepolia',
  ARBITRUM: 'arbitrum-sepolia',
  BASE: 'base-sepolia',
} as const;

export type SupportedChain = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS];

// ---------------------------------------------------------------------------
// Chain config lookups
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// OceanLink HTLC contract addresses
// ---------------------------------------------------------------------------

const HTLC_ADDRESSES: Record<SupportedChain, `0x${string}`> = {
  [SUPPORTED_CHAINS.ETHEREUM]: '0xedc85Fe98519109be0137Ca17bAA32F323c42796',
  [SUPPORTED_CHAINS.ARBITRUM]: '0xbd9CCa55C35EEBa20984745dC3e9bAc60453BcfD',
  [SUPPORTED_CHAINS.BASE]: '0x9db8d7C640251C51a145f6c51de64B884f3276Ee',
};

export function getHtlcAddress(id: SupportedChain): `0x${string}` {
  const addr = HTLC_ADDRESSES[id];
  if (!addr) throw new Error(`No HTLC address for chain: ${id}`);
  return addr;
}

// ---------------------------------------------------------------------------
// Network ID → SupportedChain reverse lookup
// ---------------------------------------------------------------------------

const CHAIN_ID_TO_SUPPORTED: Record<number, SupportedChain> = {
  [sepolia.id]: SUPPORTED_CHAINS.ETHEREUM,
  [arbitrumSepolia.id]: SUPPORTED_CHAINS.ARBITRUM,
  [baseSepolia.id]: SUPPORTED_CHAINS.BASE,
};

export function chainIdToSupported(chainId: number): SupportedChain | undefined {
  return CHAIN_ID_TO_SUPPORTED[chainId];
}
