'use client';

import { useConnect } from 'wagmi';
import { BridgeCard } from './components/bridge/bridge-card';
import { useAuth } from '@/lib/auth-context';

export default function BridgePage() {
  const { isAuthenticated } = useAuth();
  const { connect, connectors } = useConnect();

  // fallback connect for in-card button — picks first available connector
  const handleConnectWallet = () => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
          Bridge USDC across chains
        </h1>
        <p className="mt-2 text-sm md:text-base text-muted-foreground">
          Trustless. Non-custodial. Cheap.
        </p>
      </div>
      <BridgeCard isConnected={isAuthenticated} onConnectWallet={handleConnectWallet} />
    </main>
  );
}
