'use client';

import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { sepolia, arbitrumSepolia, baseSepolia } from 'wagmi/chains';
import { AlertTriangle, LogOut, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SUPPORTED_CHAINS } from '@/lib/wagmi';
import { truncateAddress } from '@/lib/format';

const CHAIN_ICONS: Record<number, string> = {
  [sepolia.id]: '/ethereum.png',
  [arbitrumSepolia.id]: '/arbitrum.png',
  [baseSepolia.id]: '/base.png',
};

export function ConnectWalletButton() {
  const t = useTranslations('wallet');
  const { address, chainId, isConnected, isConnecting, isReconnecting } = useAccount();
  const { connect, connectors, isPending: isConnectPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitchPending } = useSwitchChain();
  const [menuOpen, setMenuOpen] = useState(false);

  const isSupportedChain = chainId !== undefined && SUPPORTED_CHAINS.some((c) => c.id === chainId);
  const isBusyConnecting = isConnecting || isReconnecting || isConnectPending;

  if (!isConnected) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={isBusyConnecting}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Wallet className="h-4 w-4 mr-2" />
            {isBusyConnecting ? t('connecting') : t('connect')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t('chooseWallet')}</DropdownMenuLabel>
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

  if (!isSupportedChain) {
    return (
      <Button
        variant="destructive"
        disabled={isSwitchPending}
        onClick={() => switchChain({ chainId: SUPPORTED_CHAINS[0].id })}
      >
        <AlertTriangle className="h-4 w-4 mr-2" />
        {isSwitchPending ? t('switching') : t('wrongNetwork')}
      </Button>
    );
  }

  const activeChain = SUPPORTED_CHAINS.find((c) => c.id === chainId);
  const activeChainIcon = chainId !== undefined ? CHAIN_ICONS[chainId] : undefined;

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          {activeChainIcon ? (
            <img
              src={activeChainIcon}
              alt={activeChain?.name ?? ''}
              className="h-4 w-4 mr-2 rounded-full object-contain"
            />
          ) : (
            <Wallet className="h-4 w-4 mr-2" />
          )}
          {address ? truncateAddress(address) : ''}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
          {activeChainIcon && (
            <img src={activeChainIcon} alt="" className="h-4 w-4 rounded-full object-contain" />
          )}
          {activeChain?.name ?? `Chain ${chainId}`}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {t('switchNetwork')}
        </DropdownMenuLabel>
        {SUPPORTED_CHAINS.map((c) => (
          <DropdownMenuItem
            key={c.id}
            disabled={c.id === chainId || isSwitchPending}
            onClick={() => switchChain({ chainId: c.id })}
            className="flex items-center gap-2"
          >
            {CHAIN_ICONS[c.id] && (
              <img src={CHAIN_ICONS[c.id]} alt="" className="h-4 w-4 rounded-full object-contain" />
            )}
            <span>{c.name}</span>
            {c.id === chainId && <span className="ml-auto">✓</span>}
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
          {t('disconnect')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
