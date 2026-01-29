import { ethers, JsonRpcProvider, Wallet, Contract, MaxUint256 } from 'ethers';
import { getChainConfig } from '../config/chains.js';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

const HTLC_ABI = [
  'function newContract(address receiver, bytes32 hashlock, uint256 timelock, address token, uint256 amount) external returns (bytes32 id)',
  'event HTLCNew(bytes32 indexed id, address indexed sender, address indexed receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, uint64 nonce)',
];

export interface CreateBridgeResult {
  approvalTxHash?: string;
  htlcTxHash: string;
  contractId: string;
  secret: string;
  hashlock: string;
  sender: string;
  receiver: string;
  amount: string;
  timelock: number;
}

class BridgeService {
  private getProvider(chainKey: string): JsonRpcProvider {
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    return new JsonRpcProvider(config.rpcUrl);
  }

  private getSigner(chainKey: string, privateKey: string): Wallet {
    return new Wallet(privateKey, this.getProvider(chainKey));
  }

  // Generate 256-bit secret and hashlock
  generateSecret(): { secret: string; hashlock: string } {
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.sha256(secret);
    return { secret, hashlock };
  }

  // Approve and create HTLC in one flow
  async createBridge(params: {
    privateKey: string;
    receiver: string;
    amount: bigint;
    timelockHours?: number;
  }): Promise<CreateBridgeResult> {
    const chainKey = 'sepolia';
    const config = getChainConfig(chainKey)!;
    const signer = this.getSigner(chainKey, params.privateKey);
    const senderAddress = await signer.getAddress();

    console.log(`[${chainKey}] Creating bridge from ${senderAddress}`);

    // Step 1: Check and approve USDC if needed
    const usdc = new Contract(config.usdcAddress, ERC20_ABI, signer);
    const currentAllowance = await usdc.allowance(senderAddress, config.htlcAddress);

    let approvalTxHash: string | undefined;
    if (currentAllowance < params.amount) {
      console.log(`[${chainKey}] Approving USDC...`);
      const approveTx = await usdc.approve(config.htlcAddress, MaxUint256);
      await approveTx.wait();
      approvalTxHash = approveTx.hash;
      console.log(`[${chainKey}] Approval TX: ${approvalTxHash}`);
    } else {
      console.log(`[${chainKey}] Already approved`);
    }

    // Step 2: Generate secret and hashlock
    const { secret, hashlock } = this.generateSecret();
    console.log(`[${chainKey}] Secret: ${secret}`);
    console.log(`[${chainKey}] Hashlock: ${hashlock}`);

    // Step 3: Calculate timelock (default 2 hours from now)
    const hours = params.timelockHours ?? 2;
    const timelock = Math.floor(Date.now() / 1000) + hours * 60 * 60;
    console.log(`[${chainKey}] Timelock: ${new Date(timelock * 1000).toISOString()}`);

    // Step 4: Create HTLC
    const htlc = new Contract(config.htlcAddress, HTLC_ABI, signer);

    console.log(`[${chainKey}] Creating HTLC...`);
    console.log(`  Receiver: ${params.receiver}`);
    console.log(`  Amount: ${params.amount}`);

    const tx = await htlc.newContract(
      params.receiver,
      hashlock,
      timelock,
      config.usdcAddress,
      params.amount
    );

    console.log(`[${chainKey}] TX sent: ${tx.hash}`);
    const receipt = await tx.wait();

    // Parse event to get contract ID
    let contractId = '';
    for (const log of receipt.logs) {
      try {
        const parsed = htlc.interface.parseLog(log);
        if (parsed?.name === 'HTLCNew') {
          contractId = parsed.args[0];
          break;
        }
      } catch {
        continue;
      }
    }

    console.log(`[${chainKey}] Contract ID: ${contractId}`);

    return {
      approvalTxHash,
      htlcTxHash: tx.hash,
      contractId,
      secret,
      hashlock,
      sender: senderAddress,
      receiver: params.receiver,
      amount: params.amount.toString(),
      timelock,
    };
  }
}

export const bridgeService = new BridgeService();
