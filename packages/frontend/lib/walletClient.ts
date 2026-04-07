import { createWalletClient, custom, type WalletClient } from "viem"
import type { Connector } from "wagmi"

/**
 * Module-level WalletClient handle.
 *
 * Wagmi hooks cover most read/write flows, but service-layer code (batch
 * signing, custom EIP-712 flows, HTLC locking/unlocking, etc.) needs a
 * signer it can reach without being inside a React component. This module
 * exposes a small getter/setter pair for that case.
 *
 * Lifecycle:
 *   - setWalletClientFromConnector is called on successful connect and on
 *     account/chain change.
 *   - clearWalletClient is called on disconnect and before re-binding, so
 *     signatures can never come from a stale wallet.
 */

let walletClient: WalletClient | null = null

export function getWalletClient(): WalletClient {
  if (!walletClient) {
    throw new Error(
      "WalletClient not available — wallet is disconnected or user changed accounts mid-flow.",
    )
  }
  return walletClient
}

export function tryGetWalletClient(): WalletClient | null {
  return walletClient
}

export async function setWalletClientFromConnector(
  connector: Connector,
): Promise<WalletClient> {
  const provider = (await connector.getProvider()) as {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  }
  walletClient = createWalletClient({
    transport: custom(provider),
  })
  return walletClient
}

export function clearWalletClient(): void {
  walletClient = null
}
