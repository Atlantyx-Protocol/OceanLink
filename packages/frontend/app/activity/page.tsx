'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { sepolia, arbitrumSepolia, baseSepolia } from 'wagmi/chains';
import { ArrowRight, ChevronDown, Clock, Copy, Loader2, RefreshCw } from 'lucide-react';
import {
  useBridgeActivity,
  type BridgeOrder,
  type BridgeOrderStatus,
} from '@/hooks/use-bridge-activity';
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
  QUEUED: 'bg-secondary text-foreground ring-1 ring-border',
  PARTIAL: 'bg-secondary text-foreground ring-1 ring-border',
  MATCHED: 'bg-secondary text-foreground ring-1 ring-border',
  COMPLETED: 'bg-foreground text-background ring-1 ring-foreground',
  FAILED: 'bg-secondary text-foreground ring-1 ring-foreground/40',
  EXPIRED: 'bg-secondary text-muted-foreground ring-1 ring-border',
};

const STATUS_LABEL: Record<BridgeOrderStatus, string> = {
  QUEUED: 'Pending match',
  PARTIAL: 'Partial match',
  MATCHED: 'Settling',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
};

export default function ActivityPage() {
  const { address, isConnected } = useAccount();
  const { orders, isLoading, isRefreshing, error, refetch } = useBridgeActivity(address);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

function OrderRow({
  order,
  expanded,
  onToggle,
}: {
  order: BridgeOrder;
  expanded: boolean;
  onToggle: () => void;
}) {
  const src = CHAIN_META[order.srcChain];
  const des = CHAIN_META[order.desChain];
  const amount = formatAmount(order.amount);

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-4 py-4 first:pt-2 last:pb-2 text-left hover:bg-secondary/40 rounded-lg px-2 -mx-2 transition-colors"
        aria-expanded={expanded}
      >
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
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {amount} <span className="text-muted-foreground font-normal">USDC</span>
            </span>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                STATUS_STYLES[order.status]
              )}
            >
              {STATUS_LABEL[order.status]}
            </span>
          </div>
          <ChevronDown
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </div>
      </button>

      {expanded && <OrderDetail order={order} />}
    </li>
  );
}

function OrderDetail({ order }: { order: BridgeOrder }) {
  const src = CHAIN_META[order.srcChain];
  const des = CHAIN_META[order.desChain];
  const incentive = order.incentiveFee ? formatAmount(order.incentiveFee) : null;

  return (
    <div className="mt-1 mb-3 rounded-xl border border-border/70 bg-secondary/30 p-4 text-sm">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Order ID">
          <CopyableMono value={order.orderId} />
        </Field>
        <Field label="Status">
          <span className="font-medium text-foreground">{STATUS_LABEL[order.status]}</span>
        </Field>
        <Field label="From">
          <span className="text-foreground">{src?.name ?? `Chain ${order.srcChain}`}</span>
        </Field>
        <Field label="To">
          <span className="text-foreground">{des?.name ?? `Chain ${order.desChain}`}</span>
        </Field>
        <Field label="Amount">
          <span className="text-foreground tabular-nums">
            {formatAmount(order.amount)} USDC
          </span>
        </Field>
        {incentive && (
          <Field label="Incentive fee">
            <span className="text-foreground tabular-nums">{incentive} USDC</span>
          </Field>
        )}
        <Field label="Submitted">
          <span className="text-foreground">{formatAbsolute(order.createdAt)}</span>
        </Field>
        <Field label="Deadline">
          <span className="text-foreground">{formatAbsolute(order.deadline)}</span>
        </Field>
      </dl>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </dt>
      <dd className="mt-1 text-sm break-all">{children}</dd>
    </div>
  );
}

function CopyableMono({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground">
      <span className="break-all">{value}</span>
      <button
        type="button"
        onClick={handleCopy}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Copy"
      >
        <Copy className="h-3 w-3" />
      </button>
      {copied && <span className="text-[10px] text-green-600 dark:text-green-400">copied</span>}
    </span>
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
  // backend stores amount as a human-readable USDC string (e.g. "1.5"),
  // not micro-units. parse straight to number.
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

function formatAbsolute(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
