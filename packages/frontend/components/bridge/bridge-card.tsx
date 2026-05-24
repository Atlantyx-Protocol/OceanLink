'use client';

import { useEffect, useState } from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { ArrowDownUp, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { InputCard } from './input-card';
import { BridgeStatus } from './bridge-status';
import { BridgeSettings } from './bridge-settings';
import { NETWORKS, USDC_TOKEN } from './networks';
import { useBridge, type OrderStatus } from '@/hooks/use-bridge';
import { useUsdcBalance } from '@/hooks/use-usdc-balance';
import { getChainId, type SupportedChain } from '@/config/chains';
import { formatUsdEquivalent } from '@/lib/format';
import type { wagmiConfig } from '@/lib/wagmi';

type ConfiguredChainId = (typeof wagmiConfig)['chains'][number]['id'];

const DEFAULT_DEADLINE_MINUTES = '30';

const TRACKING_LABEL_KEY: Record<OrderStatus, string> = {
  QUEUED: 'pending',
  PARTIAL: 'partial',
  MATCHED: 'settling',
  COMPLETED: 'pending',
  FAILED: 'pending',
  EXPIRED: 'pending',
};

interface BridgeCardProps {
  isConnected: boolean;
  onConnectWallet: () => void;
}

export function BridgeCard({ isConnected, onConnectWallet }: BridgeCardProps) {
  const t = useTranslations('bridge');
  const { address: walletAddress, chainId: connectedChainId } = useAccount();
  const { switchChain } = useSwitchChain();

  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [fromNetwork, setFromNetwork] = useState(NETWORKS[0]);
  const [toNetwork, setToNetwork] = useState(NETWORKS[1]);
  const [deadlineMinutes, setDeadlineMinutes] = useState(DEFAULT_DEADLINE_MINUTES);

  const { step, orderStatus, error, isLoading, bridge, reset } = useBridge();

  const srcChain = fromNetwork.id as SupportedChain;
  const desChain = toNetwork.id as SupportedChain;
  const srcChainId = getChainId(srcChain) as ConfiguredChainId;
  const isOnCorrectChain = connectedChainId === srcChainId;
  const parsedAmount = parseFloat(fromAmount) || 0;
  const hasValidAmount = parsedAmount > 0;

  const srcBalance = useUsdcBalance(srcChain, walletAddress, { enabled: isConnected });
  const desBalance = useUsdcBalance(desChain, walletAddress, { enabled: isConnected });

  const insufficientBalance =
    isConnected &&
    hasValidAmount &&
    srcBalance.value !== undefined &&
    parsedAmount > srcBalance.value;

  // refetch balances immediately when settlement completes so the UI updates
  // without waiting for the next poll tick
  useEffect(() => {
    if (step === 'done') {
      setFromAmount('');
      setToAmount('');
      void srcBalance.refetch();
      void desBalance.refetch();
    }
  }, [step, srcBalance.refetch, desBalance.refetch]);

  const handleSwapDirection = () => {
    if (isLoading) return;
    setFromNetwork(toNetwork);
    setToNetwork(fromNetwork);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  const handleAmountChange = (value: string) => {
    setFromAmount(value);
    setToAmount(value);
  };

  const handleBridge = async () => {
    if (!walletAddress || !hasValidAmount) return;

    if (!isOnCorrectChain) {
      switchChain({ chainId: srcChainId });
      return;
    }

    const minutes = Math.max(1, parseInt(deadlineMinutes, 10) || 30);

    await bridge({
      amount: fromAmount,
      srcChain,
      desChain,
      userAddress: walletAddress,
      deadlineSeconds: minutes * 60,
    });
  };

  const buttonLabel = () => {
    if (isLoading) {
      if (step === 'tracking') {
        const key = orderStatus ? TRACKING_LABEL_KEY[orderStatus] : 'pending';
        return t(`step.${key}`);
      }
      if (step === 'checking') return t('step.checking');
      if (step === 'approving') return t('step.approving');
      if (step === 'submitting') return t('step.submitting');
      return t('step.processing');
    }

    if (!hasValidAmount) return t('enterAmount');
    if (fromNetwork.id === toNetwork.id) return t('differentNetworks');
    if (insufficientBalance) return t('insufficientBalance');
    if (!isOnCorrectChain) return t('switchTo', { chain: fromNetwork.name });
    return t('bridgeButton');
  };

  const buttonDisabled =
    isLoading || !hasValidAmount || fromNetwork.id === toNetwork.id || insufficientBalance;

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="rounded-[24px] bg-card border border-border/60 p-4 md:p-5 shadow-[0_8px_30px_-12px_rgba(17,17,17,0.08),0_2px_8px_-3px_rgba(17,17,17,0.04)] dark:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.5)]">
        <BridgeSettings
          deadlineMinutes={deadlineMinutes}
          onDeadlineChange={setDeadlineMinutes}
        />

        <InputCard
          label={t('from')}
          amount={fromAmount}
          onAmountChange={handleAmountChange}
          equivalentValue={formatUsdEquivalent(fromAmount)}
          token={USDC_TOKEN}
          network={fromNetwork}
          networks={NETWORKS}
          onNetworkChange={(n) => !isLoading && setFromNetwork(n)}
          balance={isConnected ? srcBalance.formatted : undefined}
          address={walletAddress}
          showAddress={isConnected && !!walletAddress}
          addressLabel={t('from')}
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
          label={t('to')}
          amount={toAmount}
          onAmountChange={handleAmountChange}
          equivalentValue={formatUsdEquivalent(toAmount)}
          token={USDC_TOKEN}
          network={toNetwork}
          networks={NETWORKS}
          onNetworkChange={(n) => !isLoading && setToNetwork(n)}
          balance={isConnected ? desBalance.formatted : undefined}
          address={walletAddress}
          showAddress={isConnected && !!walletAddress}
          addressLabel={t('to')}
          disabled={isLoading}
        />

        <div className="mt-4">
          {isConnected ? (
            <Button
              className="w-full h-14 text-base font-semibold rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground"
              disabled={buttonDisabled}
              onClick={handleBridge}
              aria-busy={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {buttonLabel()}
                </span>
              ) : (
                buttonLabel()
              )}
            </Button>
          ) : (
            <Button
              onClick={onConnectWallet}
              className="w-full h-14 text-base font-semibold rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {t('connectWallet')}
            </Button>
          )}
        </div>

        <BridgeStatus step={step} error={error} onDismiss={reset} />
      </div>
    </div>
  );
}
