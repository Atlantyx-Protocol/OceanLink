import { ethers, Contract, NonceManager, type TransactionReceipt } from 'ethers';
import { getChainConfig, type ChainConfig } from '../../config/chains.js';
import { getTimelockMinutes, USDC_DECIMALS } from '../../config/constants.js';
import { ERC20_ABI } from './abi.js';
import { getAdminSigner, getHTLCContract } from './provider.js';

export interface FillInfo {
  fillId: string;
  receiver: string;
  amount: string;
  hashlock: string;
  secret?: string; // only populated when isPresiding is true
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

interface CreateOrderParams {
  receivers: string[];
  amounts: string[];
  chain?: string;
  isPresiding?: boolean; // true => generate new secrets; false => use provided hashlocks
  hashlocks?: string[];
  onBehalfOf?: string;
}

const DEFAULT_CHAIN = 'sepolia';

function chainKeyOf(chain?: string): string {
  return chain || DEFAULT_CHAIN;
}

function requireChainConfig(chainKey: string): ChainConfig {
  const config = getChainConfig(chainKey);
  if (!config) throw new Error(`Unknown chain: ${chainKey}`);
  return config;
}

// generate 256-bit secret and SHA256 hashlock
function generateSecret(): { secret: string; hashlock: string } {
  const secret = ethers.hexlify(ethers.randomBytes(32));
  return { secret, hashlock: ethers.sha256(secret) };
}

function validateCreateOrderParams(params: CreateOrderParams): void {
  if (params.receivers.length !== params.amounts.length) {
    throw new Error('receivers and amounts arrays must have the same length');
  }
  if (params.receivers.length === 0) {
    throw new Error('At least one receiver is required');
  }
}

// makes sure `sender` has enough USDC allowance for the HTLC contract. if the
// sender is the admin signer, top up automatically; otherwise throw — admin
// can't approve on someone else's behalf.
async function ensureAllowance(
  chainKey: string,
  config: ChainConfig,
  signer: NonceManager,
  senderAddress: string,
  totalAmount: bigint
): Promise<void> {
  const usdc = new Contract(config.usdcAddress, ERC20_ABI, signer);
  const currentAllowance: bigint = await usdc.allowance(senderAddress, config.htlcAddress);

  if (currentAllowance >= totalAmount) {
    console.log(`[${chainKey}] Allowance check passed: ${currentAllowance}`);
    return;
  }

  const signerAddress = await signer.getAddress();
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
}

// returns matched (secrets, hashlocks) arrays. when isPresiding, fresh secrets
// are generated and hashlocks derived from them. otherwise, the caller-supplied
// hashlocks are used and secrets stays empty.
function resolveHashlocks(
  chainKey: string,
  params: CreateOrderParams
): { secrets: string[]; hashlocks: string[] } {
  if (params.isPresiding) {
    const secrets: string[] = [];
    const hashlocks: string[] = [];
    for (let i = 0; i < params.receivers.length; i++) {
      const pair = generateSecret();
      secrets.push(pair.secret);
      hashlocks.push(pair.hashlock);
      console.log(`[${chainKey}] Generated secret for fill ${i}: ${pair.secret}`);
    }
    return { secrets, hashlocks };
  }

  if (!params.hashlocks || params.hashlocks.length !== params.receivers.length) {
    throw new Error(
      'hashlocks array is required and must match receivers length when isPresiding is false'
    );
  }
  console.log(`[${chainKey}] Using provided hashlocks`);
  return { secrets: [], hashlocks: [...params.hashlocks] };
}

// parses `OrderCreated` + `FillCreated` events out of the receipt logs.
function parseCreateOrderReceipt(
  chainKey: string,
  receipt: TransactionReceipt,
  htlc: Contract,
  secrets: string[],
  isPresiding: boolean | undefined
): { orderId: string; fills: FillInfo[] } {
  let orderId = '';
  const fills: FillInfo[] = [];

  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = htlc.interface.parseLog(log);
    } catch {
      continue;
    }
    if (!parsed) continue;

    if (parsed.name === 'OrderCreated') {
      orderId = parsed.args[0].toString();
      console.log(`[${chainKey}] Order ID: ${orderId}`);
    } else if (parsed.name === 'FillCreated') {
      const fillId = parsed.args[1].toString();
      const fillIndex = parseInt(fillId);
      fills.push({
        fillId,
        receiver: parsed.args[2],
        amount: parsed.args[3].toString(),
        hashlock: parsed.args[4],
        secret: isPresiding ? secrets[fillIndex] : undefined,
      });
      console.log(`[${chainKey}] Fill ${fillId} created for ${parsed.args[2]}`);
    }
  }

  return { orderId, fills };
}

class BridgeService {
  generateSecret = generateSecret;

