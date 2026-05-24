import { SUPPORTED_CHAINS } from '@/config/chains';
import type { Network, Token } from './token-selector';

export const NETWORKS: Network[] = [
  { id: SUPPORTED_CHAINS.ETHEREUM, name: 'Ethereum Sepolia', icon: '/ethereum.png' },
  { id: SUPPORTED_CHAINS.ARBITRUM, name: 'Arbitrum Sepolia', icon: '/arbitrum.png' },
  { id: SUPPORTED_CHAINS.BASE, name: 'Base Sepolia', icon: '/base.png' },
];

export const USDC_TOKEN: Token = {
  symbol: 'USDC',
  name: 'USD Coin',
  icon: '/usdc.png',
};
