import { ethers, JsonRpcProvider, Wallet, Contract } from 'ethers';
import { getChainConfig, ChainConfig } from '../../config/chains.js';

const HTLC_ABI = [
  'function newContract(address receiver, bytes32 hashlock, uint256 timelock, address token, uint256 amount) external returns (bytes32 id)',
  'function withdraw(bytes32 id, bytes32 preimage) external',
  'function refund(bytes32 id) external',
  'function getContract(bytes32 id) external view returns (tuple(address sender, address receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, uint8 status, bytes32 preimage, uint64 nonce))',
  'function existsContract(bytes32 id) external view returns (bool)',
  'function nonces(address) external view returns (uint64)',
  'event HTLCNew(bytes32 indexed id, address indexed sender, address indexed receiver, address token, uint256 amount, bytes32 hashlock, uint256 timelock, uint64 nonce)',
  'event HTLCWithdraw(bytes32 indexed id, bytes32 preimage)',
  'event HTLCRefund(bytes32 indexed id)',
];

export interface NewContractParams {
  receiver: string;
  hashlock: string;
  timelock: number;
  token: string;
  amount: bigint;
}

export interface HTLCContractData {
  sender: string;
  receiver: string;
  token: string;
  amount: bigint;
  hashlock: string;
  timelock: bigint;
  status: number;
  preimage: string;
  nonce: bigint;
}

class HTLCService {
  private privateKey: string;

  constructor() {
    this.privateKey = process.env.PRIVATE_KEY || '';
  }

  private getProvider(chainKey: string): JsonRpcProvider {
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    return new JsonRpcProvider(config.rpcUrl);
  }

  private getSigner(chainKey: string): Wallet {
    if (!this.privateKey) throw new Error('PRIVATE_KEY not configured');
    return new Wallet(this.privateKey, this.getProvider(chainKey));
  }

  private getHTLCContract(chainKey: string): Contract {
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    return new Contract(config.htlcAddress, HTLC_ABI, this.getSigner(chainKey));
  }

  // Generate a random preimage and its hashlock
  generateHashPair(): { preimage: string; hashlock: string } {
    const preimage = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.sha256(preimage);
    return { preimage, hashlock };
  }

  // Create new HTLC
  async newContract(chainKey: string, params: NewContractParams) {
    const contract = this.getHTLCContract(chainKey);

    console.log(`[${chainKey}] Creating new HTLC...`);
    console.log(`  Receiver: ${params.receiver}`);
    console.log(`  Amount: ${params.amount}`);
    console.log(`  Timelock: ${new Date(params.timelock * 1000).toISOString()}`);

    const tx = await contract.newContract(
      params.receiver,
      params.hashlock,
      params.timelock,
      params.token,
      params.amount
    );

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();

    // Parse HTLCNew event to get the contract ID
    const htlcNewEvent = receipt.logs.find((log: any) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed?.name === 'HTLCNew';
      } catch {
        return false;
      }
    });

    let contractId = null;
    if (htlcNewEvent) {
      const parsed = contract.interface.parseLog(htlcNewEvent);
      contractId = parsed?.args[0];
    }

    console.log(`  Contract ID: ${contractId}`);

    return {
      txHash: tx.hash,
      contractId,
      blockNumber: receipt.blockNumber,
    };
  }

  // Withdraw from HTLC with preimage
  async withdraw(chainKey: string, contractId: string, preimage: string) {
    const contract = this.getHTLCContract(chainKey);

    console.log(`[${chainKey}] Withdrawing from HTLC...`);
    console.log(`  Contract ID: ${contractId}`);

    const tx = await contract.withdraw(contractId, preimage);
    console.log(`  TX sent: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    };
  }

  // Refund from HTLC after timelock
  async refund(chainKey: string, contractId: string) {
    const contract = this.getHTLCContract(chainKey);

    console.log(`[${chainKey}] Refunding HTLC...`);
    console.log(`  Contract ID: ${contractId}`);

    const tx = await contract.refund(contractId);
    console.log(`  TX sent: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    };
  }

  // Get HTLC contract details
  async getContract(chainKey: string, contractId: string): Promise<HTLCContractData> {
    const contract = this.getHTLCContract(chainKey);
    const data = await contract.getContract(contractId);

    return {
      sender: data[0],
      receiver: data[1],
      token: data[2],
      amount: data[3],
      hashlock: data[4],
      timelock: data[5],
      status: data[6],
      preimage: data[7],
      nonce: data[8],
    };
  }

  // Check if HTLC exists
  async exists(chainKey: string, contractId: string): Promise<boolean> {
    const contract = this.getHTLCContract(chainKey);
    return await contract.existsContract(contractId);
  }
}

export const htlcService = new HTLCService();
