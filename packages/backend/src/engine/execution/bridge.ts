import { ethers, Contract } from 'ethers';
import { getChainConfig } from '../../config/chains.js';
import { getTimelockMinutes, USDC_DECIMALS } from '../../config/constants.js';
import { ERC20_ABI, HTLC_ABI } from './abi.js';
import { getProvider, getAdminSigner, getHTLCContract } from './provider.js';

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

class BridgeService {
  // generate 256-bit secret and SHA256 hashlock
  generateSecret(): { secret: string; hashlock: string } {
    const secret = ethers.hexlify(ethers.randomBytes(32));
    const hashlock = ethers.sha256(secret);
    return { secret, hashlock };
  }

  // create order with multiple fills (signed by admin)
  async createOrder(params: {
    receivers: string[];
    amounts: string[];
    chain?: string;
    isPresiding?: boolean; // true => generate new secrets; false => use provided hashlocks
    hashlocks?: string[]; // required when isPresiding = false
    onBehalfOf?: string; // pull tokens from this address instead of msg.sender
  }): Promise<CreateOrderResult> {
    const chainKey = params.chain || 'sepolia';
    const config = getChainConfig(chainKey)!;
    const signer = getAdminSigner(chainKey);
    const senderAddress = params.onBehalfOf || (await signer.getAddress());

    // validate inputs
    if (params.receivers.length !== params.amounts.length) {
      throw new Error('receivers and amounts arrays must have the same length');
    }
    if (params.receivers.length === 0) {
      throw new Error('At least one receiver is required');
    }

    console.log(`[${chainKey}] Creating order from ${senderAddress}`);

    // convert human-readable USDC amounts to micro-USDC
    const microAmounts = params.amounts.map((a) => ethers.parseUnits(a, USDC_DECIMALS));
    const totalAmount = microAmounts.reduce((sum, amt) => sum + amt, 0n);

    // check USDC allowance
    const usdc = new Contract(config.usdcAddress, ERC20_ABI, signer);
    const currentAllowance = await usdc.allowance(senderAddress, config.htlcAddress);
    const signerAddress = await signer.getAddress();

    if (currentAllowance < totalAmount) {
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

    // generate secrets and hashlocks (only when isPresiding = true)
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

    // calculate timelock
    const timelockMinutes = getTimelockMinutes();
    const timelock = Math.floor(Date.now() / 1000) + timelockMinutes * 60;
    console.log(
      `[${chainKey}] Timelock: ${new Date(timelock * 1000).toISOString()} (${timelockMinutes} minutes)`
    );

    // create order
    const htlc = getHTLCContract(chainKey, signer);

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

    // parse events to get order ID and fill IDs
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

  // withdraw from a specific fill with preimage (signed by admin)
  async withdraw(params: {
    orderId: string;
    fillId: string;
    preimage: string;
    chain?: string;
  }): Promise<WithdrawResult> {
    const chainKey = params.chain || 'sepolia';
    const signer = getAdminSigner(chainKey);

    console.log(`[${chainKey}] Withdrawing from order...`);
    console.log(`  Order ID: ${params.orderId}`);
    console.log(`  Fill ID: ${params.fillId}`);

    const htlc = getHTLCContract(chainKey, signer);
    const tx = await htlc.withdraw(BigInt(params.orderId), BigInt(params.fillId), params.preimage);

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    };
  }

  // refund order after timelock expires (signed by admin)
  async refund(params: { orderId: string; chain?: string }): Promise<RefundResult> {
    const chainKey = params.chain || 'sepolia';
    const signer = getAdminSigner(chainKey);

    console.log(`[${chainKey}] Refunding order...`);
    console.log(`  Order ID: ${params.orderId}`);

    const htlc = getHTLCContract(chainKey, signer);
    const tx = await htlc.refund(BigInt(params.orderId));

    console.log(`  TX sent: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    // parse OrderRefunded event to get refunded amount
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

  // get order details (read-only, no signer needed)
  async getOrder(params: { orderId: string; chain?: string }) {
    const chainKey = params.chain || 'sepolia';
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

  // get fill details (read-only)
  async getFill(params: { orderId: string; fillId: string; chain?: string }) {
    const chainKey = params.chain || 'sepolia';
    const htlc = getHTLCContract(chainKey);
    const data = await htlc.getFill(BigInt(params.orderId), BigInt(params.fillId));

    return {
      receiver: data[0],
      amount: data[1].toString(),
      hashlock: data[2],
      claimed: data[3],
    };
  }

  // get all fills for an order (read-only)
  async getOrderFills(params: { orderId: string; chain?: string }) {
    const chainKey = params.chain || 'sepolia';
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

  // check if order exists (read-only)
  async orderExists(params: { orderId: string; chain?: string }): Promise<boolean> {
    const chainKey = params.chain || 'sepolia';
    const htlc = getHTLCContract(chainKey);
    return await htlc.orderExistsCheck(BigInt(params.orderId));
  }

  // get next order ID (read-only)
  async getNextOrderId(params: { chain?: string }): Promise<string> {
    const chainKey = params.chain || 'sepolia';
    const htlc = getHTLCContract(chainKey);
    const id = await htlc.nextOrderId();
    return id.toString();
  }

  // get claim status for an order (read-only)
  async getClaimStatus(params: {
    orderId: string;
    chain?: string;
  }): Promise<{ claimed: string; total: string }> {
    const chainKey = params.chain || 'sepolia';
    const htlc = getHTLCContract(chainKey);
    const [claimed, total] = await htlc.getClaimStatus(BigInt(params.orderId));
    return { claimed: claimed.toString(), total: total.toString() };
  }
}

export const bridgeService = new BridgeService();
