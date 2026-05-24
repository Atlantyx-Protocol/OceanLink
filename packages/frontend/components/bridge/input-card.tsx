'use client';

import { Input } from '@/components/ui/input';
import { truncateAddress } from '@/lib/format';
import { TokenSelector, type Network, type Token } from './token-selector';

const DECIMAL_PATTERN = /^\d*\.?\d*$/;

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
  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (DECIMAL_PATTERN.test(value)) onAmountChange(value);
  };

  // strip thousand separators before propagating MAX so parsing stays clean
  const handleMaxClick = balance ? () => onAmountChange(balance.replace(/,/g, '')) : undefined;

  return (
    <div className="group rounded-2xl bg-background/60 border border-border/70 p-5 md:p-6 transition-all duration-200 hover:border-border focus-within:border-accent/40 focus-within:bg-background/80 focus-within:shadow-[inset_0_0_0_1px_rgba(39,117,202,0.08)]">
      <div className="flex items-center justify-between mb-5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </span>
        {showAddress && address && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary/80 px-2.5 py-1 text-[11px] text-muted-foreground">
            <span className="hidden sm:inline">{addressLabel}</span>
            <span className="font-mono text-foreground/90">{truncateAddress(address)}</span>
          </span>
        )}
      </div>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          <Input
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            disabled={disabled}
            onChange={handleAmountChange}
            className="border-0 bg-transparent text-4xl md:text-[42px] font-semibold tracking-tight text-foreground placeholder:text-muted-foreground/25 p-0 h-auto leading-none rounded-none shadow-none focus-visible:ring-0 focus-visible:outline-none transition-colors"
          />
          <span className="text-xs font-medium text-muted-foreground/80">{equivalentValue}</span>
        </div>
        <TokenSelector
          token={token}
          network={network}
          networks={networks}
          onNetworkChange={onNetworkChange}
          balance={balance}
          onMaxClick={handleMaxClick}
        />
      </div>
    </div>
  );
}
