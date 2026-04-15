import { ethers, JsonRpcProvider, Wallet, Contract } from 'ethers';
import { getChainConfig } from '../../config/chains.js';

const HTLC_ABI = [
  // Write functions
  'function newOrder((address token, uint256 totalAmount, uint256 timelock, address[] receivers, uint256[] amounts, bytes32[] hashlocks) params) external returns (uint256 orderId)',
  'function withdraw(uint256 orderId, uint256 fillId, bytes32 preimage) external',
  'function refund(uint256 orderId) external',
  // Read functions
  'function getOrder(uint256 orderId) external view returns (tuple(address sender, address token, uint256 totalAmount, uint256 remainingAmount, uint256 timelock, uint8 status, uint256 fillCount))',
  'function getFill(uint256 orderId, uint256 fillId) external view returns (tuple(address receiver, uint256 amount, bytes32 hashlock, bool claimed))',
  'function getOrderFills(uint256 orderId) external view returns (tuple(address receiver, uint256 amount, bytes32 hashlock, bool claimed)[])',
  'function orderExistsCheck(uint256 orderId) external view returns (bool)',
  'function nextOrderId() external view returns (uint256)',
  'function getClaimStatus(uint256 orderId) external view returns (uint256 claimed, uint256 total)',
  'function allowWithdrawAfterExpiry() external view returns (bool)',
  // Events
  'event OrderCreated(uint256 indexed orderId, address indexed sender, address indexed token, uint256 totalAmount, uint256 timelock, uint256 fillCount)',
  'event FillCreated(uint256 indexed orderId, uint256 indexed fillId, address indexed receiver, uint256 amount, bytes32 hashlock)',
  'event FillWithdrawn(uint256 indexed orderId, uint256 indexed fillId, address indexed receiver, bytes32 preimage)',
  'event OrderRefunded(uint256 indexed orderId, uint256 refundedAmount)',
];

export interface NewOrderParams {
  token: string;
  totalAmount: bigint;
  timelock: number;
  receivers: string[];
  amounts: bigint[];
  hashlocks: string[];
}

export interface OrderData {
  sender: string;
  token: string;
  totalAmount: bigint;
  remainingAmount: bigint;
  timelock: bigint;
  status: number; // 0 = NONE, 1 = OPEN, 2 = REFUNDED
  fillCount: bigint;
}

export interface FillData {
  receiver: string;
  amount: bigint;
  hashlock: string;
  claimed: boolean;
}

export interface NewOrderResult {
  txHash: string;
  orderId: bigint;
  fillIds: bigint[];
  blockNumber: number;
}

export interface WithdrawResult {
  txHash: string;
  blockNumber: number;
}

export interface RefundResult {
  txHash: string;
  refundedAmount: bigint;
  blockNumber: number;
}

class HTLCService {
  private getAdminKey(): string {
    const key = process.env.PRIVATE_KEY_ADMIN;
    if (!key) throw new Error('PRIVATE_KEY_ADMIN is not configured in environment');
    return key;
  }

  private getProvider(chainKey: string): JsonRpcProvider {
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    return new JsonRpcProvider(config.rpcUrl);
  }

  private getSigner(chainKey: string): Wallet {
    return new Wallet(this.getAdminKey(), this.getProvider(chainKey));
  }

  private getHTLCContract(chainKey: string): Contract {
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    return new Contract(config.htlcAddress, HTLC_ABI, this.getSigner(chainKey));
  }

  private getHTLCContractReadOnly(chainKey: string): Contract {
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    return new Contract(config.htlcAddress, HTLC_ABI, this.getProvider(chainKey));
  }

  // Generate a random preimage and its hashlock (SHA256)
  generateHashPair(): { preimage: string; hashlock: string } {
    const preimage = ethers.hexlify(ethers.randomBytes(32));
    // Use SHA256 to match the contract's sha256(abi.encodePacked(preimage))
    const hashlock = ethers.sha256(preimage);
    return { preimage, hashlock };
  }

