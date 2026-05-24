'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useReadContract, useSwitchChain } from 'wagmi';
import { erc20Abi, formatUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { InputCard } from './input-card';
import { BridgeStatus } from './bridge-status';
import { ArrowDownUp, Loader2, Settings, X } from 'lucide-react';
import type { Network, Token } from './token-selector';
import { useOceanBridge } from '@/hooks/use-ocean-bridge';
import { getChainId, getUsdcAddress, type SupportedChain } from '@/lib/web3/web3';
import type { wagmiConfig } from '@/lib/wagmi';

type ConfiguredChainId = (typeof wagmiConfig)['chains'][number]['id'];
import { USDC_DECIMALS } from '@/hooks/funds/constants';

const NETWORKS: Network[] = [
  { id: 'ethereum-sepolia', name: 'Ethereum Sepolia', icon: '/ethereum.png' },
  { id: 'arbitrum-sepolia', name: 'Arbitrum Sepolia', icon: '/arbitrum.png' },
  { id: 'base-sepolia', name: 'Base Sepolia', icon: '/base.png' },
];

const USDC_TOKEN: Token = {
  symbol: 'USDC',
  name: 'USD Coin',
  icon: '/usdc.png',
};

interface BridgeCardProps {
  isConnected: boolean;
  onConnectWallet: () => void;
}

export function BridgeCard({ isConnected, onConnectWallet }: BridgeCardProps) {
  const { address: walletAddress, chainId: connectedChainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [fromNetwork, setFromNetwork] = useState(NETWORKS[0]);
  const [toNetwork, setToNetwork] = useState(NETWORKS[1]);

  // bridge settings — defaults match backend INTENT_DEADLINE_SECONDS (30 min)
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deadlineMinutes, setDeadlineMinutes] = useState('30');
  const [incentiveFee, setIncentiveFee] = useState('');
  const settingsRef = useRef<HTMLDivElement>(null);

  // close popup when clicking outside
  useEffect(() => {
    if (!settingsOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [settingsOpen]);

  const { step, orderStatus, error, isLoading, bridge, reset } = useOceanBridge();

  // derived state
  const srcChain = fromNetwork.id as SupportedChain;
  const desChain = toNetwork.id as SupportedChain;
  const srcChainId = getChainId(srcChain) as ConfiguredChainId;
  const isOnCorrectChain = connectedChainId === srcChainId;
  const parsedAmount = parseFloat(fromAmount) || 0;
  const hasValidAmount = parsedAmount > 0;

  // read USDC balance on source chain
  const usdcAddress = getUsdcAddress(srcChain);

  const { data: rawBalance, refetch: refetchSrcBalance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    chainId: srcChainId,
    query: {
      enabled: isConnected && !!walletAddress,
      refetchInterval: 5_000,
    },
  });

  const balanceNum =
    rawBalance !== undefined ? parseFloat(formatUnits(rawBalance, USDC_DECIMALS)) : undefined;

  const formattedBalance =
    balanceNum !== undefined
      ? balanceNum.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : undefined;

  // true once balance has loaded and the typed amount exceeds it
  const insufficientBalance =
    isConnected && hasValidAmount && balanceNum !== undefined && parsedAmount > balanceNum;

  // read balance on destination chain
  const desChainId = getChainId(desChain) as ConfiguredChainId;
  const desUsdcAddress = getUsdcAddress(desChain);

  const { data: rawDesBalance, refetch: refetchDesBalance } = useReadContract({
    address: desUsdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    chainId: desChainId,
    query: {
      enabled: isConnected && !!walletAddress,
      refetchInterval: 5_000,
    },
  });

  const formattedDesBalance =
    rawDesBalance !== undefined
      ? parseFloat(formatUnits(rawDesBalance, USDC_DECIMALS)).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : undefined;

  // reset bridge status when form changes
  useEffect(() => {
    if (step === 'done' || step === 'error') {
      // don't auto-dismiss — user uses the X button
    }
  }, [fromAmount, fromNetwork, toNetwork]);

  // reset form after a successful bridge and refetch balances immediately so
  // the UI reflects on-chain settlement without waiting for the next poll tick.
  useEffect(() => {
    if (step === 'done') {
      setFromAmount('');
      setToAmount('');
      void refetchSrcBalance();
      void refetchDesBalance();
    }
  }, [step, refetchSrcBalance, refetchDesBalance]);

  // handlers
  const handleSwapDirection = () => {
    if (isLoading) return;
    const tempNetwork = fromNetwork;
    const tempAmount = fromAmount;
    setFromNetwork(toNetwork);
    setToNetwork(tempNetwork);
    setFromAmount(toAmount);
    setToAmount(tempAmount);
  };

  const handleFromAmountChange = (value: string) => {
    setFromAmount(value);
    setToAmount(value);
  };

  const handleToAmountChange = (value: string) => {
    setToAmount(value);
    setFromAmount(value);
  };

  const handleBridge = async () => {
    if (!walletAddress || !hasValidAmount) return;

    // switch chain if needed
    if (!isOnCorrectChain) {
      switchChain({ chainId: srcChainId as ConfiguredChainId });
      return;
    }

    const parsedDeadlineMin = Math.max(1, parseInt(deadlineMinutes, 10) || 30);
    const trimmedFee = incentiveFee.trim();

    await bridge({
      amount: fromAmount,
      srcChain,
      desChain,
      userAddress: walletAddress,
      deadlineSeconds: parsedDeadlineMin * 60,
      ...(trimmedFee && parseFloat(trimmedFee) > 0 ? { incentiveFee: trimmedFee } : {}),
    });
  };

  const formatUsdValue = (amount: string) => {
    const num = parseFloat(amount) || 0;
    return `\u2248 $${num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  // button label & state
  const getButtonContent = () => {
    if (!isConnected) return null; // handled by connect wallet button

    if (isLoading) {
      // during 'tracking' the label mirrors the order status from /activity so
      // user sees the same wording across surfaces.
      const trackingLabel: Record<string, string> = {
        QUEUED: 'Pending match...',
        PARTIAL: 'Partial match...',
        MATCHED: 'Settling...',
      };
      const labels: Record<string, string> = {
        checking: 'Checking allowance...',
        approving: 'Waiting for approval...',
        submitting: 'Submitting order...',
        tracking: (orderStatus && trackingLabel[orderStatus]) ?? 'Pending match...',
      };
      return (
        <span className="flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin" />
          {labels[step] ?? 'Processing...'}
        </span>
      );
    }

    if (!hasValidAmount) return 'Enter an amount';
    if (fromNetwork.id === toNetwork.id) return 'Select different networks';
    if (insufficientBalance) return 'Insufficient USDC balance';
    if (!isOnCorrectChain) return `Switch to ${fromNetwork.name}`;

    return 'Bridge';
  };

  const isButtonDisabled =
    isLoading || !hasValidAmount || fromNetwork.id === toNetwork.id || insufficientBalance;

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-[24px] bg-card border border-border/60 p-4 md:p-5 shadow-[0_8px_30px_-12px_rgba(17,17,17,0.08),0_2px_8px_-3px_rgba(17,17,17,0.04)] dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]">
        {/* card header with settings toggle */}
        <div className="relative flex items-center justify-end mb-2" ref={settingsRef}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSettingsOpen((v) => !v)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Bridge settings"
            aria-expanded={settingsOpen}
          >
            <Settings className="h-4 w-4" />
          </Button>

          {settingsOpen && (
            <div className="absolute right-0 top-full mt-2 z-20 w-72 rounded-2xl border border-border bg-card p-4 shadow-[0_8px_24px_-8px_rgba(17,17,17,0.16)]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-foreground">Settings</span>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Close settings"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label
                    htmlFor="bridge-deadline"
                    className="block text-xs font-medium text-muted-foreground mb-1"
                  >
                    Swap expiration
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="bridge-deadline"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={deadlineMinutes}
                      onChange={(e) => setDeadlineMinutes(e.target.value)}
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                    <span className="text-xs text-muted-foreground">minutes</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground/80">
                    Order expires if not matched within this window. Min 1.
                  </p>
                </div>

                <div>
                  <label
                    htmlFor="bridge-incentive"
                    className="block text-xs font-medium text-muted-foreground mb-1"
                  >
                    Incentive fee
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="bridge-incentive"
                      type="text"
                      placeholder="Coming soon"
                      value=""
                      disabled
                      readOnly
                      className="flex-1 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-sm text-muted-foreground placeholder:text-muted-foreground cursor-not-allowed focus:outline-none"
                    />
                    <span className="text-xs text-muted-foreground/60">USDC</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground/80">
                    Extra USDC paid to LPs to prioritise your order.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <InputCard
          label="From"
          amount={fromAmount}
          onAmountChange={handleFromAmountChange}
          equivalentValue={formatUsdValue(fromAmount)}
          token={USDC_TOKEN}
          network={fromNetwork}
          networks={NETWORKS}
          onNetworkChange={(n) => {
            if (!isLoading) setFromNetwork(n);
          }}
          balance={isConnected ? formattedBalance : undefined}
          address={walletAddress}
          showAddress={isConnected && !!walletAddress}
          addressLabel="From"
          disabled={isLoading}
        />

        <div className="relative py-2">
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
            <Button
              variant="secondary"
              size="icon"
              onClick={handleSwapDirection}
              disabled={isLoading}
              className="h-11 w-11 rounded-2xl bg-card/80 hover:bg-card backdrop-blur-md border border-border ring-4 ring-card shadow-[0_4px_16px_-2px_rgba(17,17,17,0.08),0_2px_4px_-1px_rgba(17,17,17,0.06)] transition-all hover:scale-105 hover:shadow-[0_6px_20px_-2px_rgba(39,117,202,0.18),0_2px_6px_-1px_rgba(17,17,17,0.06)] hover:border-accent/40"
            >
              <ArrowDownUp className="h-4 w-4 text-foreground" />
            </Button>
          </div>
        </div>

        <InputCard
          label="To"
          amount={toAmount}
          onAmountChange={handleToAmountChange}
          equivalentValue={formatUsdValue(toAmount)}
          token={USDC_TOKEN}
          network={toNetwork}
          networks={NETWORKS}
          onNetworkChange={(n) => {
            if (!isLoading) setToNetwork(n);
          }}
          balance={isConnected ? formattedDesBalance : undefined}
          address={walletAddress}
          showAddress={isConnected && !!walletAddress}
          addressLabel="To"
          disabled={isLoading}
        />

        {/* bridge / connect button */}
        <div className="mt-4">
          {isConnected ? (
            <Button
              className="w-full h-14 text-base font-semibold rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground"
              disabled={isButtonDisabled}
              onClick={handleBridge}
              aria-busy={isLoading}
            >
              {getButtonContent()}
            </Button>
          ) : (
            <Button
              onClick={onConnectWallet}
              className="w-full h-14 text-base font-semibold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Connect Wallet
            </Button>
          )}
        </div>

        {/* status feedback */}
        <BridgeStatus step={step} error={error} onDismiss={reset} />
      </div>
    </div>
  );
}
