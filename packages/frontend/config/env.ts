// Public env vars exposed to the browser (NEXT_PUBLIC_* prefix). Server-only
// secrets live in API routes and are read directly from process.env there.

export const env = {
  network: (process.env.NEXT_PUBLIC_NETWORK_MODE ?? 'testnet') as 'testnet' | 'mainnet',
  backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001',

  across: {
    apiKey: process.env.NEXT_PUBLIC_ACROSS_API_KEY ?? '',
    integratorId: process.env.NEXT_PUBLIC_ACROSS_INTEGRATOR_ID ?? '0x00d9',
  },

  rpc: {
    ethereum: process.env.NEXT_PUBLIC_ETHEREUM_RPC ?? '',
    arbitrum: process.env.NEXT_PUBLIC_ARBITRUM_RPC ?? '',
  },
} as const;
