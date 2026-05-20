'use client';

import { useConnect } from 'wagmi';
import { Header } from './components/bridge/header';
import { BridgeCard } from './components/bridge/bridge-card';
import { Footer } from './components/bridge/footer';
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
    <div className="min-h-screen flex flex-col bg-background">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <BridgeCard isConnected={isAuthenticated} onConnectWallet={handleConnectWallet} />
      </main>

      <Footer />
    </div>
  );
}
