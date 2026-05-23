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
            className="group/pill relative flex items-center gap-2.5 h-auto py-2 pl-2 pr-3 rounded-2xl border border-border bg-gradient-to-b from-card to-secondary/40 hover:from-card hover:to-card hover:border-accent/30 hover:shadow-[0_0_0_4px_rgba(39,117,202,0.06),0_4px_12px_-4px_rgba(39,117,202,0.12)] transition-all duration-200"
          >
            <div className="relative flex h-8 w-8 items-center justify-center">
              <img
                src={token.icon}
                alt={token.symbol}
                className="h-8 w-8 rounded-full object-contain drop-shadow-[0_2px_4px_rgba(39,117,202,0.18)]"
              />
              <img
                src={network.icon}
                alt={network.name}
                className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full object-contain ring-2 ring-card"
              />
            </div>
            <div className="flex flex-col items-start leading-tight">
              <span className="text-sm font-semibold text-foreground">{token.symbol}</span>
              <span className="text-[10px] font-medium text-muted-foreground truncate max-w-[100px]">
                {network.name}
              </span>
            </div>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover/pill:translate-y-0.5" />
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
              <img src={net.icon} alt={net.name} className="h-5 w-5 rounded-full object-contain" />
              <span>{net.name}</span>
              {net.id === network.id && <span className="ml-auto text-accent">●</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {balance && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            Balance: <span className="text-foreground font-medium">{balance}</span>
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
