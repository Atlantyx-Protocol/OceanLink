'use client';

import { createElement, useCallback, useRef, useState } from 'react';
import { createPublicClient, http, parseUnits, erc20Abi } from 'viem';
import type { PublicClient } from 'viem';
import { useWalletClient } from 'wagmi';
import {
  getChain,
  getChainId,
  getUsdcAddress,
  getHtlcAddress,
  type SupportedChain,
} from '@/lib/web3/web3';
import { USDC_DECIMALS } from '@/hooks/funds/constants';
import { toast } from '@/hooks/use-toast';
import { getExplorerTxUrl, shortHash } from '@/lib/explorers';

export type OceanBridgeStep =
  | 'idle'
  | 'checking'
  | 'approving'
  | 'submitting'
  | 'tracking' // intent accepted; waiting for orchestrator settlement via SSE
  | 'done'
  | 'error';

// mirrors backend OrderStatus, used to label the tracking step accurately.
export type OrderStatus = 'QUEUED' | 'PARTIAL' | 'MATCHED' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

export interface OceanBridgeState {
  step: OceanBridgeStep;
  approvalTxHash: `0x${string}` | null;
  orderId: string | null;
  orderStatus: OrderStatus | null;
  error: string | null;
  isLoading: boolean;
}

export interface OceanBridgeParams {
  amount: string;
  srcChain: SupportedChain;
  desChain: SupportedChain;
  userAddress: `0x${string}`;
  incentiveFee?: string;
  // override the default 30-minute deadline (in seconds)
  deadlineSeconds?: number;
}

const INITIAL_STATE: OceanBridgeState = {
  step: 'idle',
  approvalTxHash: null,
  orderId: null,
  orderStatus: null,
  error: null,
  isLoading: false,
};

// SSE event type → backend OrderStatus, used so the bridge button label
// stays in sync with what /activity shows.
const EVENT_TO_STATUS: Record<ServerOrderEvent['type'], OrderStatus | null> = {
  queued: 'QUEUED',
  matched: 'MATCHED',
  plan: 'MATCHED', // orchestrator started; still settling
  htlc_created: 'MATCHED',
  withdrawn: 'MATCHED',
  done: 'COMPLETED',
  error: 'FAILED',
};

// intent orders are valid for 30 minutes
const INTENT_DEADLINE_SECONDS = 30 * 60;

// timeout for intent submission (30s)
const INTENT_SUBMIT_TIMEOUT_MS = 30_000;

// backend base URL — SSE must hit the backend directly, not via Next.js proxy
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