  // Create new order with multiple fills
  async newOrder(chainKey: string, params: NewOrderParams): Promise<NewOrderResult> {
    const contract = this.getHTLCContract(chainKey);

    console.log(`[${chainKey}] Creating new order...`);
    console.log(`  Token: ${params.token}`);
    console.log(`  Total Amount: ${params.totalAmount}`);
    console.log(`  Timelock: ${new Date(params.timelock * 1000).toISOString()}`);
    console.log(`  Fill Count: ${params.receivers.length}`);

    const tx = await contract.newOrder({
      token: params.token,
      totalAmount: params.totalAmount,
      timelock: params.timelock,
      receivers: params.receivers,
      amounts: params.amounts,
      hashlocks: params.hashlocks,
    });

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();

    // Parse OrderCreated event to get the order ID
    let orderId: bigint = BigInt(0);
    const fillIds: bigint[] = [];

    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === 'OrderCreated') {
          orderId = parsed.args[0];
          console.log(`  Order ID: ${orderId}`);
        } else if (parsed?.name === 'FillCreated') {
          fillIds.push(parsed.args[1]);
          console.log(`  Fill ID: ${parsed.args[1]} for receiver ${parsed.args[2]}`);
        }
      } catch {
        continue;
      }
    }

    return {
      txHash: tx.hash,
      orderId,
      fillIds,
      blockNumber: receipt.blockNumber,
    };
  }

  // Withdraw from a specific fill with preimage
  async withdraw(
    chainKey: string,
    orderId: bigint,
    fillId: bigint,
    preimage: string
  ): Promise<WithdrawResult> {
    const contract = this.getHTLCContract(chainKey);

    console.log(`[${chainKey}] Withdrawing from order...`);
    console.log(`  Order ID: ${orderId}`);
    console.log(`  Fill ID: ${fillId}`);

    const tx = await contract.withdraw(orderId, fillId, preimage);
    console.log(`  TX sent: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    };
  }

  // Refund order after timelock expires
  async refund(chainKey: string, orderId: bigint): Promise<RefundResult> {
    const contract = this.getHTLCContract(chainKey);

    console.log(`[${chainKey}] Refunding order...`);
    console.log(`  Order ID: ${orderId}`);

    const tx = await contract.refund(orderId);
    console.log(`  TX sent: ${tx.hash}`);

    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    // Parse OrderRefunded event to get refunded amount
    let refundedAmount: bigint = BigInt(0);
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === 'OrderRefunded') {
          refundedAmount = parsed.args[1];
          break;
        }
      } catch {
        continue;
      }
    }

    return {
      txHash: tx.hash,
      refundedAmount,
      blockNumber: receipt.blockNumber,
    };
  }

  // Get order details
  async getOrder(chainKey: string, orderId: bigint): Promise<OrderData> {
    const contract = this.getHTLCContractReadOnly(chainKey);
    const data = await contract.getOrder(orderId);

    return {
      sender: data[0],
      token: data[1],
      totalAmount: data[2],
      remainingAmount: data[3],
      timelock: data[4],
      status: data[5],
      fillCount: data[6],
    };
  }

  // Get fill details
  async getFill(chainKey: string, orderId: bigint, fillId: bigint): Promise<FillData> {
    const contract = this.getHTLCContractReadOnly(chainKey);
    const data = await contract.getFill(orderId, fillId);

    return {
      receiver: data[0],
      amount: data[1],
      hashlock: data[2],
      claimed: data[3],
    };
  }

  // Get all fills for an order
  async getOrderFills(chainKey: string, orderId: bigint): Promise<FillData[]> {
    const contract = this.getHTLCContractReadOnly(chainKey);
    const fills = await contract.getOrderFills(orderId);

    return fills.map((fill: any) => ({
      receiver: fill[0],
      amount: fill[1],
      hashlock: fill[2],
      claimed: fill[3],
    }));
  }

  // Check if order exists
  async orderExists(chainKey: string, orderId: bigint): Promise<boolean> {
    const contract = this.getHTLCContractReadOnly(chainKey);
    return await contract.orderExistsCheck(orderId);
  }

  // Get next order ID
  async getNextOrderId(chainKey: string): Promise<bigint> {
    const contract = this.getHTLCContractReadOnly(chainKey);
    return await contract.nextOrderId();
  }

  // Get claim status for an order
  async getClaimStatus(
    chainKey: string,
    orderId: bigint
  ): Promise<{ claimed: bigint; total: bigint }> {
    const contract = this.getHTLCContractReadOnly(chainKey);
    const [claimed, total] = await contract.getClaimStatus(orderId);
    return { claimed, total };
  }

  // Check if withdrawals are allowed after expiry
  async allowWithdrawAfterExpiry(chainKey: string): Promise<boolean> {
    const contract = this.getHTLCContractReadOnly(chainKey);
    return await contract.allowWithdrawAfterExpiry();
  }
}

export const htlcService = new HTLCService();
