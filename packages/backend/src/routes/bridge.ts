import { FastifyPluginAsync } from 'fastify';
import { bridgeService } from '../services/bridge.js';

const bridgeRoutes: FastifyPluginAsync = async (fastify) => {
  // Create bridge: approve + newContract on Sepolia
  // Uses PRIVATE_KEY_A, receiver = address of A, amount = 700 USDC, timelock = 2 hours
  fastify.post<{
    Body: {
      receiver?: string; // optional, defaults to sender address (A)
      amount?: string; // optional, defaults to 700 USDC (700 * 1e6)
    };
  }>('/bridge/create', async (request, reply) => {
    const privateKeyA = process.env.PRIVATE_KEY_A;

    if (!privateKeyA) {
      return reply.status(400).send({ error: 'PRIVATE_KEY_A not configured' });
    }

    try {
      const body = request.body || {};

      // Default amount is 700 USDC (6 decimals)
      const amount = body.amount ? BigInt(body.amount) : BigInt(700 * 1e6);

      // Get sender address from private key to use as default receiver
      const { ethers } = await import('ethers');
      const wallet = new ethers.Wallet(privateKeyA);
      const senderAddress = wallet.address;

      const receiver = body.receiver || senderAddress;

      const result = await bridgeService.createBridge({
        privateKey: privateKeyA,
        receiver,
        amount,
        timelockHours: 2,
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
      contractId: string;
      preimage: string;
    };
  }>('/bridge/withdraw', async (request, reply) => {
    const privateKeyA = process.env.PRIVATE_KEY_A;

    if (!privateKeyA) {
      return reply.status(400).send({ error: 'PRIVATE_KEY_A not configured' });
    }

    const { contractId, preimage } = request.body || {};

    if (!contractId) {
      return reply.status(400).send({ error: 'contractId is required' });
    }

    if (!preimage) {
      return reply.status(400).send({ error: 'preimage is required' });
    }

    try {
      const result = await bridgeService.withdraw({
        privateKey: privateKeyA,
        contractId,
        preimage,
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
      contractId: string;
    };
  }>('/bridge/refund', async (request, reply) => {
    const privateKeyA = process.env.PRIVATE_KEY_A;

    if (!privateKeyA) {
      return reply.status(400).send({ error: 'PRIVATE_KEY_A not configured' });
    }

    const { contractId } = request.body || {};

    if (!contractId) {
      return reply.status(400).send({ error: 'contractId is required' });
    }

    try {
      const result = await bridgeService.refund({
        privateKey: privateKeyA,
        contractId,
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
