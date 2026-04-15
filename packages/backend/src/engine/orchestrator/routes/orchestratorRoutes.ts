import type { FastifyPluginAsync } from 'fastify';
import { orchestrator } from '../orchestrator.js';

// ---------------------------------------------------------------------------
// Orchestrator Routes
//
//   GET /match-execution/:matchId — poll execution status for a match
// ---------------------------------------------------------------------------

const orchestratorRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { matchId: string } }>(
    '/match-execution/:matchId',
    async (request, reply) => {
      const { matchId } = request.params;
      const record = orchestrator.getExecution(matchId);

      if (!record) {
        return reply.code(404).send({ success: false, error: 'Match execution not found' });
      }

      if (record.status === 'pending') {
        return reply.send({ success: false, status: 'pending' });
      }

      if (record.status === 'error') {
        return reply.code(500).send({ success: false, status: 'error', error: record.error });
      }

      return reply.send({ success: true, status: 'done', data: record.data });
    }
  );
};

export default orchestratorRoutes;
