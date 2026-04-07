"use client"

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react"
import { useAccount } from "wagmi"
import {
  clearWalletClient,
  setWalletClientFromConnector,
} from "./walletClient"

/**
 * Wallet-only auth/session context.
 *
 * isAuthenticated == Boolean(walletAddress). No separate login step —
 * connecting a wallet is the session.
 *
 * walletAddress is normalized to lowercase so downstream API calls,
 * query keys, and local cache lookups all agree on one canonical form.
 */

interface AuthContextValue {
  walletAddress: `0x${string}` | null
  walletAddressLower: string | null
  chainId: number | null
  isAuthenticated: boolean
  isConnecting: boolean
  isReconnecting: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, chainId, connector, status, isConnecting, isReconnecting } =
    useAccount()

  // Bind the module-level WalletClient to the active connector whenever the
  // account or chain changes. Clear it on disconnect so stale signers can't
  // sign for the wrong address.
  useEffect(() => {
    let cancelled = false

    if (status === "connected" && connector) {
      setWalletClientFromConnector(connector).catch((err) => {
        console.error("Failed to bind WalletClient:", err)
      })
    } else {
      clearWalletClient()
    }

    return () => {
      cancelled = true
      if (cancelled) clearWalletClient()
    }
  }, [status, connector, address, chainId])

  const value = useMemo<AuthContextValue>(() => {
    const walletAddress = address ?? null
    return {
      walletAddress,
      walletAddressLower: walletAddress ? walletAddress.toLowerCase() : null,
      chainId: chainId ?? null,
      isAuthenticated: Boolean(walletAddress),
      isConnecting,
      isReconnecting,
    }
  }, [address, chainId, isConnecting, isReconnecting])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error("useAuth must be used within <AuthProvider>")
  }
  return ctx
}
