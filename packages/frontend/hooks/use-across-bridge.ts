'use client';

import { useCallback, useRef, useState } from 'react';
import type { PublicClient } from 'viem';
import { useWalletClient } from 'wagmi';
import {
  createOriginPublicClient,
  executeApproval,
  executeQuote,
  getQuote,
  type AcrossQuote,
} from '@/lib/across/across';
import type { SupportedChain } from '@/lib/web3/web3';

export type BridgeStep = 'idle' | 'quoting' | 'approving' | 'bridging' | 'done' | 'error';

export interface BridgeState {
  // current step in the bridge pipeline
  step: BridgeStep;
  // fetched quote (available after "quoting" succeeds)
  quote: AcrossQuote | null;
  // tx hash of the bridge swap (available after "bridging" succeeds)
  txHash: `0x${string}` | null;
  // error message (set when step === "error")
  error: string | null;
  // true while any async work is in progress
  isLoading: boolean;
}

export interface UseAcrossBridgeReturn extends BridgeState {
  // run the full flow: quote -> approve -> swap. rejects if wallet is disconnected
  bridge: (params: BridgeParams) => Promise<void>;
  // reset state back to idle
  reset: () => void;
}

export interface BridgeParams {
  inputAmount: string;
  originChain: SupportedChain;
  destinationChain: SupportedChain;
  // depositor address (the connected wallet)
  depositor: `0x${string}`;
  // defaults to depositor if omitted
  recipient?: `0x${string}`;
}

const INITIAL_STATE: BridgeState = {
  step: 'idle',
  quote: null,
  txHash: null,
  error: null,
  isLoading: false,
};

export function useAcrossBridge(): UseAcrossBridgeReturn {
  const [state, setState] = useState<BridgeState>(INITIAL_STATE);
  const { data: walletClient } = useWalletClient();
  const walletClientRef = useRef(walletClient);
  walletClientRef.current = walletClient;

  // guard against double-submits
  const inflightRef = useRef(false);

  const reset = useCallback(() => {
    inflightRef.current = false;
    setState(INITIAL_STATE);
  }, []);

  const bridge = useCallback(async (params: BridgeParams) => {
    if (inflightRef.current) return;
    inflightRef.current = true;

    const { inputAmount, originChain, destinationChain, depositor } = params;
    const recipient = params.recipient ?? depositor;

    let publicClient: PublicClient;

    try {
      // step 1: quote
      setState({
        step: 'quoting',
        quote: null,
        txHash: null,
        error: null,
        isLoading: true,
      });

      const quote = await getQuote(
        inputAmount,
        { originChain, destinationChain },
        depositor,
        recipient
      );

      // step 2: approve
      setState((s) => ({ ...s, step: 'approving', quote }));

      const wc = walletClientRef.current;
      if (!wc) throw new Error('Wallet not connected');
      publicClient = createOriginPublicClient(originChain);

      await executeApproval(quote, wc, publicClient);

      // step 3: bridge
      setState((s) => ({ ...s, step: 'bridging' }));

      const txHash = await executeQuote(quote, wc, publicClient);

      // done
      setState((s) => ({ ...s, step: 'done', txHash, isLoading: false }));
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
  }, []);

  return { ...state, bridge, reset };
}
