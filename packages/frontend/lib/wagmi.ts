import { createConfig, http } from 'wagmi';
import { sepolia, arbitrumSepolia, baseSepolia } from 'wagmi/chains';
import { metaMask } from 'wagmi/connectors';

/**
 * Env-based network selection.
 * NEXT_PUBLIC_NETWORK_MODE: "test" | "production" — keeps UI aligned with backend.
 * OceanLink currently targets testnets only (see backend config/chains.ts).
 */
export const NETWORK_MODE =
  (process.env.NEXT_PUBLIC_NETWORK_MODE as 'test' | 'production') || 'test';

export const SUPPORTED_CHAINS = [sepolia, arbitrumSepolia, baseSepolia] as const;

export const wagmiConfig = createConfig({
  chains: SUPPORTED_CHAINS,
  connectors: [metaMask({ dappMetadata: { name: 'OceanLink Bridge' } })],
  ssr: true,
  transports: {
    // No URL arg → viem uses each chain's default public RPC.
    [sepolia.id]: http(),
    [arbitrumSepolia.id]: http(),
    [baseSepolia.id]: http(),
  },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
