import { JsonRpcProvider, Contract, Wallet, MaxUint256 } from 'ethers';
import { getChainConfig, getAllChains, CHAIN_KEYS } from '../../config/chains.js';

const ERC20_ABI = [
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

class ApprovalService {
  private getProvider(rpcUrl: string): JsonRpcProvider {
    return new JsonRpcProvider(rpcUrl);
  }

  async getBalance(
    chainKey: string,
    address: string
  ): Promise<{ balance: string; decimals: number }> {
    const chainConfig = getChainConfig(chainKey);
    if (!chainConfig) {
      throw new Error(`Unknown chain: ${chainKey}. Available: ${CHAIN_KEYS.join(', ')}`);
    }

    const provider = this.getProvider(chainConfig.rpcUrl);
    const usdcContract = new Contract(chainConfig.usdcAddress, ERC20_ABI, provider);

    const [balance, decimals] = await Promise.all([
      usdcContract.balanceOf(address),
      usdcContract.decimals(),
    ]);

    return {
      balance: balance.toString(),
      decimals: Number(decimals),
    };
  }

  async getAllowance(
    chainKey: string,
    address: string
  ): Promise<{ allowance: string; htlcAddress: string }> {
    const chainConfig = getChainConfig(chainKey);
    if (!chainConfig) {
      throw new Error(`Unknown chain: ${chainKey}. Available: ${CHAIN_KEYS.join(', ')}`);
    }

    const provider = this.getProvider(chainConfig.rpcUrl);
    const usdcContract = new Contract(chainConfig.usdcAddress, ERC20_ABI, provider);

    const allowance = await usdcContract.allowance(address, chainConfig.htlcAddress);

    return {
      allowance: allowance.toString(),
      htlcAddress: chainConfig.htlcAddress,
    };
  }

  async getAllAllowances(
    address: string
  ): Promise<Record<string, { chain: string; allowance: string }>> {
    const chains = getAllChains();
    const allowances: Record<string, { chain: string; allowance: string }> = {};

    for (const chainConfig of chains) {
      try {
        const provider = this.getProvider(chainConfig.rpcUrl);
        const usdcContract = new Contract(chainConfig.usdcAddress, ERC20_ABI, provider);
        const allowance = await usdcContract.allowance(address, chainConfig.htlcAddress);
        allowances[chainConfig.name] = {
          chain: chainConfig.name,
          allowance: allowance.toString(),
        };
      } catch {
        allowances[chainConfig.name] = {
          chain: chainConfig.name,
          allowance: 'error',
        };
      }
    }

    return allowances;
  }
  async approve(
    chainKey: string,
    privateKey: string,
    amount?: string
  ): Promise<{ txHash: string; address: string }> {
    const chainConfig = getChainConfig(chainKey);
    if (!chainConfig) {
      throw new Error(`Unknown chain: ${chainKey}. Available: ${CHAIN_KEYS.join(', ')}`);
    }

    const provider = this.getProvider(chainConfig.rpcUrl);
    const wallet = new Wallet(privateKey, provider);
    const usdcContract = new Contract(chainConfig.usdcAddress, ERC20_ABI, wallet);

    const approveAmount = amount ?? MaxUint256;
    const tx = await usdcContract.approve(chainConfig.htlcAddress, approveAmount);
    await tx.wait();

    return { txHash: tx.hash, address: wallet.address };
  }

  addressFromKey(privateKey: string): string {
    return new Wallet(privateKey).address;
  }
}

export const approvalService = new ApprovalService();
