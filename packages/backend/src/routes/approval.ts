import { FastifyPluginAsync } from 'fastify';
import { approvalService } from '../services/approval.js';
import { getChainConfig, getAllChainConfigs, CHAIN_KEYS } from '../config/chains.js';

const approvalRoutes: FastifyPluginAsync = async (fastify) => {
  // Approve USDC for all chains
  fastify.post('/approval/all', async (request, reply) => {
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
    '/approval/:chain',
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

  // Get all current allowances
  fastify.get('/approval/allowances', async (request, reply) => {
    try {
      const allowances = await approvalService.getAllAllowances();
      return { success: true, allowances };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error, 'Failed to get allowances');
      return reply.status(500).send({ success: false, error: message });
    }
  });

  // Get available chains
  fastify.get('/approval/chains', async () => {
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

export default approvalRoutes;
