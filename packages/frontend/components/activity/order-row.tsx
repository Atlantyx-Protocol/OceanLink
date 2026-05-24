'use client';

import { ArrowRight, ChevronDown } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { formatUsdcNumber } from '@/lib/format';
import type { BridgeOrder } from '@/hooks/use-bridge-activity';
import { CHAIN_META } from './chains';
import { formatRelative } from './time';
import { StatusBadge } from './status-badge';
import { OrderDetail } from './order-detail';

interface OrderRowProps {
  order: BridgeOrder;
  expanded: boolean;
  onToggle: () => void;
}

export function OrderRow({ order, expanded, onToggle }: OrderRowProps) {
  const tTime = useTranslations('activity.time');
  const locale = useLocale();

  const src = CHAIN_META[order.srcChain];
  const des = CHAIN_META[order.desChain];

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
              <img src={src.icon} alt={src.short} className="h-7 w-7 rounded-full object-contain" />
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
              {formatRelative(order.createdAt, tTime, locale)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex flex-col items-end gap-1">
            <span className="text-sm font-semibold text-foreground tabular-nums">
              {formatAmount(order.amount)}{' '}
              <span className="text-muted-foreground font-normal">USDC</span>
            </span>
            <StatusBadge status={order.status} />
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

function ChainFallback() {
  return (
    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary">
      <span className="text-xs text-muted-foreground">?</span>
    </div>
  );
}

function formatAmount(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return formatUsdcNumber(value);
}
