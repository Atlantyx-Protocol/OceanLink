import { formatUnits } from 'viem';
import { USDC_DECIMALS } from '@/config/constants';

const USDC_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

export function formatUsdcNumber(value: number): string {
  return value.toLocaleString('en-US', USDC_FORMAT_OPTIONS);
}

export function formatUsdcFromRaw(raw: bigint): string {
  const value = parseFloat(formatUnits(raw, USDC_DECIMALS));
  return formatUsdcNumber(value);
}

// formats a human-readable amount (e.g. "10.5") into "≈ $10.50"
export function formatUsdEquivalent(amount: string): string {
  const value = parseFloat(amount) || 0;
  return `≈ $${formatUsdcNumber(value)}`;
}

export function truncateAddress(address: string, leading = 6, trailing = 4): string {
  return `${address.slice(0, leading)}...${address.slice(-trailing)}`;
}

export function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}
