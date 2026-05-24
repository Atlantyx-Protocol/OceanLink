'use client';

import { useState } from 'react';
import { Clock, Loader2, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAccount } from 'wagmi';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { truncateAddress } from '@/lib/format';
import { useBridgeActivity } from '@/hooks/use-bridge-activity';
import { OrderRow } from './order-row';

export function ActivityList() {
  const t = useTranslations('activity');
  const { address, isConnected } = useAccount();
  const { orders, isLoading, isRefreshing, error, refetch } = useBridgeActivity(address);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-8 md:py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
              {t('title')}
            </h1>
            <p className="mt-2 text-sm md:text-base text-muted-foreground">{t('subtitle')}</p>
          </div>
          {isConnected && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void refetch()}
              disabled={isLoading || isRefreshing}
              className="text-muted-foreground hover:text-foreground"
            >
              <RefreshCw
                className={cn('h-4 w-4 mr-1.5', (isLoading || isRefreshing) && 'animate-spin')}
              />
              {t('refresh')}
            </Button>
          )}
        </div>

        <div className="rounded-[24px] bg-card border border-border/60 p-4 md:p-6 shadow-[0_8px_30px_-12px_rgba(17,17,17,0.08),0_2px_8px_-3px_rgba(17,17,17,0.04)] dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]">
          {!isConnected ? (
            <EmptyState title={t('connectWallet')} description={t('connectWalletHint')} />
          ) : isLoading ? (
            <LoadingState text={t('loading')} />
          ) : error && orders.length === 0 ? (
            <EmptyState title={t('failedToLoad')} description={error} />
          ) : orders.length === 0 ? (
            <EmptyState
              title={t('emptyFallback').split('.')[0]}
              description={
                address
                  ? t('emptyConnected', { address: truncateAddress(address) })
                  : t('emptyFallback')
              }
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {orders.map((order) => (
                <OrderRow
                  key={order.orderId}
                  order={order}
                  expanded={expandedId === order.orderId}
                  onToggle={() =>
                    setExpandedId((id) => (id === order.orderId ? null : order.orderId))
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin mb-3" />
      <span className="text-sm">{text}</span>
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary mb-4">
        <Clock className="h-5 w-5 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
