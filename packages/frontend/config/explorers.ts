// chain explorer URL builders. accepts either a frontend SupportedChain id
// (kebab-case, e.g. 'ethereum-sepolia') or the backend chainKey (camelCase,
// e.g. 'arbitrumSepolia') — both surfaces emit different conventions.

const EXPLORER_TX_BASE: Record<string, string> = {
  // backend chainKey
  sepolia: 'https://sepolia.etherscan.io/tx/',
  arbitrumSepolia: 'https://sepolia.arbiscan.io/tx/',
  baseSepolia: 'https://sepolia.basescan.org/tx/',
  // frontend SupportedChain
  'ethereum-sepolia': 'https://sepolia.etherscan.io/tx/',
  'arbitrum-sepolia': 'https://sepolia.arbiscan.io/tx/',
  'base-sepolia': 'https://sepolia.basescan.org/tx/',
};

export function getExplorerTxUrl(chain: string, txHash: string): string | undefined {
  const base = EXPLORER_TX_BASE[chain];
  return base ? `${base}${txHash}` : undefined;
}

export function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}
