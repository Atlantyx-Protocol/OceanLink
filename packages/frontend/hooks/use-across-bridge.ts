"use client"

import { useCallback, useRef, useState } from "react"
import type { PublicClient } from "viem"
import { getWalletClient } from "@/lib/walletClient"
import {
  createOriginPublicClient,
  executeApproval,
  executeQuote,
  getQuote,
  type AcrossQuote,
} from "@/lib/across/across"
import type { SupportedChain } from "@/lib/web3/web3"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BridgeStep = "idle" | "quoting" | "approving" | "bridging" | "done" | "error"

export interface BridgeState {
  /** Current step in the bridge pipeline. */
  step: BridgeStep
  /** The fetched quote (available after "quoting" succeeds). */
  quote: AcrossQuote | null
  /** Transaction hash of the bridge swap (available after "bridging" succeeds). */
  txHash: `0x${string}` | null
  /** Human-readable error message (set when step === "error"). */
  error: string | null
  /** True while any async work is in progress. */
  isLoading: boolean
}

export interface UseAcrossBridgeReturn extends BridgeState {
  /**
   * Kick off the full bridge flow: quote -> approve -> swap.
   * Rejects if the wallet is disconnected.
   */
  bridge: (params: BridgeParams) => Promise<void>
  /** Reset state back to idle (e.g. after closing a success/error dialog). */
  reset: () => void
}

export interface BridgeParams {
  inputAmount: string
  originChain: SupportedChain
  destinationChain: SupportedChain
  /** Depositor address (the connected wallet). */
  depositor: `0x${string}`
  /** Recipient address (defaults to depositor if omitted). */
  recipient?: `0x${string}`
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const INITIAL_STATE: BridgeState = {
  step: "idle",
  quote: null,
  txHash: null,
  error: null,
  isLoading: false,
}

export function useAcrossBridge(): UseAcrossBridgeReturn {
  const [state, setState] = useState<BridgeState>(INITIAL_STATE)

  // Guard against double-submits
  const inflightRef = useRef(false)

  const reset = useCallback(() => {
    inflightRef.current = false
    setState(INITIAL_STATE)
  }, [])

  const bridge = useCallback(async (params: BridgeParams) => {
    if (inflightRef.current) return
    inflightRef.current = true

    const { inputAmount, originChain, destinationChain, depositor } = params
    const recipient = params.recipient ?? depositor

    let publicClient: PublicClient

    try {
      // --- Step 1: Quote ------------------------------------------------
      setState({
        step: "quoting",
        quote: null,
        txHash: null,
        error: null,
        isLoading: true,
      })

      const quote = await getQuote(
        inputAmount,
        { originChain, destinationChain },
        depositor,
        recipient,
      )

      // --- Step 2: Approve ----------------------------------------------
      setState((s) => ({ ...s, step: "approving", quote }))

      const walletClient = getWalletClient()
      publicClient = createOriginPublicClient(originChain)

      await executeApproval(quote, walletClient, publicClient)

      // --- Step 3: Bridge ------------------------------------------------
      setState((s) => ({ ...s, step: "bridging" }))

      const txHash = await executeQuote(quote, walletClient, publicClient)

      // --- Done ----------------------------------------------------------
      setState((s) => ({ ...s, step: "done", txHash, isLoading: false }))
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Bridge transaction failed"
      setState((s) => ({
        ...s,
        step: "error",
        error: message,
        isLoading: false,
      }))
    } finally {
      inflightRef.current = false
    }
  }, [])

  return { ...state, bridge, reset }
}
