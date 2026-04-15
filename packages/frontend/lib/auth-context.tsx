"use client"

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react"
import { useAccount } from "wagmi"

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
  const { address, chainId, isConnecting, isReconnecting } =
    useAccount()

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
