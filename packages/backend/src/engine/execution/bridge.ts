import { ethers, JsonRpcProvider, NonceManager, Wallet, Contract } from 'ethers';
import { getChainConfig } from '../../config/chains.js';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

const HTLC_ABI = [
  // Write functions
  'function newOrder((address token, uint256 totalAmount, uint256 timelock, address[] receivers, uint256[] amounts, bytes32[] hashlocks, address onBehalfOf) params) external returns (uint256 orderId)',
  'function withdraw(uint256 orderId, uint256 fillId, bytes32 preimage) external',
  'function refund(uint256 orderId) external',
  // Read functions
  'function getOrder(uint256 orderId) external view returns (tuple(address sender, address token, uint256 totalAmount, uint256 remainingAmount, uint256 timelock, uint8 status, uint256 fillCount))',
  'function getFill(uint256 orderId, uint256 fillId) external view returns (tuple(address receiver, uint256 amount, bytes32 hashlock, bool claimed))',
  'function getOrderFills(uint256 orderId) external view returns (tuple(address receiver, uint256 amount, bytes32 hashlock, bool claimed)[])',
  'function nextOrderId() external view returns (uint256)',
  // Events
  'event OrderCreated(uint256 indexed orderId, address indexed sender, address indexed token, uint256 totalAmount, uint256 timelock, uint256 fillCount)',
  'event FillCreated(uint256 indexed orderId, uint256 indexed fillId, address indexed receiver, uint256 amount, bytes32 hashlock)',
  'event FillWithdrawn(uint256 indexed orderId, uint256 indexed fillId, address indexed receiver, bytes32 preimage)',
  'event OrderRefunded(uint256 indexed orderId, uint256 refundedAmount)',
];

export interface FillInfo {
  fillId: string;
  receiver: string;
  amount: string;
  hashlock: string;
  secret?: string; // Only populated if isPresiding is true
}

export interface CreateOrderResult {
  htlcTxHash: string;
  orderId: string;
  fills: FillInfo[];
  sender: string;
  totalAmount: string;
  timelock: number;
}

export interface WithdrawResult {
  txHash: string;
  blockNumber: number;
}

export interface RefundResult {
  txHash: string;
  refundedAmount: string;
  blockNumber: number;
}

class BridgeService {
  private providers = new Map<string, JsonRpcProvider>();
  private signers = new Map<string, NonceManager>();

  private getAdminKey(): string {
    const key = process.env.PRIVATE_KEY_ADMIN;
    if (!key) throw new Error('PRIVATE_KEY_ADMIN is not configured in environment');
    return key;
  }

  private getProvider(chainKey: string): JsonRpcProvider {
    let provider = this.providers.get(chainKey);
    if (!provider) {
      const config = getChainConfig(chainKey);
      if (!config) throw new Error(`Unknown chain: ${chainKey}`);
      provider = new JsonRpcProvider(config.rpcUrl);
      this.providers.set(chainKey, provider);
    }
    return provider;
  }

  private getSigner(chainKey: string): NonceManager {
    const adminKey = this.getAdminKey();
    const address = new Wallet(adminKey).address;
    const cacheKey = `${chainKey}:${address}`;
    let signer = this.signers.get(cacheKey);
    if (!signer) {
      const wallet = new Wallet(adminKey, this.getProvider(chainKey));
      signer = new NonceManager(wallet);
      this.signers.set(cacheKey, signer);
    }
    return signer;
  }

  // Generate 256-bit secret and SHA256 hashlock
  generateSecret(): { secret: string; hashlock: string } {
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.sha256(secret);
    return { secret, hashlock };
  }