  // create order with multiple fills (signed by admin)
  async createOrder(params: CreateOrderParams): Promise<CreateOrderResult> {
    validateCreateOrderParams(params);

    const chainKey = chainKeyOf(params.chain);
    const config = requireChainConfig(chainKey);
    const signer = getAdminSigner(chainKey);
    const senderAddress = params.onBehalfOf || (await signer.getAddress());

    console.log(`[${chainKey}] Creating order from ${senderAddress}`);

    const microAmounts = params.amounts.map((a) => ethers.parseUnits(a, USDC_DECIMALS));
    const totalAmount = microAmounts.reduce((sum, amt) => sum + amt, 0n);

    await ensureAllowance(chainKey, config, signer, senderAddress, totalAmount);

    const { secrets, hashlocks } = resolveHashlocks(chainKey, params);

    const timelockMinutes = getTimelockMinutes();
    const timelock = Math.floor(Date.now() / 1000) + timelockMinutes * 60;
    console.log(
      `[${chainKey}] Timelock: ${new Date(timelock * 1000).toISOString()} (${timelockMinutes} minutes)`
    );

    const htlc = getHTLCContract(chainKey, signer);

    console.log(`[${chainKey}] Creating order...`);
    console.log(`  Receivers: ${params.receivers.length}`);
    console.log(`  Total Amount: ${totalAmount}`);

    const tx = await htlc.newOrder({
      token: config.usdcAddress,
      totalAmount,
      timelock,
      receivers: params.receivers,
      amounts: microAmounts,
      hashlocks,
      onBehalfOf: params.onBehalfOf || ethers.ZeroAddress,
    });

    console.log(`[${chainKey}] TX sent: ${tx.hash}`);
    const receipt = await tx.wait();

    const { orderId, fills } = parseCreateOrderReceipt(
      chainKey,
      receipt,
      htlc,
      secrets,
      params.isPresiding
    );

    return {
      htlcTxHash: tx.hash,
      orderId,
      fills,
      sender: senderAddress,
      totalAmount: totalAmount.toString(),
      timelock,
    };
  }

  // withdraw from a specific fill with preimage (signed by admin)
  async withdraw(params: {
    orderId: string;
    fillId: string;
    preimage: string;
    chain?: string;
  }): Promise<WithdrawResult> {
    const chainKey = chainKeyOf(params.chain);
    const signer = getAdminSigner(chainKey);

    console.log(`[${chainKey}] Withdrawing from order...`);
    console.log(`  Order ID: ${params.orderId}`);
    console.log(`  Fill ID: ${params.fillId}`);

    const htlc = getHTLCContract(chainKey, signer);
    const tx = await htlc.withdraw(BigInt(params.orderId), BigInt(params.fillId), params.preimage);

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    return { txHash: tx.hash, blockNumber: receipt.blockNumber };
  }

  // refund order after timelock expires (signed by admin)
  async refund(params: { orderId: string; chain?: string }): Promise<RefundResult> {
    const chainKey = chainKeyOf(params.chain);
    const signer = getAdminSigner(chainKey);

    console.log(`[${chainKey}] Refunding order...`);
    console.log(`  Order ID: ${params.orderId}`);

    const htlc = getHTLCContract(chainKey, signer);
    const tx = await htlc.refund(BigInt(params.orderId));

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

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

    return { txHash: tx.hash, refundedAmount, blockNumber: receipt.blockNumber };
  }

  // get order details (read-only, no signer needed)
  async getOrder(params: { orderId: string; chain?: string }) {
    const chainKey = chainKeyOf(params.chain);
    const htlc = getHTLCContract(chainKey);
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

  async getFill(params: { orderId: string; fillId: string; chain?: string }) {
    const chainKey = chainKeyOf(params.chain);
    const htlc = getHTLCContract(chainKey);
    const data = await htlc.getFill(BigInt(params.orderId), BigInt(params.fillId));

    return {
      receiver: data[0],
      amount: data[1].toString(),
      hashlock: data[2],
      claimed: data[3],
    };
  }

  async getOrderFills(params: { orderId: string; chain?: string }) {
    const chainKey = chainKeyOf(params.chain);
    const htlc = getHTLCContract(chainKey);
    const fills = await htlc.getOrderFills(BigInt(params.orderId));

    return fills.map((fill: any, index: number) => ({
      fillId: index.toString(),
      receiver: fill[0],
      amount: fill[1].toString(),
      hashlock: fill[2],
      claimed: fill[3],
    }));
  }

  async orderExists(params: { orderId: string; chain?: string }): Promise<boolean> {
    const chainKey = chainKeyOf(params.chain);
    const htlc = getHTLCContract(chainKey);
    return await htlc.orderExistsCheck(BigInt(params.orderId));
  }

  async getNextOrderId(params: { chain?: string }): Promise<string> {
    const chainKey = chainKeyOf(params.chain);
    const htlc = getHTLCContract(chainKey);
    const id = await htlc.nextOrderId();
    return id.toString();
  }

  async getClaimStatus(params: {
    orderId: string;
    chain?: string;
  }): Promise<{ claimed: string; total: string }> {
    const chainKey = chainKeyOf(params.chain);
    const htlc = getHTLCContract(chainKey);
    const [claimed, total] = await htlc.getClaimStatus(BigInt(params.orderId));
    return { claimed: claimed.toString(), total: total.toString() };
  }
}

export const bridgeService = new BridgeService();
