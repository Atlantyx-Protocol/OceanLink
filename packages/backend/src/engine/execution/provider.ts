// ---------------------------------------------------------------------------
// Shared provider & signer factory
//
// Caches JsonRpcProvider and NonceManager instances per chain to avoid
// creating new connections on every call.
// ---------------------------------------------------------------------------

import { JsonRpcProvider, NonceManager, Wallet, Contract } from 'ethers';
import { getChainConfig } from '../../config/chains.js';
import { ERC20_ABI, HTLC_ABI } from './abi.js';

const providers = new Map<string, JsonRpcProvider>();
const signers = new Map<string, NonceManager>();

export function getAdminKey(): string {
  const key = process.env.PRIVATE_KEY_ADMIN;
  if (!key) throw new Error('PRIVATE_KEY_ADMIN is not configured in environment');
  return key;
}

export function getProvider(chainKey: string): JsonRpcProvider {
  let provider = providers.get(chainKey);
  if (!provider) {
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    provider = new JsonRpcProvider(config.rpcUrl);
    providers.set(chainKey, provider);
  }
  return provider;
}

export function getAdminSigner(chainKey: string): NonceManager {
  const adminKey = getAdminKey();
  const address = new Wallet(adminKey).address;
  const cacheKey = `${chainKey}:${address}`;
  let signer = signers.get(cacheKey);
  if (!signer) {
    const wallet = new Wallet(adminKey, getProvider(chainKey));
    signer = new NonceManager(wallet);
    signers.set(cacheKey, signer);
  }
  return signer;
}

export function getHTLCContract(
  chainKey: string,
  signerOrProvider?: NonceManager | JsonRpcProvider
): Contract {
  const config = getChainConfig(chainKey);
  if (!config) throw new Error(`Unknown chain: ${chainKey}`);
  return new Contract(config.htlcAddress, HTLC_ABI, signerOrProvider ?? getProvider(chainKey));
}

export function getERC20Contract(
  chainKey: string,
  tokenAddress: string,
  signerOrProvider?: NonceManager | JsonRpcProvider
): Contract {
  return new Contract(tokenAddress, ERC20_ABI, signerOrProvider ?? getProvider(chainKey));
}
