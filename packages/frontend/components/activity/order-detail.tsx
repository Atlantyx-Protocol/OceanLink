'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { formatUsdcNumber } from '@/lib/format';
import type { BridgeOrder } from '@/hooks/use-bridge-activity';
import { CHAIN_META } from './chains';
import { formatAbsolute } from './time';

export function OrderDetail({ order }: { order: BridgeOrder }) {
  const t = useTranslations('activity.detail');
  const tStatus = useTranslations('activity.status');
  const locale = useLocale();

  const src = CHAIN_META[order.srcChain];
  const des = CHAIN_META[order.desChain];
  const incentive = order.incentiveFee ? formatAmount(order.incentiveFee) : null;

  return (
    <div className="mt-1 mb-3 rounded-xl border border-border/70 bg-secondary/30 p-4 text-sm">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <Field label={t('orderId')}>
          <CopyableMono value={order.orderId} />
        </Field>
        <Field label={t('status')}>
          <span className="font-medium text-foreground">{tStatus(order.status)}</span>
        </Field>
        <Field label={t('from')}>
          <span className="text-foreground">{src?.name ?? `Chain ${order.srcChain}`}</span>
        </Field>
        <Field label={t('to')}>
          <span className="text-foreground">{des?.name ?? `Chain ${order.desChain}`}</span>
        </Field>
        <Field label={t('amount')}>
          <span className="text-foreground tabular-nums">{formatAmount(order.amount)} USDC</span>
        </Field>
        {incentive && (
          <Field label={t('incentiveFee')}>
            <span className="text-foreground tabular-nums">{incentive} USDC</span>
          </Field>
        )}
        <Field label={t('submitted')}>
          <span className="text-foreground">{formatAbsolute(order.createdAt, locale)}</span>
        </Field>
        <Field label={t('deadline')}>
          <span className="text-foreground">{formatAbsolute(order.deadline, locale)}</span>
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

// backend stores amount as a human-readable USDC string, not micro-units
function formatAmount(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value)) return raw;
  return formatUsdcNumber(value);
}
