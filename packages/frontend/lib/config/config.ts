/**
 * Typed environment configuration.
 *
 * All public env vars are prefixed with NEXT_PUBLIC_ so Next.js exposes them
 * to the browser bundle. Server-only secrets (API keys) are NOT prefixed and
 * are only available in API routes / server components.
 */

export const config = {
  network: (process.env.NEXT_PUBLIC_NETWORK_MODE ?? "testnet") as "testnet" | "mainnet",

  across: {
    /** Server-only — never shipped to the browser. */
    apiKey: process.env.NEXT_PUBLIC_ACROSS_API_KEY ?? "",
    integratorId: process.env.NEXT_PUBLIC_ACROSS_INTEGRATOR_ID ?? "0x00d9",
  },

  ethereum: {
    httpEndpoint: process.env.NEXT_PUBLIC_ETHEREUM_RPC ?? "",
  },
  arbitrum: {
    httpEndpoint: process.env.NEXT_PUBLIC_ARBITRUM_RPC ?? "",
  },
} as const
