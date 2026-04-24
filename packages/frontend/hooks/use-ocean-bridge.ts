'use client';

import { useCallback, useRef, useState } from 'react';
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OceanBridgeStep = 'idle' | 'checking' | 'approving' | 'submitting' | 'done' | 'error';

export interface OceanBridgeState {
  step: OceanBridgeStep;
  approvalTxHash: `0x${string}` | null;
  orderId: string | null;
  error: string | null;
  isLoading: boolean;
}

export interface OceanBridgeParams {
  amount: string;
  srcChain: SupportedChain;
  desChain: SupportedChain;
  userAddress: `0x${string}`;
  incentiveFee?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_STATE: OceanBridgeState = {
  step: 'idle',
  approvalTxHash: null,
  orderId: null,
  error: null,
  isLoading: false,
};

/** Intent orders are valid for 30 minutes. */
const INTENT_DEADLINE_SECONDS = 30 * 60;

/** Timeout for the intent submission request (30 seconds). */
const INTENT_SUBMIT_TIMEOUT_MS = 30_000;

/** Backend base URL — SSE must hit the backend directly (not via Next.js proxy). */
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

interface ServerOrderEvent {
  orderId: string;
  type: 'queued' | 'matched' | 'htlc_created' | 'withdrawn' | 'done' | 'error';
  message: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

/**
 * Open an SSE stream for the given orderId, log every server event, and
 * toast each one. The stream auto-closes when the server sends a 'done'
 * or 'error' event.
 */
function subscribeToOrderEvents(orderId: string): void {
  const url = `${BACKEND_URL}/api/orders/${orderId}/events`;
  const es = new EventSource(url);

  console.log('[OceanBridge:server] 🔌 subscribing', { url, orderId });

  es.onmessage = (e) => {
    let event: ServerOrderEvent;
    try {
      event = JSON.parse(e.data);
    } catch {
      console.warn('[OceanBridge:server] non-JSON message', e.data);
      return;
    }
    console.log(`[OceanBridge:server] ⟵ ${event.type}`, event);
    toast({
      title: `Bridge: ${event.type}`,
      description: event.message,
      variant: event.type === 'error' ? 'destructive' : undefined,
    });
    if (event.type === 'done' || event.type === 'error') {
      es.close();
      console.log('[OceanBridge:server] 🔌 stream closed');
    }
  };

  es.onerror = (err) => {
    console.error('[OceanBridge:server] SSE error', err);
    es.close();
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

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

    console.log('[OceanBridge] ▶ bridge() start', {
      amount,
      srcChain,
      desChain,
      userAddress,
      incentiveFee: params.incentiveFee,
    });

    try {
      // ----- Step 1: Check current USDC allowance ---------------------------
      setState({
        step: 'checking',
        approvalTxHash: null,
        orderId: null,
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

      console.log('[OceanBridge] step=checking — reading USDC allowance', {
        usdcAddress,
        htlcAddress,
        amountWei: amountWei.toString(),
      });

      const currentAllowance = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [userAddress, htlcAddress],
      });

      console.log('[OceanBridge] allowance result', {
        currentAllowance: currentAllowance.toString(),
        needsApproval: currentAllowance < amountWei,
      });

      // ----- Step 2: Approve HTLC if allowance is insufficient ---------------
      let approvalTxHash: `0x${string}` | null = null;

      if (currentAllowance < amountWei) {
        setState((s) => ({ ...s, step: 'approving' }));
        console.log('[OceanBridge] step=approving — requesting approve()');

        const wc = walletClientRef.current;
        if (!wc) throw new Error('Wallet not connected');

        const hash = await wc.writeContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [htlcAddress, amountWei],
          chain,
          account: userAddress,
        });

        approvalTxHash = hash;
        console.log('[OceanBridge] approval tx sent', { hash });

        setState((s) => ({ ...s, approvalTxHash: hash }));
        toast({ title: 'Approval sent', description: `TX: ${hash.slice(0, 10)}...${hash.slice(-8)}` });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log('[OceanBridge] approval receipt', {
          status: receipt.status,
          blockNumber: receipt.blockNumber.toString(),
          gasUsed: receipt.gasUsed.toString(),
        });

        if (receipt.status === 'reverted') {
          throw new Error('USDC approval transaction reverted');
        }

        toast({ title: 'Approval confirmed' });
      }

      // ----- Step 3: Submit intent order to backend -------------------------
      setState((s) => ({ ...s, step: 'submitting' }));

      const deadline = Math.floor(Date.now() / 1000) + INTENT_DEADLINE_SECONDS;

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

      console.log('[OceanBridge] step=submitting — POST /api/intent', body);

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
      console.log('[OceanBridge] /api/intent response', { status: res.status, ok: res.ok, data });

      if (!res.ok) {
        throw new Error(data.error || `Intent submission failed (${res.status})`);
      }

      // ----- Done -----------------------------------------------------------
      const submittedOrderId = data.order?.orderId ?? null;
      setState({
        step: 'done',
        approvalTxHash,
        orderId: submittedOrderId,
        error: null,
        isLoading: false,
      });

      console.log('[OceanBridge] ✅ step=done — order submitted', {
        orderId: submittedOrderId,
        approvalTxHash,
        order: data.order,
      });

      toast({ title: 'Bridge order submitted', description: `Order ID: ${submittedOrderId ?? 'N/A'}` });

      if (submittedOrderId) {
        subscribeToOrderEvents(submittedOrderId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bridge transaction failed';
      console.error('[OceanBridge] ❌ step=error', { message, error: err });
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
