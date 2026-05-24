import { sepolia, arbitrumSepolia, baseSepolia } from 'wagmi/chains';

export interface ChainMeta {
  name: string;
  short: string;
  icon: string;
}

export const CHAIN_META: Record<number, ChainMeta> = {
  [sepolia.id]: { name: 'Ethereum Sepolia', short: 'Ethereum', icon: '/ethereum.png' },
  [arbitrumSepolia.id]: { name: 'Arbitrum Sepolia', short: 'Arbitrum', icon: '/arbitrum.png' },
  [baseSepolia.id]: { name: 'Base Sepolia', short: 'Base', icon: '/base.png' },
};
