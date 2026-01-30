import { JsonRpcProvider, Wallet, Contract, MaxUint256 } from 'ethers';
import { getChainConfig, ChainConfig, getAllChains, CHAIN_KEYS } from '../config/chains.js';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)',
];

export interface ApprovalResult {
  chain: string;
  chainId: number;
  usdcAddress: string;
  htlcAddress: string;
  txHash?: string;
  status: 'success' | 'failed' | 'already_approved';
  error?: string;
  allowance?: string;
}

class ApprovalService {
  private privateKey: string;

  constructor() {
    this.privateKey = process.env.PRIVATE_KEY || '';
  }

  private getProvider(rpcUrl: string): JsonRpcProvider {
    return new JsonRpcProvider(rpcUrl);
  }

  private getSigner(provider: JsonRpcProvider): Wallet {
    if (!this.privateKey) {
      throw new Error('PRIVATE_KEY not configured in environment');
    }
    return new Wallet(this.privateKey, provider);
  }

  async checkAllowance(chainConfig: ChainConfig): Promise<bigint> {
    const provider = this.getProvider(chainConfig.rpcUrl);
    const signer = this.getSigner(provider);
    const usdcContract = new Contract(chainConfig.usdcAddress, ERC20_ABI, provider);

    const allowance = await usdcContract.allowance(
      await signer.getAddress(),
      chainConfig.htlcAddress
    );

    return allowance;
  }

  async approveUSDCForChain(
    chainConfig: ChainConfig,
    amount: bigint = MaxUint256
  ): Promise<ApprovalResult> {
    const result: ApprovalResult = {
      chain: chainConfig.name,
      chainId: chainConfig.chainId,
      usdcAddress: chainConfig.usdcAddress,
      htlcAddress: chainConfig.htlcAddress,
      status: 'failed',
    };

    try {
      if (!chainConfig.rpcUrl) {
        throw new Error(`RPC URL not configured for ${chainConfig.name}`);
      }

      const provider = this.getProvider(chainConfig.rpcUrl);
      const signer = this.getSigner(provider);
      const usdcContract = new Contract(chainConfig.usdcAddress, ERC20_ABI, signer);

      // Check current allowance
      const currentAllowance = await usdcContract.allowance(
        await signer.getAddress(),
        chainConfig.htlcAddress
      );

      result.allowance = currentAllowance.toString();

      // If already approved with max amount, skip
      if (currentAllowance >= amount) {
        result.status = 'already_approved';
        console.log(`[${chainConfig.name}] Already approved. Allowance: ${currentAllowance}`);
        return result;
      }

      console.log(`[${chainConfig.name}] Approving USDC for HTLC contract...`);
      console.log(`  USDC: ${chainConfig.usdcAddress}`);
      console.log(`  HTLC: ${chainConfig.htlcAddress}`);

      const tx = await usdcContract.approve(chainConfig.htlcAddress, amount);
      console.log(`[${chainConfig.name}] Transaction sent: ${tx.hash}`);

      const receipt = await tx.wait();
      console.log(`[${chainConfig.name}] Transaction confirmed in block ${receipt.blockNumber}`);

      result.txHash = tx.hash;
      result.status = 'success';

      // Update allowance after approval
      const newAllowance = await usdcContract.allowance(
        await signer.getAddress(),
        chainConfig.htlcAddress
      );
      result.allowance = newAllowance.toString();

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.error = errorMessage;
      console.error(`[${chainConfig.name}] Approval failed:`, errorMessage);
    }

    return result;
  }

  async approveUSDCForAllChains(amount: bigint = MaxUint256): Promise<ApprovalResult[]> {
    const chains = getAllChains();
    const results: ApprovalResult[] = [];

    console.log('Starting USDC approvals for all chains...\n');

    for (const chainConfig of chains) {
      const result = await this.approveUSDCForChain(chainConfig, amount);
      results.push(result);
      console.log('');
    }

    console.log('Approval process completed.');
    return results;
  }

  async approveUSDCForSpecificChain(
    chainKey: string,
    amount: bigint = MaxUint256
  ): Promise<ApprovalResult> {
    const chainConfig = getChainConfig(chainKey);
    if (!chainConfig) {
      throw new Error(`Unknown chain: ${chainKey}. Available: ${CHAIN_KEYS.join(', ')}`);
    }
    return this.approveUSDCForChain(chainConfig, amount);
  }

  async getAllAllowances(): Promise<Record<string, { chain: string; allowance: string }>> {
    const chains = getAllChains();
    const allowances: Record<string, { chain: string; allowance: string }> = {};

    for (const chainConfig of chains) {
      try {
        const allowance = await this.checkAllowance(chainConfig);
        allowances[chainConfig.name] = {
          chain: chainConfig.name,
          allowance: allowance.toString(),
        };
      } catch (error) {
        allowances[chainConfig.name] = {
          chain: chainConfig.name,
          allowance: 'error',
        };
      }
    }

    return allowances;
  }

  async getBalance(chainKey: string, address: string): Promise<{ balance: string; decimals: number }> {
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
}

export const approvalService = new ApprovalService();
