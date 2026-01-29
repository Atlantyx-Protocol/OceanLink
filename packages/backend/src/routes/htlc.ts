import { FastifyPluginAsync } from 'fastify';
import { htlcService } from '../services/htlc.js';
import { getChainConfig } from '../config/chains.js';

const htlcRoutes: FastifyPluginAsync = async (fastify) => {
  // Generate hash pair (preimage + hashlock)
  fastify.get('/htlc/generate-hash', async () => {
    const { preimage, hashlock } = htlcService.generateHashPair();
    return { preimage, hashlock };
  });

  // Create new HTLC
  fastify.post<{
    Body: {
      chain: string;
      receiver: string;
      hashlock: string;
      timelock: number;
      amount: string;
    };
  }>('/htlc/new', async (request, reply) => {
    const { chain, receiver, hashlock, timelock, amount } = request.body;
    const config = getChainConfig(chain);

    if (!config) {
      return reply.status(400).send({ error: `Unknown chain: ${chain}` });
    }

    try {
      const result = await htlcService.newContract(chain, {
        receiver,
        hashlock,
        timelock,
        token: config.usdcAddress,
        amount: BigInt(amount),
      });

      return { success: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });

  // Withdraw from HTLC
  fastify.post<{
    Body: {
      chain: string;
      contractId: string;
      preimage: string;
    };
  }>('/htlc/withdraw', async (request, reply) => {
    const { chain, contractId, preimage } = request.body;

    if (!getChainConfig(chain)) {
      return reply.status(400).send({ error: `Unknown chain: ${chain}` });
    }

    try {
      const result = await htlcService.withdraw(chain, contractId, preimage);
      return { success: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });

  // Refund HTLC
  fastify.post<{
    Body: {
      chain: string;
      contractId: string;
    };
  }>('/htlc/refund', async (request, reply) => {
    const { chain, contractId } = request.body;

    if (!getChainConfig(chain)) {
      return reply.status(400).send({ error: `Unknown chain: ${chain}` });
    }

    try {
      const result = await htlcService.refund(chain, contractId);
      return { success: true, ...result };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });

  // Get HTLC details
  fastify.get<{
    Params: { chain: string; id: string };
  }>('/htlc/:chain/:id', async (request, reply) => {
    const { chain, id } = request.params;

    if (!getChainConfig(chain)) {
      return reply.status(400).send({ error: `Unknown chain: ${chain}` });
    }

    try {
      const exists = await htlcService.exists(chain, id);
      if (!exists) {
        return reply.status(404).send({ error: 'Contract not found' });
      }

      const data = await htlcService.getContract(chain, id);
      return {
        ...data,
        amount: data.amount.toString(),
        timelock: data.timelock.toString(),
        nonce: data.nonce.toString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });
};

export default htlcRoutes;
