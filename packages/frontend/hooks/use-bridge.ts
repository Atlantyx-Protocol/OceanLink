'use client';

import { createElement, useCallback, useRef, useState } from 'react';
import { createPublicClient, http, parseUnits, erc20Abi, type PublicClient } from 'viem';
import { useWalletClient } from 'wagmi';
import { useTranslations } from 'next-intl';
import { getChain, getChainId, getUsdcAddress, getHtlcAddress } from '@/config/chains';
import { USDC_DECIMALS } from '@/config/constants';
import { toast } from '@/hooks/use-toast';
import { EVENT_TO_STATUS } from './bridge/events';
import { subscribeToOrderEvents } from './bridge/sse';
import { toastEvent } from './bridge/event-toaster';
import { txLink } from './bridge/tx-link';
import type { BridgeParams, BridgeState } from './bridge/types';

export type { BridgeStep, BridgeParams, BridgeState, OrderStatus } from './bridge/types';

const DEFAULT_DEADLINE_SECONDS = 30 * 60;
const INTENT_SUBMIT_TIMEOUT_MS = 30_000;

// L2 testnet base fees can move between the wallet's gas estimate and the
// actual submit; pad the cap so the tx isn't rejected for being just below.
const GAS_BUFFER_MULTIPLIER = BigInt(2);

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

        const chain = getChain(srcChain);
        const publicClient = createPublicClient({ chain, transport: http() }) as PublicClient;
        const usdcAddress = getUsdcAddress(srcChain);
        const htlcAddress = getHtlcAddress(srcChain);
        const amountWei = parseUnits(amount, USDC_DECIMALS);

        const currentAllowance = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [userAddress, htlcAddress],
        });

        let approvalTxHash: `0x${string}` | null = null;

        if (currentAllowance < amountWei) {
          setState((s) => ({ ...s, step: 'approving' }));

          const wc = walletClientRef.current;
          if (!wc) throw new Error('Wallet not connected');

          const fees = await publicClient.estimateFeesPerGas();
          const maxFeePerGas = fees.maxFeePerGas
            ? fees.maxFeePerGas * GAS_BUFFER_MULTIPLIER
            : undefined;
          const maxPriorityFeePerGas = fees.maxPriorityFeePerGas
            ? fees.maxPriorityFeePerGas * GAS_BUFFER_MULTIPLIER
            : undefined;

          approvalTxHash = await wc.writeContract({
            address: usdcAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [htlcAddress, amountWei],
            chain,
            account: userAddress,
            maxFeePerGas,
            maxPriorityFeePerGas,
          });

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

          const receipt = await publicClient.waitForTransactionReceipt({ hash: approvalTxHash });
          if (receipt.status === 'reverted') {
            throw new Error('USDC approval transaction reverted');
          }
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

interface IntentBody {
  srcChain: number;
  desChain: number;
  amount: string;
  deadline: number;
  userAddress: string;
  incentiveFee?: string;
}

async function submitIntent(body: IntentBody): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), INTENT_SUBMIT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('/api/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Intent submission timed out — please try again');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }

  const data = await res.json().catch(() => ({ error: 'Invalid response' }));
  if (!res.ok) {
    throw new Error(data.error || `Intent submission failed (${res.status})`);
  }

  return data.order?.orderId ?? null;
}