  // Create order with multiple fills (signed by admin)
  async createOrder(params: {
    receivers: string[];
    amounts: string[];
    chain?: string;
    isPresiding?: boolean; // if true, generate new secrets; if false, use provided hashlocks
    hashlocks?: string[]; // required when isPresiding = false
    onBehalfOf?: string; // optional: tokens are pulled from this address instead of msg.sender
  }): Promise<CreateOrderResult> {
    const chainKey = params.chain || 'sepolia';
    const config = getChainConfig(chainKey)!;
    const signer = this.getSigner(chainKey);
    const senderAddress = params.onBehalfOf || (await signer.getAddress());

    // Validate inputs
    if (params.receivers.length !== params.amounts.length) {
      throw new Error('receivers and amounts arrays must have the same length');
    }
    if (params.receivers.length === 0) {
      throw new Error('At least one receiver is required');
    }

    console.log(`[${chainKey}] Creating order from ${senderAddress}`);

    // Convert human-readable USDC amounts to micro-USDC (6 decimals)
    const microAmounts = params.amounts.map((a) => ethers.parseUnits(a, 6));
    const totalAmount = microAmounts.reduce((sum, amt) => sum + amt, 0n);

    // Step 1: Check USDC allowance
    const usdc = new Contract(config.usdcAddress, ERC20_ABI, signer);
    const currentAllowance = await usdc.allowance(senderAddress, config.htlcAddress);
    const signerAddress = await signer.getAddress();

    if (currentAllowance < totalAmount) {
      // The admin signer can only approve tokens it owns. If senderAddress is a
      // different wallet (onBehalfOf), approvals must be pre-arranged off-path.
      if (senderAddress.toLowerCase() !== signerAddress.toLowerCase()) {
        throw new Error(
          `[${chainKey}] ${senderAddress} has insufficient allowance ` +
            `(have=${currentAllowance}, need=${totalAmount}) — pre-approval required`
        );
      }

      console.log(
        `[${chainKey}] Insufficient allowance (have ${currentAllowance}, need ${totalAmount}), approving...`
      );
      const approveTx = await usdc.approve(config.htlcAddress, totalAmount);
      await approveTx.wait();
      console.log(`[${chainKey}] USDC approved: ${totalAmount}`);

      const newAllowance = await usdc.allowance(senderAddress, config.htlcAddress);
      console.log(`[${chainKey}] New allowance: ${newAllowance}`);
    } else {
      console.log(`[${chainKey}] Allowance check passed: ${currentAllowance}`);
    }

    // Step 2: Generate secrets and hashlocks (only if isPresiding = true)
    const secrets: string[] = [];
    const hashlocks: string[] = [];

    if (params.isPresiding) {
      for (let i = 0; i < params.receivers.length; i++) {
        const { secret, hashlock } = this.generateSecret();
        secrets.push(secret);
        hashlocks.push(hashlock);
        console.log(`[${chainKey}] Generated secret for fill ${i}: ${secret}`);
      }
    } else {
      if (!params.hashlocks || params.hashlocks.length !== params.receivers.length) {
        throw new Error(
          'hashlocks array is required and must match receivers length when isPresiding is false'
        );
      }
      hashlocks.push(...params.hashlocks);
      console.log(`[${chainKey}] Using provided hashlocks`);
    }

    // Step 3: Calculate timelock (TIME_LOCK env is in minutes, default 10 minutes)
    const timelockMinutes = parseInt(process.env.TIME_LOCK || '10', 10);
    const timelock = Math.floor(Date.now() / 1000) + timelockMinutes * 60;
    console.log(
      `[${chainKey}] Timelock: ${new Date(timelock * 1000).toISOString()} (${timelockMinutes} minutes)`
    );

    // Step 4: Create order
    const htlc = new Contract(config.htlcAddress, HTLC_ABI, signer);

    console.log(`[${chainKey}] Creating order...`);
    console.log(`  Receivers: ${params.receivers.length}`);
    console.log(`  Total Amount: ${totalAmount}`);

    const onBehalfOf = params.onBehalfOf || ethers.ZeroAddress;

    const tx = await htlc.newOrder({
      token: config.usdcAddress,
      totalAmount,
      timelock,
      receivers: params.receivers,
      amounts: microAmounts,
      hashlocks,
      onBehalfOf,
    });

    console.log(`[${chainKey}] TX sent: ${tx.hash}`);
    const receipt = await tx.wait();

    // Parse events to get order ID and fill IDs
    let orderId = '';
    const fillInfos: FillInfo[] = [];

    for (const log of receipt.logs) {
      try {
        const parsed = htlc.interface.parseLog(log);
        if (parsed?.name === 'OrderCreated') {
          orderId = parsed.args[0].toString();
          console.log(`[${chainKey}] Order ID: ${orderId}`);
        } else if (parsed?.name === 'FillCreated') {
          const fillId = parsed.args[1].toString();
          const fillIndex = parseInt(fillId);
          fillInfos.push({
            fillId,
            receiver: parsed.args[2],
            amount: parsed.args[3].toString(),
            hashlock: parsed.args[4],
            secret: params.isPresiding ? secrets[fillIndex] : undefined,
          });
          console.log(`[${chainKey}] Fill ${fillId} created for ${parsed.args[2]}`);
        }
      } catch {
        continue;
      }
    }

    return {
      htlcTxHash: tx.hash,
      orderId,
      fills: fillInfos,
      sender: senderAddress,
      totalAmount: totalAmount.toString(),
      timelock,
    };
  }

