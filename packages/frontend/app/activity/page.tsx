'use client';

import { useAccount } from 'wagmi';
import { sepolia, arbitrumSepolia, baseSepolia } from 'wagmi/chains';
import { ArrowRight, Clock, Loader2, RefreshCw } from 'lucide-react';
import { formatUnits } from 'viem';
import {
  useBridgeActivity,
  type BridgeOrder,
  type BridgeOrderStatus,
} from '@/hooks/use-bridge-activity';
import { USDC_DECIMALS } from '@/hooks/funds/constants';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ChainMeta {
  name: string;
  short: string;
  icon: string;
}

const CHAIN_META: Record<number, ChainMeta> = {
  [sepolia.id]: { name: 'Ethereum Sepolia', short: 'Ethereum', icon: '/ethereum.png' },
  [arbitrumSepolia.id]: {
    name: 'Arbitrum Sepolia',
    short: 'Arbitrum',
    icon: '/arbitrum.png',
  },
  [baseSepolia.id]: { name: 'Base Sepolia', short: 'Base', icon: '/base.png' },
};

const STATUS_STYLES: Record<BridgeOrderStatus, string> = {
  QUEUED: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20',
  PARTIAL: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20',
  MATCHED: 'bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500/20',
  EXPIRED: 'bg-muted text-muted-foreground ring-1 ring-border',
};

const STATUS_LABEL: Record<BridgeOrderStatus, string> = {
  QUEUED: 'Pending',
  PARTIAL: 'Partial',
  MATCHED: 'Completed',
  EXPIRED: 'Expired',
};

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const { orders, isLoading, isRefreshing, error, refetch } = useBridgeActivity(address);

  const hasInFlight = orders.some((o) => o.status === 'QUEUED' || o.status === 'PARTIAL');

  return (
    <main className="flex-1 flex flex-col items-center px-4 py-8 md:py-12">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground">
              Activity
            </h1>
            <p className="mt-2 text-sm md:text-base text-muted-foreground">
              Track your bridge orders in real time.
            </p>
          </div>
          {isConnected && (
            <div className="flex items-center gap-2">
              {hasInFlight && (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                  </span>
                  Live
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void refetch()}
                disabled={isLoading || isRefreshing}
                className="text-muted-foreground hover:text-foreground"
              >
                <RefreshCw
                  className={cn(
                    'h-4 w-4 mr-1.5',
                    (isLoading || isRefreshing) && 'animate-spin'
                  )}
                />
                Refresh
              </Button>
            </div>
          )}
        </div>

        <div className="rounded-[24px] bg-card border border-border/60 p-4 md:p-6 shadow-[0_8px_30px_-12px_rgba(17,17,17,0.08),0_2px_8px_-3px_rgba(17,17,17,0.04)] dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]">
          {!isConnected ? (
            <EmptyState
              title="Connect your wallet"
              description="Connect a wallet to view your bridge activity."
            />
          ) : isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mb-3" />
              <span className="text-sm">Loading activity...</span>
            </div>
          ) : error && orders.length === 0 ? (
            <EmptyState title="Failed to load activity" description={error} />
          ) : orders.length === 0 ? (
            <EmptyState
              title="No activity yet"
              description={
                address
                  ? `No bridge orders for ${address.slice(0, 6)}...${address.slice(-4)} yet. Submit one to see it appear here.`
                  : 'Submit a bridge order to see it appear here.'
              }
            />
          ) : (
            <ul className="divide-y divide-border/60">
              {orders.map((order) => (
                <OrderRow key={order.orderId} order={order} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </main>
  );
}

function OrderRow({ order }: { order: BridgeOrder }) {
  const src = CHAIN_META[order.srcChain];
  const des = CHAIN_META[order.desChain];
  const amount = formatAmount(order.amount);
  const isInFlight = order.status === 'QUEUED' || order.status === 'PARTIAL';

  return (
    <li className="flex items-center justify-between gap-4 py-4 first:pt-2 last:pb-2">
      <div className="flex items-center gap-3 min-w-0">
        <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
          {src ? (
            <img
              src={src.icon}
              alt={src.short}
              className="h-7 w-7 rounded-full object-contain"
            />
          ) : (
            <ChainFallback />
          )}
          {des && (
            <img
              src={des.icon}
              alt={des.short}
              className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full object-contain ring-2 ring-card"
            />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span>{src?.short ?? `Chain ${order.srcChain}`}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{des?.short ?? `Chain ${order.desChain}`}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {formatRelative(order.createdAt)}
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="text-sm font-semibold text-foreground tabular-nums">
          {amount} <span className="text-muted-foreground font-normal">USDC</span>
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
            STATUS_STYLES[order.status]
          )}
        >
          {isInFlight && (
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
          )}
          {STATUS_LABEL[order.status]}
        </span>
      </div>
    </li>
  );
}

function ChainFallback() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary">
      <span className="text-xs text-muted-foreground">?</span>
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

function formatAmount(raw: string): string {
  try {
    const value = parseFloat(formatUnits(BigInt(raw), USDC_DECIMALS));
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch {
    return raw;
  }
}

function formatRelative(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
