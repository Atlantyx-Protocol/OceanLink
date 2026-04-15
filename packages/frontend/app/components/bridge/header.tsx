'use client';

import { Button } from '@/components/ui/button';
import { Menu, Waves } from 'lucide-react';
import { ConnectWalletButton } from './connect-wallet-button';

export function Header() {
  return (
    <header className="flex items-center justify-between px-4 py-4 md:px-6">
      <div className="flex items-center gap-8">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent">
            <Waves className="h-5 w-5 text-accent-foreground" />
          </div>
          <span className="text-lg font-semibold text-foreground">OceanLink</span>
        </div>
        <nav className="hidden md:flex items-center gap-1">
          <Button variant="ghost" className="relative text-foreground hover:bg-secondary">
            Bridge
            <span className="absolute bottom-0 left-1/2 h-0.5 w-6 -translate-x-1/2 bg-accent rounded-full" />
          </Button>
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <ConnectWalletButton />
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}
