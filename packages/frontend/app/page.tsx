'use client';

import { useConnect } from 'wagmi';
import { useTranslations } from 'next-intl';
import { BridgeCard } from '@/components/bridge/bridge-card';
import { useAuth } from '@/lib/auth-context';

export default function BridgePage() {
  const t = useTranslations('hero');
  const { isAuthenticated } = useAuth();
  const { connect, connectors } = useConnect();

  const handleConnectWallet = () => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  };

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-8">
      <div className="mb-8 text-center">
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
          {t('title')}
        </h1>
        <p className="mt-2 text-sm md:text-base text-muted-foreground">{t('subtitle')}</p>
      </div>
      <BridgeCard isConnected={isAuthenticated} onConnectWallet={handleConnectWallet} />
    </main>
  );
}
