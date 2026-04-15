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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useOceanBridge() {
  const [state, setState] = useState<OceanBridgeState>(INITIAL_STATE);
  const { data: walletClient } = useWalletClient();
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

      const currentAllowance = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [userAddress, htlcAddress],
      });

      // ----- Step 2: Approve HTLC if allowance is insufficient ---------------
      let approvalTxHash: `0x${string}` | null = null;

      if (currentAllowance < amountWei) {
        setState((s) => ({ ...s, step: 'approving' }));

        if (!walletClient) throw new Error('Wallet not connected');

        const hash = await walletClient.writeContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [htlcAddress, amountWei],
          chain,
          account: userAddress,
        });

        approvalTxHash = hash;

        setState((s) => ({ ...s, approvalTxHash: hash }));

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === 'reverted') {
          throw new Error('USDC approval transaction reverted');
        }
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

      const res = await fetch('/api/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({ error: 'Invalid response' }));

      if (!res.ok) {
        throw new Error(data.error || `Intent submission failed (${res.status})`);
      }

      // ----- Done -----------------------------------------------------------
      setState({
        step: 'done',
        approvalTxHash,
        orderId: data.order?.orderId ?? null,
        error: null,
        isLoading: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Bridge transaction failed';
      setState((s) => ({
        ...s,
        step: 'error',
        error: message,
        isLoading: false,
      }));
    } finally {
      inflightRef.current = false;
    }
  }, [walletClient]);

  return { ...state, bridge, reset };
}
