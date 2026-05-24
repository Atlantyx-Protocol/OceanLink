'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAccount } from 'wagmi';

// wallet-only session: isAuthenticated == Boolean(walletAddress).
// walletAddressLower is normalized so API calls and cache keys agree on
// a single canonical form across the app.

interface AuthContextValue {
  walletAddress: `0x${string}` | null;
  walletAddressLower: string | null;
  chainId: number | null;
  isAuthenticated: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, chainId, isConnecting, isReconnecting } = useAccount();

  const value = useMemo<AuthContextValue>(
    () => ({
      walletAddress: address ?? null,
      walletAddressLower: address ? address.toLowerCase() : null,
      chainId: chainId ?? null,
      isAuthenticated: Boolean(address),
      isConnecting,
      isReconnecting,
    }),
    [address, chainId, isConnecting, isReconnecting]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
