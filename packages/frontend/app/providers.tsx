'use client';

import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { AuthProvider } from '@/lib/auth-context';
import { ThemeProvider } from '@/app/components/ui/theme-provider';

export function Providers({ children }: { children: ReactNode }) {
  // QueryClient must be created inside a client component so each browser
  // session gets its own cache (vs. a shared module-level instance that
  // could leak between requests in SSR).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
