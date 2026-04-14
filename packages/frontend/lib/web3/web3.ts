import { sepolia, arbitrumSepolia, baseSepolia, type Chain } from "viem/chains"

// ---------------------------------------------------------------------------
// Supported chains
// ---------------------------------------------------------------------------

export const SUPPORTED_CHAINS = {
  ETHEREUM: "ethereum-sepolia",
  ARBITRUM: "arbitrum-sepolia",
  BASE: "base-sepolia",
} as const

export type SupportedChain = (typeof SUPPORTED_CHAINS)[keyof typeof SUPPORTED_CHAINS]

// ---------------------------------------------------------------------------
// Chain config lookups
// ---------------------------------------------------------------------------

const CHAIN_MAP: Record<SupportedChain, Chain> = {
  [SUPPORTED_CHAINS.ETHEREUM]: sepolia,
  [SUPPORTED_CHAINS.ARBITRUM]: arbitrumSepolia,
  [SUPPORTED_CHAINS.BASE]: baseSepolia,
}

const USDC_ADDRESSES: Record<SupportedChain, `0x${string}`> = {
  [SUPPORTED_CHAINS.ETHEREUM]: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  [SUPPORTED_CHAINS.ARBITRUM]: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  [SUPPORTED_CHAINS.BASE]: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
}

export function getChain(id: SupportedChain): Chain {
  const chain = CHAIN_MAP[id]
  if (!chain) throw new Error(`Unsupported chain: ${id}`)
  return chain
}

export function getUsdcAddress(id: SupportedChain): `0x${string}` {
  const addr = USDC_ADDRESSES[id]
  if (!addr) throw new Error(`No USDC address for chain: ${id}`)
  return addr
}

export function getChainId(id: SupportedChain): number {
  return getChain(id).id
}
