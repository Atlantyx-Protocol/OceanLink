import { createElement, type ReactNode } from 'react';
import type { useTranslations } from 'next-intl';
import { toast } from '@/hooks/use-toast';
import { txLink } from './tx-link';
import type { ServerOrderEvent, Withdrawal } from './events';

type EventTranslator = ReturnType<typeof useTranslations<'bridge.event'>>;

// presents a server event as a toast. takes the translator so titles + the
// "on {chain} —" prefix follow the active locale.
export function toastEvent(event: ServerOrderEvent, t: EventTranslator) {
  toast({
    title: t(event.type),
    description: buildDescription(event, t),
    variant: event.type === 'error' ? 'destructive' : undefined,
  });
}

function buildDescription(event: ServerOrderEvent, t: EventTranslator): ReactNode {
  const data = event.data ?? {};

  if (event.type === 'htlc_created') {
    const chain = typeof data.chain === 'string' ? data.chain : '';
    const txHash = typeof data.txHash === 'string' ? data.txHash : '';
    if (chain && txHash) {
      return createElement('span', null, `${t('onChain', { chain })} `, txLink(chain, txHash));
    }
  }

  if (event.type === 'withdrawn') {
    const withdrawals = Array.isArray(data.withdrawals) ? (data.withdrawals as Withdrawal[]) : [];
    if (withdrawals.length > 0) {
      return createElement(
        'div',
        { className: 'flex flex-col gap-0.5' },
        ...withdrawals.map((w, i) =>
          createElement('span', { key: i }, `${w.chain} — `, txLink(w.chain, w.txHash))
        )
      );
    }
  }

  return event.message;
}
