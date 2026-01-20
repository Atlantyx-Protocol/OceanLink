import { FastifyPluginAsync } from 'fastify';
import { contractService } from '../services/contract.js';

export const contractRoutes: FastifyPluginAsync = async (fastify) => {
  // Get contract info
  fastify.get('/info', async (request, reply) => {
    try {
      const info = await contractService.getContractInfo();
      return { success: true, data: info };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to fetch contract info',
      });
    }
  });

  // Example: Read contract data
  fastify.get('/data/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const data = await contractService.readContractData(id);
      return { success: true, data };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({
        success: false,
        error: 'Failed to read contract data',
      });
    }
  });
};