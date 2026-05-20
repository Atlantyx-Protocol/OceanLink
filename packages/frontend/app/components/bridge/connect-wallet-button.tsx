'use client';

import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AlertTriangle, LogOut, Wallet } from 'lucide-react';
import { SUPPORTED_CHAINS } from '@/lib/wagmi';

function truncate(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function ConnectWalletButton() {
  const { address, chainId, isConnected, isConnecting, isReconnecting } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();
  const [menuOpen, setMenuOpen] = useState(false);

  const isSupportedChain = chainId !== undefined && SUPPORTED_CHAINS.some((c) => c.id === chainId);

  // disconnected — show connector picker
  if (!isConnected) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={isConnecting || isReconnecting || isConnectPending}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Wallet className="h-4 w-4 mr-2" />
            {isConnecting || isReconnecting || isConnectPending
              ? 'Connecting...'
              : 'Connect Wallet'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Choose a wallet</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {connectors.map((connector) => (
            <DropdownMenuItem key={connector.uid} onClick={() => connect({ connector })}>
              {connector.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // connected on wrong network — prompt switch
  if (!isSupportedChain) {
    return (
      <Button
        variant="destructive"
        disabled={isSwitchPending}
        onClick={() => switchChain({ chainId: SUPPORTED_CHAINS[0].id })}
      >
        <AlertTriangle className="h-4 w-4 mr-2" />
        {isSwitchPending ? 'Switching...' : 'Wrong Network'}
      </Button>
    );
  }

  // connected — show address + dropdown
  const activeChain = SUPPORTED_CHAINS.find((c) => c.id === chainId);

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Wallet className="h-4 w-4 mr-2" />
          {address ? truncate(address) : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {activeChain?.name ?? `Chain ${chainId}`}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Switch network
        </DropdownMenuLabel>
        {SUPPORTED_CHAINS.map((c) => (
          <DropdownMenuItem
            key={c.id}
            disabled={c.id === chainId || isSwitchPending}
            onClick={() => switchChain({ chainId: c.id })}
          >
            {c.name}
            {c.id === chainId ? ' ✓' : ''}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            disconnect();
            setMenuOpen(false);
          }}
          className="text-destructive focus:text-destructive"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
