'use client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown } from 'lucide-react';

export interface Network {
  id: string;
  name: string;
  icon: string;
}

export interface Token {
  symbol: string;
  name: string;
  icon: string;
}

interface TokenSelectorProps {
  token: Token;
  network: Network;
  networks: Network[];
  onNetworkChange: (network: Network) => void;
  balance?: string;
  onMaxClick?: () => void;
}

export function TokenSelector({
  token,
  network,
  networks,
  onNetworkChange,
  balance,
  onMaxClick,
}: TokenSelectorProps) {
  return (
    <div className="flex flex-col items-end gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            className="flex items-center gap-2 h-auto py-2 px-3 hover:bg-secondary/80 rounded-xl border border-border transition-colors"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-background text-base">
              {token.icon}
            </div>
            <div className="flex flex-col items-start">
              <span className="text-sm font-semibold text-foreground">{token.symbol}</span>
              <span className="text-xs text-muted-foreground truncate max-w-[100px]">
                {network.name}
              </span>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Select Network
          </div>
          {networks.map((net) => (
            <DropdownMenuItem
              key={net.id}
              onClick={() => onNetworkChange(net)}
              className="flex items-center gap-2 cursor-pointer"
            >
              <span className="text-lg">{net.icon}</span>
              <span>{net.name}</span>
              {net.id === network.id && <span className="ml-auto text-accent">●</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {balance && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            Bal: <span className="text-foreground font-medium">{balance}</span>
          </span>
          {onMaxClick && (
            <button
              type="button"
              onClick={onMaxClick}
              className="font-semibold text-accent hover:text-accent/80 transition-colors cursor-pointer"
            >
              MAX
            </button>
          )}
        </div>
      )}
    </div>
  );
}
