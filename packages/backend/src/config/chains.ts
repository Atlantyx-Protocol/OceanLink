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
  const configs: Record<string, ChainConfig> = {
    sepolia: {
      chainId: 11155111,
      name: 'Ethereum Sepolia',
      rpcUrl: process.env.SEPOLIA_RPC_URL || '',
      usdcAddress:
        process.env.NEXT_PUBLIC_USDC_ADDRESS_SEPOLIA ||
        '0x7cBbD79f9d102363D104EA17FBB05F6e2E9109cF',
      htlcAddress:
        process.env.NEXT_PUBLIC_HTLC_ADDRESS_SEPOLIA ||
        '0x48DEc0Aa2dfbDDd696Eaf2fcE0440EA2928e5Fd5',
    },
    arbitrumSepolia: {
      chainId: 421614,
      name: 'Arbitrum Sepolia',
      rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || '',
      usdcAddress:
        process.env.NEXT_PUBLIC_USDC_ADDRESS_ARBITRUM_SEPOLIA ||
        '0x7c07f2688F515ca98F734D2A000Ab5bC63b77516',
      htlcAddress:
        process.env.NEXT_PUBLIC_HTLC_ADDRESS_ARBITRUM_SEPOLIA ||
        '0x15c5CC562B7F95BCb2b90fD59f630CaECE083E56',
    },
    baseSepolia: {
      chainId: 84532,
      name: 'Base Sepolia',
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || '',
      usdcAddress:
        process.env.NEXT_PUBLIC_USDC_ADDRESS_BASE_SEPOLIA ||
        '0x4f3881a80DcaA7BfE969BFac4848E4B92eD87ec1',
      htlcAddress:
        process.env.NEXT_PUBLIC_HTLC_ADDRESS_BASE_SEPOLIA ||
        '0xef9aB713BD8355DE9A42b7c4792cAe3ce2fA637e',
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
