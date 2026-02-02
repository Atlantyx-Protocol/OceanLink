import { FastifyPluginAsync } from 'fastify';
import { approvalService } from '../engine/execution/approval.js';
import { getChainConfig, getAllChainConfigs, CHAIN_KEYS } from '../config/chains.js';

const usdcRoutes: FastifyPluginAsync = async (fastify) => {
  // Approve USDC for all chains
  fastify.post('/usdc/approve/all', async (request, reply) => {
    try {
      const results = await approvalService.approveUSDCForAllChains();
      return { success: true, results };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error, 'Failed to approve USDC for all chains');
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // Approve USDC for a specific chain
  fastify.post<{ Params: { chain: string } }>(
    '/usdc/approve/:chain',
    async (request, reply) => {
      const { chain } = request.params;

      if (!getChainConfig(chain)) {
        return reply.status(400).send({
          success: false,
          error: `Unknown chain: ${chain}. Available: ${CHAIN_KEYS.join(', ')}`,
        });
      }

      try {
        const result = await approvalService.approveUSDCForSpecificChain(chain);
        return { success: true, result };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        fastify.log.error(error, `Failed to approve USDC for ${chain}`);
        return reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // Get USDC allowance for an address on a specific chain
  fastify.get<{ Params: { chain: string }; Querystring: { address: string } }>(
    '/usdc/allowance/:chain',
    async (request, reply) => {
      const { chain } = request.params;
      const { address } = request.query;

      if (!address) {
        return reply.status(400).send({
          success: false,
          error: 'address query parameter is required',
        });
      }

      if (!getChainConfig(chain)) {
        return reply.status(400).send({
          success: false,
          error: `Unknown chain: ${chain}. Available: ${CHAIN_KEYS.join(', ')}`,
        });
      }

      try {
        const result = await approvalService.getAllowance(chain, address);
        return {
          success: true,
          chain,
          address,
          allowance: result.allowance,
          htlcAddress: result.htlcAddress,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        fastify.log.error(error, `Failed to get USDC allowance for ${address} on ${chain}`);
        return reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // Get USDC balance for an address on a specific chain
  fastify.get<{ Params: { chain: string }; Querystring: { address: string } }>(
    '/usdc/balance/:chain',
    async (request, reply) => {
      const { chain } = request.params;
      const { address } = request.query;

      if (!address) {
        return reply.status(400).send({
          success: false,
          error: 'address query parameter is required',
        });
      }

      if (!getChainConfig(chain)) {
        return reply.status(400).send({
          success: false,
          error: `Unknown chain: ${chain}. Available: ${CHAIN_KEYS.join(', ')}`,
        });
      }

      try {
        const result = await approvalService.getBalance(chain, address);
        return {
          success: true,
          chain,
          address,
          balance: result.balance,
          decimals: result.decimals,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        fastify.log.error(error, `Failed to get USDC balance for ${address} on ${chain}`);
        return reply.status(500).send({ success: false, error: message });
      }
    }
  );

  // Get available chains
  fastify.get('/usdc/chains', async () => {
    const configs = getAllChainConfigs();
    return {
      success: true,
      chains: Object.entries(configs).map(([key, config]) => ({
        key,
        name: config.name,
        chainId: config.chainId,
        usdcAddress: config.usdcAddress,
        htlcAddress: config.htlcAddress,
      })),
    };
  });
};

export default usdcRoutes;
