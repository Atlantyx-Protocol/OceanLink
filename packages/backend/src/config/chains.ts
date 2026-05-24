import { loadEnv } from './env.js';

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  usdcAddress: string;
  htlcAddress: string;
}

// USDC + HTLC addresses are read from NEXT_PUBLIC_* env vars so they're shared
// with the frontend bundle (single source of truth). RPC URLs stay backend-only.
// getter so env vars are read at runtime, after dotenv loads.
export const getChainConfig = (chainKey: string): ChainConfig | undefined => {
  const env = loadEnv().chains;
  const configs: Record<string, ChainConfig> = {
    sepolia: {
      chainId: 11155111,
      name: 'Ethereum Sepolia',
      ...env.sepolia,
    },
    arbitrumSepolia: {
      chainId: 421614,
      name: 'Arbitrum Sepolia',
      ...env.arbitrumSepolia,
    },
    baseSepolia: {
      chainId: 84532,
      name: 'Base Sepolia',
      ...env.baseSepolia,
    },
  };
  return configs[chainKey];
};

export const getAllChainConfigs = (): Record<string, ChainConfig> => {
  return {
    sepolia: getChainConfig('sepolia')!,
    arbitrumSepolia: getChainConfig('arbitrumSepolia')!,
    baseSepolia: getChainConfig('baseSepolia')!,
  };
};

export const getAllChains = (): ChainConfig[] => Object.values(getAllChainConfigs());

export const CHAIN_KEYS = ['sepolia', 'arbitrumSepolia', 'baseSepolia'] as const;
