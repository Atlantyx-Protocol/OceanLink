import { FastifyPluginAsync } from 'fastify';
import { bridgeService } from '../services/bridge.js';

const bridgeRoutes: FastifyPluginAsync = async (fastify) => {
  // Create bridge: approve + newContract
  fastify.post<{
    Body: {
      privateKey: string; // required: private key of the sender
      receiver?: string; // optional, defaults to sender address
      amount?: string; // optional, defaults to 700 USDC (700 * 1e6)
      chain?: string; // optional, defaults to 'sepolia'
      isPresiding?: boolean; // optional, if true generate new secret, default false
      hashlock?: string; // required when isPresiding is false
      timelockHours?: number; // optional, defaults to 1 hour
    };
  }>('/bridge/create', async (request, reply) => {
    try {
      const body = request.body || {};

      if (!body.privateKey) {
        return reply.status(400).send({ error: 'privateKey is required' });
      }

      // Default amount is 700 USDC (6 decimals)
      const amount = body.amount ? BigInt(body.amount) : BigInt(700 * 1e6);

      // Get sender address from private key to use as default receiver
      const { ethers } = await import('ethers');
      const wallet = new ethers.Wallet(body.privateKey);
      const senderAddress = wallet.address;

      const receiver = body.receiver || senderAddress;
      const isPresiding = body.isPresiding ?? false;

      // Validate hashlock is provided when not presiding
      if (!isPresiding && !body.hashlock) {
        return reply.status(400).send({ error: 'hashlock is required when isPresiding is false' });
      }

      const result = await bridgeService.createBridge({
        privateKey: body.privateKey,
        receiver,
        amount,
        timelockHours: body.timelockHours ?? 1,
        chain: body.chain,
        isPresiding,
        hashlock: body.hashlock,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });

  // Generate secret/hashlock pair
  fastify.get('/bridge/generate-secret', async () => {
    const { secret, hashlock } = bridgeService.generateSecret();
    return { secret, hashlock };
  });

  // Withdraw: receiver claims tokens by providing the correct preimage
  fastify.post<{
    Body: {
      privateKey: string;
      contractId: string;
      preimage: string;
      chain?: string;
    };
  }>('/bridge/withdraw', async (request, reply) => {
    const { privateKey, contractId, preimage, chain } = request.body || {};

    if (!privateKey) {
      return reply.status(400).send({ error: 'privateKey is required' });
    }

    if (!contractId) {
      return reply.status(400).send({ error: 'contractId is required' });
    }

    if (!preimage) {
      return reply.status(400).send({ error: 'preimage is required' });
    }

    try {
      const result = await bridgeService.withdraw({
        privateKey,
        contractId,
        preimage,
        chain,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });

  // Refund: sender reclaims tokens after timelock expires
  fastify.post<{
    Body: {
      privateKey: string;
      contractId: string;
      chain?: string;
    };
  }>('/bridge/refund', async (request, reply) => {
    const { privateKey, contractId, chain } = request.body || {};

    if (!privateKey) {
      return reply.status(400).send({ error: 'privateKey is required' });
    }

    if (!contractId) {
      return reply.status(400).send({ error: 'contractId is required' });
    }

    try {
      const result = await bridgeService.refund({
        privateKey,
        contractId,
        chain,
      });

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });
};

export default bridgeRoutes;
