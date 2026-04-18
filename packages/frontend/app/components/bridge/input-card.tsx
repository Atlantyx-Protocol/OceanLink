'use client';

import { Input } from '@/components/ui/input';
import { TokenSelector, type Network, type Token } from './token-selector';

interface InputCardProps {
  label: string;
  amount: string;
  onAmountChange: (value: string) => void;
  equivalentValue: string;
  token: Token;
  network: Network;
  networks: Network[];
  onNetworkChange: (network: Network) => void;
  balance?: string;
  address?: string;
  showAddress?: boolean;
  addressLabel?: string;
  disabled?: boolean;
}

export function InputCard({
  label,
  amount,
  onAmountChange,
  equivalentValue,
  token,
  network,
  networks,
  onNetworkChange,
  balance,
  address,
  showAddress = false,
  addressLabel = 'Address',
  disabled = false,
}: InputCardProps) {
  return (
    <div className="rounded-2xl bg-card border border-border/50 p-4 md:p-5 transition-colors duration-200 focus-within:border-accent/40">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {showAddress && address && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-0.5 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{addressLabel}</span>
            <span className="font-mono text-foreground">
              {address.slice(0, 6)}...{address.slice(-4)}
            </span>
          </span>
        )}
      </div>

      {/* Input + Token selector */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1.5 flex-1 min-w-0">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            disabled={disabled}
            onChange={(e) => {
              const value = e.target.value;
              if (/^\d*\.?\d*$/.test(value)) {
                onAmountChange(value);
              }
            }}
            className="border-0 bg-transparent text-3xl md:text-4xl font-bold text-foreground placeholder:text-muted-foreground/30 p-0 h-auto focus-visible:ring-0 transition-colors"
          />
          <span className="text-xs text-muted-foreground/70">{equivalentValue}</span>
        </div>
        <TokenSelector
          token={token}
          network={network}
          networks={networks}
          onNetworkChange={onNetworkChange}
          balance={balance}
          onMaxClick={balance ? () => onAmountChange(balance.replace(/,/g, '')) : undefined}
        />
      </div>
    </div>
  );
}
