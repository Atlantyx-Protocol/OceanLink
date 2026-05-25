'use client';

import { createElement, useCallback, useRef, useState } from 'react';
import { useWalletClient } from 'wagmi';
import { useTranslations } from 'next-intl';
import { getChainId } from '@/config/chains';
import { toast } from '@/hooks/use-toast';
import { EVENT_TO_STATUS } from './bridge/events';
import { subscribeToOrderEvents } from './bridge/sse';
import { toastEvent } from './bridge/event-toaster';
import { txLink } from './bridge/tx-link';
import {
  createSrcContext,
  checkAllowance,
  sendApproval,
  waitForApproval,
  submitIntent,
} from './bridge/steps';
import type { BridgeParams, BridgeState } from './bridge/types';

export type { BridgeStep, BridgeParams, BridgeState, OrderStatus } from './bridge/types';

const DEFAULT_DEADLINE_SECONDS = 30 * 60;

const INITIAL_STATE: BridgeState = {
  step: 'idle',
  approvalTxHash: null,
  orderId: null,
  orderStatus: null,
  error: null,
  isLoading: false,
};

export function useBridge() {
  const [state, setState] = useState<BridgeState>(INITIAL_STATE);
  const { data: walletClient } = useWalletClient();
  const walletClientRef = useRef(walletClient);
  walletClientRef.current = walletClient;

  const inflightRef = useRef(false);

  const tToast = useTranslations('bridge.toast');
  const tEvent = useTranslations('bridge.event');

  // keep latest translators in a ref so SSE callbacks pick up locale changes
  const tEventRef = useRef(tEvent);
  tEventRef.current = tEvent;

  const reset = useCallback(() => {
    inflightRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  const bridge = useCallback(
    async (params: BridgeParams) => {
      if (inflightRef.current) return;
      inflightRef.current = true;

      const { amount, srcChain, desChain, userAddress } = params;

      try {
        setState({ ...INITIAL_STATE, step: 'checking', isLoading: true });

        const ctx = createSrcContext(srcChain, amount);
        const currentAllowance = await checkAllowance(ctx, userAddress);

        let approvalTxHash: `0x${string}` | null = null;

        if (currentAllowance < ctx.amountWei) {
          setState((s) => ({ ...s, step: 'approving' }));

          const wc = walletClientRef.current;
          if (!wc) throw new Error('Wallet not connected');

          approvalTxHash = await sendApproval(ctx, wc, userAddress);
          setState((s) => ({ ...s, approvalTxHash }));
          toast({
            title: tToast('approvalSent'),
            description: createElement(
              'span',
              null,
              `${tToast('txPrefix')} `,
              txLink(srcChain, approvalTxHash)
            ),
          });

          await waitForApproval(ctx.publicClient, approvalTxHash);
          toast({ title: tToast('approvalConfirmed') });
        }

        setState((s) => ({ ...s, step: 'submitting' }));

        const deadlineSecs = params.deadlineSeconds ?? DEFAULT_DEADLINE_SECONDS;
        const submittedOrderId = await submitIntent({
          srcChain: getChainId(srcChain),
          desChain: getChainId(desChain),
          amount,
          deadline: Math.floor(Date.now() / 1000) + deadlineSecs,
          userAddress,
          incentiveFee: params.incentiveFee,
        });

        setState({
          step: 'tracking',
          approvalTxHash,
          orderId: submittedOrderId,
          orderStatus: 'QUEUED',
          error: null,
          isLoading: true,
        });

        toast({ title: tToast('orderSubmitted'), description: tToast('tracking') });

        if (!submittedOrderId) {
          setState((s) => ({ ...s, step: 'done', isLoading: false }));
          return;
        }

        subscribeToOrderEvents(submittedOrderId, (event) => {
          toastEvent(event, tEventRef.current);
          const nextStatus = EVENT_TO_STATUS[event.type];

          if (event.type === 'done') {
            inflightRef.current = false;
            setState((s) => ({
              ...s,
              step: 'done',
              orderStatus: nextStatus ?? s.orderStatus,
              isLoading: false,
              error: null,
            }));
          } else if (event.type === 'error') {
            inflightRef.current = false;
            setState((s) => ({
              ...s,
              step: 'error',
              orderStatus: nextStatus ?? s.orderStatus,
              isLoading: false,
              error: event.message ?? 'Bridge settlement failed',
            }));
          } else if (nextStatus) {
            setState((s) => ({ ...s, orderStatus: nextStatus }));
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Bridge transaction failed';
        setState((s) => ({ ...s, step: 'error', error: message, isLoading: false }));
        toast({ title: tToast('bridgeFailed'), description: message, variant: 'destructive' });
      } finally {
        inflightRef.current = false;
      }
    },
    [tToast]
  );

  return { ...state, bridge, reset };
}
