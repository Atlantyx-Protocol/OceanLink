// centralized env loader for the backend package. mirrors the frontend
// loadConfig() pattern: all process.env reads live here so call sites
// pull from a single typed shape instead of sprinkling defaults around.
//
// reads are evaluated on each loadEnv() call so dotenv.config() in
// index.ts (and test-time mutations of process.env) take effect.

import {
  DEFAULT_TIMELOCK_MINUTES,
  DEFAULT_MATCH_INTERVAL_MS,
  DEFAULT_LP_REFILL_INTERVAL_MS,
  DEFAULT_MATCH_THRESHOLD,
} from './constants.js';

export interface ChainEnv {
  rpcUrl: string;
  usdcAddress: string;
  htlcAddress: string;
}

export interface BackendEnv {
  app: {
    port: number;
    host: string;
    logLevel: string;
    frontendUrl: string;
  };
  database: {
    url: string | undefined;
  };
  engine: {
    timelockMinutes: number;
    matchIntervalMs: number;
    matchThreshold: number;
    lpRefillIntervalMs: number;
    testingMode: boolean;
  };
  privateKeys: {
    admin: string | undefined;
    lpB: string | undefined;
    lpC: string | undefined;
    lpD: string | undefined;
  };
  chains: {
    sepolia: ChainEnv;
    arbitrumSepolia: ChainEnv;
    baseSepolia: ChainEnv;
  };
}

function parseBool(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

export function loadEnv(): BackendEnv {
  return {
    app: {
      port: parseInt(process.env.PORT || '3001', 10),
      host: process.env.HOST || '0.0.0.0',
      logLevel: process.env.LOG_LEVEL || 'info',
      frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    },
    database: {
      url: process.env.DATABASE_URL,
    },
    engine: {
      timelockMinutes: parseInt(
        process.env.TIME_LOCK ?? String(DEFAULT_TIMELOCK_MINUTES),
        10
      ),
      matchIntervalMs: parseInt(
        process.env.MATCH_INTERVAL_MS ?? String(DEFAULT_MATCH_INTERVAL_MS),
        10
      ),
      matchThreshold: parseFloat(
        process.env.MATCH_THRESHOLD ?? String(DEFAULT_MATCH_THRESHOLD)
      ),
      lpRefillIntervalMs: parseInt(
        process.env.LP_REFILL_INTERVAL_MS ?? String(DEFAULT_LP_REFILL_INTERVAL_MS),
        10
      ),
      testingMode: parseBool(process.env.OCEAN_LINK_TESTING),
    },
    privateKeys: {
      admin: process.env.PRIVATE_KEY_ADMIN,
      lpB: process.env.PRIVATE_KEY_B,
      lpC: process.env.PRIVATE_KEY_C,
      lpD: process.env.PRIVATE_KEY_D,
    },
    chains: {
      sepolia: {
        rpcUrl: process.env.SEPOLIA_RPC_URL || '',
        usdcAddress:
          process.env.NEXT_PUBLIC_USDC_ADDRESS_SEPOLIA ||
          '0x7cBbD79f9d102363D104EA17FBB05F6e2E9109cF',
        htlcAddress:
          process.env.NEXT_PUBLIC_HTLC_ADDRESS_SEPOLIA ||
          '0x48DEc0Aa2dfbDDd696Eaf2fcE0440EA2928e5Fd5',
      },
      arbitrumSepolia: {
        rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || '',
        usdcAddress:
          process.env.NEXT_PUBLIC_USDC_ADDRESS_ARBITRUM_SEPOLIA ||
          '0x7c07f2688F515ca98F734D2A000Ab5bC63b77516',
        htlcAddress:
          process.env.NEXT_PUBLIC_HTLC_ADDRESS_ARBITRUM_SEPOLIA ||
          '0x15c5CC562B7F95BCb2b90fD59f630CaECE083E56',
      },
      baseSepolia: {
        rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || '',
        usdcAddress:
          process.env.NEXT_PUBLIC_USDC_ADDRESS_BASE_SEPOLIA ||
          '0x4f3881a80DcaA7BfE969BFac4848E4B92eD87ec1',
        htlcAddress:
          process.env.NEXT_PUBLIC_HTLC_ADDRESS_BASE_SEPOLIA ||
          '0xef9aB713BD8355DE9A42b7c4792cAe3ce2fA637e',
      },
    },
  };
}
