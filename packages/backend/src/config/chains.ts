export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  usdcAddress: string;
  htlcAddress: string;
}

// Use getter function to read env vars at runtime (after dotenv loads)
export const getChainConfig = (chainKey: string): ChainConfig | undefined => {
  const configs: Record<string, ChainConfig> = {
    sepolia: {
      chainId: 11155111,
      name: 'Ethereum Sepolia',
      rpcUrl: process.env.SEPOLIA_RPC_URL || '',
      usdcAddress: process.env.USDC_ADDRESS_SEPOLIA || '0x7cBbD79f9d102363D104EA17FBB05F6e2E9109cF',
      htlcAddress: process.env.HTLC_ADDRESS_SEPOLIA || '0xedc85Fe98519109be0137Ca17bAA32F323c42796',
    },
    arbitrumSepolia: {
      chainId: 421614,
      name: 'Arbitrum Sepolia',
      rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || '',
      usdcAddress:
        process.env.USDC_ADDRESS_ARBITRUM_SEPOLIA || '0x7c07f2688F515ca98F734D2A000Ab5bC63b77516',
      htlcAddress:
        process.env.HTLC_ADDRESS_ARBITRUM_SEPOLIA || '0xbd9CCa55C35EEBa20984745dC3e9bAc60453BcfD',
    },
    baseSepolia: {
      chainId: 84532,
      name: 'Base Sepolia',
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || '',
      usdcAddress:
        process.env.USDC_ADDRESS_BASE_SEPOLIA || '0x4f3881a80DcaA7BfE969BFac4848E4B92eD87ec1',
      htlcAddress:
        process.env.HTLC_ADDRESS_BASE_SEPOLIA || '0x9db8d7C640251C51a145f6c51de64B884f3276Ee',
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