interface ServerOrderEvent {
  orderId: string;
  type: 'queued' | 'matched' | 'plan' | 'htlc_created' | 'withdrawn' | 'done' | 'error';
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

// renders a truncated tx hash as a clickable link to the chain explorer.
// falls back to plain truncated text when the chain is unknown.
function txLink(chain: string, txHash: string) {
  const url = getExplorerTxUrl(chain, txHash);
  const label = shortHash(txHash);
  if (!url) {
    return createElement('span', { className: 'font-mono text-xs' }, label);
  }
  return createElement(
    'a',
    {
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      className: 'font-mono text-xs underline underline-offset-2 hover:text-foreground',
    },
    label
  );
}

interface Withdrawal {
  chain: string;
  txHash: string;
}

const EVENT_TITLES: Record<ServerOrderEvent['type'], string> = {
  queued: 'Order queued',
  matched: 'Order matched',
  plan: 'Execution planned',
  htlc_created: 'HTLC created',
  withdrawn: 'Withdrawal completed',
  done: 'Bridge completed',
  error: 'Bridge failed',
};

function buildEventDescription(event: ServerOrderEvent): React.ReactNode {
  const data = event.data ?? {};

  if (event.type === 'htlc_created') {
    const chain = typeof data.chain === 'string' ? data.chain : '';
    const txHash = typeof data.txHash === 'string' ? data.txHash : '';
    if (chain && txHash) {
      return createElement('span', null, `on ${chain} — `, txLink(chain, txHash));
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

  // default: plain message text
  return event.message;
}

// open SSE stream for orderId, toast each event, auto-close on done/error.
// onEvent is invoked for every event so the caller can drive the button label
// from the live order status, then a terminal event closes the stream.
function subscribeToOrderEvents(orderId: string, onEvent: (event: ServerOrderEvent) => void): void {
  const url = `${BACKEND_URL}/api/orders/${orderId}/events`;
  const es = new EventSource(url);

  es.onmessage = (e) => {
    let event: ServerOrderEvent;
    try {
      event = JSON.parse(e.data);
    } catch {
      return;
    }
    toast({
      title: EVENT_TITLES[event.type] ?? event.type,
      description: buildEventDescription(event),
      variant: event.type === 'error' ? 'destructive' : undefined,
    });
    onEvent(event);
    if (event.type === 'done' || event.type === 'error') {
      es.close();
    }
  };

  es.onerror = () => {
    es.close();
  };
}

export function useOceanBridge() {
  const [state, setState] = useState<OceanBridgeState>(INITIAL_STATE);
  const { data: walletClient } = useWalletClient();
  const walletClientRef = useRef(walletClient);
  walletClientRef.current = walletClient;

  const inflightRef = useRef(false);

  const reset = useCallback(() => {
    inflightRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  const bridge = useCallback(async (params: OceanBridgeParams) => {
    if (inflightRef.current) return;
    inflightRef.current = true;

    const { amount, srcChain, desChain, userAddress } = params;

    try {
      // step 1: check current USDC allowance
      setState({
        step: 'checking',
        approvalTxHash: null,
        orderId: null,
        orderStatus: null,
        error: null,
        isLoading: true,
      });

      const chain = getChain(srcChain);
      const publicClient = createPublicClient({
        chain,
        transport: http(),
      }) as PublicClient;

      const usdcAddress = getUsdcAddress(srcChain);
      const htlcAddress = getHtlcAddress(srcChain);
      const amountWei = parseUnits(amount, USDC_DECIMALS);

      const currentAllowance = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [userAddress, htlcAddress],
      });

      // step 2: approve HTLC if allowance is insufficient
      let approvalTxHash: `0x${string}` | null = null;

      if (currentAllowance < amountWei) {
        setState((s) => ({ ...s, step: 'approving' }));

        const wc = walletClientRef.current;
        if (!wc) throw new Error('Wallet not connected');

        const fees = await publicClient.estimateFeesPerGas();
        const GAS_BUFFER_MULTIPLIER = BigInt(2);
        const maxFeePerGas = fees.maxFeePerGas
          ? fees.maxFeePerGas * GAS_BUFFER_MULTIPLIER
          : undefined;
        const maxPriorityFeePerGas = fees.maxPriorityFeePerGas
          ? fees.maxPriorityFeePerGas * GAS_BUFFER_MULTIPLIER
          : undefined;

        const hash = await wc.writeContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [htlcAddress, amountWei],
          chain,
          account: userAddress,
          maxFeePerGas,
          maxPriorityFeePerGas,
        });

        approvalTxHash = hash;
        setState((s) => ({ ...s, approvalTxHash: hash }));
        toast({
          title: 'Approval sent',
          description: createElement('span', null, 'TX: ', txLink(srcChain, hash)),
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === 'reverted') {
          throw new Error('USDC approval transaction reverted');
        }

        toast({ title: 'Approval confirmed' });
      }

      // step 3: submit intent order to backend
      setState((s) => ({ ...s, step: 'submitting' }));

      const deadlineSecs = params.deadlineSeconds ?? INTENT_DEADLINE_SECONDS;
      const deadline = Math.floor(Date.now() / 1000) + deadlineSecs;

      const body: Record<string, unknown> = {
        srcChain: getChainId(srcChain),
        desChain: getChainId(desChain),
        amount,
        deadline,
        userAddress,
      };
      if (params.incentiveFee) {
        body.incentiveFee = params.incentiveFee;
      }

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

      // intent accepted — keep the button in a loading state ('tracking') until
      // the SSE stream resolves with 'done' (settled on-chain) or 'error'.
      const submittedOrderId = data.order?.orderId ?? null;
      setState({
        step: 'tracking',
        approvalTxHash,
        orderId: submittedOrderId,
        orderStatus: 'QUEUED',
        error: null,
        isLoading: true,
      });

      toast({
        title: 'Bridge order submitted',
        description: 'Tracking settlement on-chain…',
      });

      if (submittedOrderId) {
        subscribeToOrderEvents(submittedOrderId, (event) => {
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
            // mid-flight progress update — keep step='tracking', update label
            setState((s) => ({ ...s, orderStatus: nextStatus }));
          }
        });
      } else {
        // no orderId means nothing to track — treat as done immediately.
        setState((s) => ({ ...s, step: 'done', isLoading: false }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bridge transaction failed';
      setState((s) => ({
        ...s,
        step: 'error',
        error: message,
        isLoading: false,
      }));

      toast({ title: 'Bridge failed', description: message, variant: 'destructive' });
    } finally {
      inflightRef.current = false;
    }
  }, []);

  return { ...state, bridge, reset };
}
