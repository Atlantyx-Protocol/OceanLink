'use client';

import { useEffect, useState } from 'react';
import { useAccount, useReadContract, useSwitchChain } from 'wagmi';
import { erc20Abi, formatUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { InputCard } from './input-card';
import { BridgeStatus } from './bridge-status';
import { ArrowDownUp, Loader2 } from 'lucide-react';
import type { Network, Token } from './token-selector';
import { useOceanBridge } from '@/hooks/use-ocean-bridge';
import { getChainId, getUsdcAddress, type SupportedChain } from '@/lib/web3/web3';
import type { wagmiConfig } from '@/lib/wagmi';

type ConfiguredChainId = (typeof wagmiConfig)['chains'][number]['id'];
import { USDC_DECIMALS } from '@/hooks/funds/constants';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NETWORKS: Network[] = [
  { id: 'ethereum-sepolia', name: 'Ethereum Sepolia', icon: '\u27E0' },
  { id: 'arbitrum-sepolia', name: 'Arbitrum Sepolia', icon: '\uD83D\uDD35' },
  { id: 'base-sepolia', name: 'Base Sepolia', icon: '\uD83D\uDD37' },
];

const USDC_TOKEN: Token = {
  symbol: 'USDC',
  name: 'USD Coin',
  icon: '\uD83D\uDCB2',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

  const { step, orderId, approvalTxHash, error, isLoading, bridge, reset } = useOceanBridge();

  // ---- Derived state --------------------------------------------------------

  const srcChain = fromNetwork.id as SupportedChain;
  const desChain = toNetwork.id as SupportedChain;
  const srcChainId = getChainId(srcChain) as ConfiguredChainId;
  const isOnCorrectChain = connectedChainId === srcChainId;
  const parsedAmount = parseFloat(fromAmount) || 0;
  const hasValidAmount = parsedAmount > 0;

  // ---- Read USDC balance on source chain ------------------------------------

  const usdcAddress = getUsdcAddress(srcChain);

  const { data: rawBalance } = useReadContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    chainId: srcChainId,
    query: {
      enabled: isConnected && !!walletAddress,
      refetchInterval: 15_000,
    },
  });

  const formattedBalance =
    rawBalance !== undefined
      ? parseFloat(formatUnits(rawBalance, USDC_DECIMALS)).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : undefined;

  // Read balance on destination chain
  const desChainId = getChainId(desChain) as ConfiguredChainId;
  const desUsdcAddress = getUsdcAddress(desChain);

  const { data: rawDesBalance } = useReadContract({
    address: desUsdcAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    chainId: desChainId,
    query: {
      enabled: isConnected && !!walletAddress,
      refetchInterval: 15_000,
    },
  });

  const formattedDesBalance =
    rawDesBalance !== undefined
      ? parseFloat(formatUnits(rawDesBalance, USDC_DECIMALS)).toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : undefined;

  // ---- Reset bridge status when form changes --------------------------------

  useEffect(() => {
    if (step === 'done' || step === 'error') {
      // Don't auto-dismiss — user uses the X button
    }
  }, [fromAmount, fromNetwork, toNetwork]);

  // Reset form after successful bridge
  useEffect(() => {
    if (step === 'done') {
      setFromAmount('');
      setToAmount('');
    }
  }, [step]);

  // ---- Handlers -------------------------------------------------------------

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

    // Switch chain if needed
    if (!isOnCorrectChain) {
      switchChain({ chainId: srcChainId as ConfiguredChainId });
      return;
    }

    await bridge({
      amount: fromAmount,
      srcChain,
      desChain,
      userAddress: walletAddress,
    });
  };

  const formatUsdValue = (amount: string) => {
    const num = parseFloat(amount) || 0;
    return `\u2248 $${num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  // ---- Button label & state -------------------------------------------------

  const getButtonContent = () => {
    if (!isConnected) return null; // handled by Connect Wallet button

    if (isLoading) {
      const labels: Record<string, string> = {
        checking: 'Checking allowance...',
        approving: 'Waiting for approval...',
        submitting: 'Submitting order...',
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
    if (!isOnCorrectChain) return `Switch to ${fromNetwork.name}`;

    return 'Bridge';
  };

  const isButtonDisabled = isLoading || !hasValidAmount || fromNetwork.id === toNetwork.id;

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-3xl bg-secondary/50 p-3 md:p-4">
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
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <Button
              variant="secondary"
              size="icon"
              onClick={handleSwapDirection}
              disabled={isLoading}
              className="h-10 w-10 rounded-xl bg-secondary hover:bg-secondary/80 border border-border shadow-lg transition-transform hover:scale-105"
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

        {/* Bridge / Connect button */}
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

        {/* Status feedback */}
        <BridgeStatus
          step={step}
          orderId={orderId}
          approvalTxHash={approvalTxHash}
          error={error}
          onDismiss={reset}
        />
      </div>
    </div>
  );
}