  // Withdraw from a specific fill with preimage (signed by admin)
  async withdraw(params: {
    orderId: string;
    fillId: string;
    preimage: string;
    chain?: string;
  }): Promise<WithdrawResult> {
    const chainKey = params.chain || 'sepolia';
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    const signer = this.getSigner(chainKey);

    console.log(`[${chainKey}] Withdrawing from order...`);
    console.log(`  Order ID: ${params.orderId}`);
    console.log(`  Fill ID: ${params.fillId}`);

    const htlc = new Contract(config.htlcAddress, HTLC_ABI, signer);
    const tx = await htlc.withdraw(BigInt(params.orderId), BigInt(params.fillId), params.preimage);

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    };
  }

  // Refund order after timelock expires (signed by admin)
  async refund(params: { orderId: string; chain?: string }): Promise<RefundResult> {
    const chainKey = params.chain || 'sepolia';
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);
    const signer = this.getSigner(chainKey);

    console.log(`[${chainKey}] Refunding order...`);
    console.log(`  Order ID: ${params.orderId}`);

    const htlc = new Contract(config.htlcAddress, HTLC_ABI, signer);
    const tx = await htlc.refund(BigInt(params.orderId));

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    // Parse OrderRefunded event to get refunded amount
    let refundedAmount = '0';
    for (const log of receipt.logs) {
      try {
        const parsed = htlc.interface.parseLog(log);
        if (parsed?.name === 'OrderRefunded') {
          refundedAmount = parsed.args[1].toString();
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

  // Get order details (read-only, no signer needed)
  async getOrder(params: { orderId: string; chain?: string }) {
    const chainKey = params.chain || 'sepolia';
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);

    const htlc = new Contract(config.htlcAddress, HTLC_ABI, this.getProvider(chainKey));
    const data = await htlc.getOrder(BigInt(params.orderId));

    return {
      sender: data[0],
      token: data[1],
      totalAmount: data[2].toString(),
      remainingAmount: data[3].toString(),
      timelock: Number(data[4]),
      status: Number(data[5]), // 0 = NONE, 1 = OPEN, 2 = REFUNDED
      fillCount: Number(data[6]),
    };
  }

  // Get fill details (read-only)
  async getFill(params: { orderId: string; fillId: string; chain?: string }) {
    const chainKey = params.chain || 'sepolia';
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);

    const htlc = new Contract(config.htlcAddress, HTLC_ABI, this.getProvider(chainKey));
    const data = await htlc.getFill(BigInt(params.orderId), BigInt(params.fillId));

    return {
      receiver: data[0],
      amount: data[1].toString(),
      hashlock: data[2],
      claimed: data[3],
    };
  }

  // Get all fills for an order (read-only)
  async getOrderFills(params: { orderId: string; chain?: string }) {
    const chainKey = params.chain || 'sepolia';
    const config = getChainConfig(chainKey);
    if (!config) throw new Error(`Unknown chain: ${chainKey}`);

    const htlc = new Contract(config.htlcAddress, HTLC_ABI, this.getProvider(chainKey));
    const fills = await htlc.getOrderFills(BigInt(params.orderId));

    return fills.map((fill: any, index: number) => ({
      fillId: index.toString(),
      receiver: fill[0],
      amount: fill[1].toString(),
      hashlock: fill[2],
      claimed: fill[3],
    }));
  }
}

export const bridgeService = new BridgeService();
