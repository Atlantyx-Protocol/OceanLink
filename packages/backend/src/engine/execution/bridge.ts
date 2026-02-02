import { ethers, JsonRpcProvider, Wallet, Contract, MaxUint256 } from 'ethers';
import { getChainConfig } from '../../config/chains.js';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

const HTLC_ABI = [
  'function newContract(address receiver, bytes32 hashlock, uint256 timelock, address token, uint256 amount) external returns (bytes32 id)',
  'function withdraw(bytes32 id, bytes32 preimage) external',
  'function refund(bytes32 id) external',
  'event HTLCNew(bytes32 indexed id, address indexed sender, address indexed receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, uint64 nonce)',
  'event HTLCWithdraw(bytes32 indexed id, bytes32 preimage)',
  'event HTLCRefund(bytes32 indexed id)',
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

export interface WithdrawResult {
  txHash: string;
  blockNumber: number;
}

export interface RefundResult {
  txHash: string;
  blockNumber: number;
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
    chain?: string;
    isPresiding?: boolean; // if true, generate new secret; if false, use provided hashlock
    hashlock?: string; // required when isPresiding = false
  }): Promise<CreateBridgeResult> {
    const chainKey = params.chain || 'sepolia';
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
      const approveTx = await usdc.approve(config.htlcAddress, params.amount);
      await approveTx.wait();
      approvalTxHash = approveTx.hash;
      console.log(`[${chainKey}] Approval TX: ${approvalTxHash}`);
    } else {
      console.log(`[${chainKey}] Already approved`);
    }

    // Step 2: Generate secret and hashlock (only if isPresiding = true)
    let secret: string;
    let hashlock: string;

    if (params.isPresiding) {
      const generated = this.generateSecret();
      secret = generated.secret;
      hashlock = generated.hashlock;
      console.log(`[${chainKey}] Generated new secret: ${secret}`);
    } else {
      if (!params.hashlock) {
        throw new Error('hashlock is required when isPresiding is false');
      }
      secret = ''; // No secret for responding party
      hashlock = params.hashlock;
      console.log(`[${chainKey}] Using provided hashlock: ${hashlock}`);
    }
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

  // Withdraw from HTLC with preimage
  async withdraw(params: {
    privateKey: string;
    contractId: string;
    preimage: string;
    chain?: string;
  }): Promise<WithdrawResult> {
    const chainKey = params.chain || 'sepolia';
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    const signer = this.getSigner(chainKey, params.privateKey);

    console.log(`[${chainKey}] Withdrawing from HTLC...`);
    console.log(`  Contract ID: ${params.contractId}`);

    const htlc = new Contract(config.htlcAddress, HTLC_ABI, signer);
    const tx = await htlc.withdraw(params.contractId, params.preimage);

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    };
  }

  // Refund from HTLC after timelock expires
  async refund(params: {
    privateKey: string;
    contractId: string;
    chain?: string;
  }): Promise<RefundResult> {
    const chainKey = params.chain || 'sepolia';
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    const signer = this.getSigner(chainKey, params.privateKey);

    console.log(`[${chainKey}] Refunding HTLC...`);
    console.log(`  Contract ID: ${params.contractId}`);

    const htlc = new Contract(config.htlcAddress, HTLC_ABI, signer);
    const tx = await htlc.refund(params.contractId);

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    };
  }
}

export const bridgeService = new BridgeService();
