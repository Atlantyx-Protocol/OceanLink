export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  usdcAddress: string;
  htlcAddress: string;
}

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  sepolia: {
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    rpcUrl: process.env.SEPOLIA_RPC_URL || '',
    usdcAddress: process.env.USDC_ADDRESS_SEPOLIA || '0x7cBbD79f9d102363D104EA17FBB05F6e2E9109cF',
    htlcAddress: process.env.HTLC_ADDRESS_SEPOLIA || '0x32337e2394B8C69Ad23e70A8Bd5D4d6858F64703',
  },
  arbitrumSepolia: {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || '',
    usdcAddress: process.env.USDC_ADDRESS_ARBITRUM_SEPOLIA || '0x7c07f2688F515ca98F734D2A000Ab5bC63b77516',
    htlcAddress: process.env.HTLC_ADDRESS_ARBITRUM_SEPOLIA || '0x8aA86c2EED53595f1B46645c0919837ee858145A',
  },
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || '',
    usdcAddress: process.env.USDC_ADDRESS_BASE_SEPOLIA || '0x4f3881a80DcaA7BfE969BFac4848E4B92eD87ec1',
    htlcAddress: process.env.HTLC_ADDRESS_BASE_SEPOLIA || '0x39B3449104D62fF81B3963a7654af4C465D6BA58',
  },
};

export const getAllChains = (): ChainConfig[] => Object.values(CHAIN_CONFIGS);
