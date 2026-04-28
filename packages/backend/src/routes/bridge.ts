import { FastifyPluginAsync } from 'fastify';
import { bridgeService } from '../engine/execution/bridge.js';
import { wrapHandler } from './utils.js';

const bridgeRoutes: FastifyPluginAsync = async (fastify) => {
  // Create order with multiple fills: approve + newOrder
  fastify.post<{
    Body: {
      receivers: string[];
      amounts: string[];
      chain?: string;
      isPresiding?: boolean;
      hashlocks?: string[];
      onBehalfOf?: string;
    };
  }>(
    '/bridge/create',
    wrapHandler(async (request, reply) => {
      const body = (request.body as any) || {};

      if (!body.receivers || !Array.isArray(body.receivers) || body.receivers.length === 0) {
        return reply
          .status(400)
          .send({ error: 'receivers array is required and must not be empty' });
      }

      if (!body.amounts || !Array.isArray(body.amounts) || body.amounts.length === 0) {
        return reply.status(400).send({ error: 'amounts array is required and must not be empty' });
      }

      if (body.receivers.length !== body.amounts.length) {
        return reply
          .status(400)
          .send({ error: 'receivers and amounts arrays must have the same length' });
      }

      const isPresiding = body.isPresiding ?? false;

      if (!isPresiding) {
        if (
          !body.hashlocks ||
          !Array.isArray(body.hashlocks) ||
          body.hashlocks.length !== body.receivers.length
        ) {
          return reply.status(400).send({
            error:
              'hashlocks array is required and must match receivers length when isPresiding is false',
          });
        }
      }

      const result = await bridgeService.createOrder({
        receivers: body.receivers,
        amounts: body.amounts.map(String),
        chain: body.chain,
        isPresiding,
        hashlocks: body.hashlocks,
        onBehalfOf: body.onBehalfOf,
      });

      return { success: true, data: result };
    })
  );

  // Generate secret/hashlock pair
  fastify.get('/bridge/generate-secret', async () => {
    const { secret, hashlock } = bridgeService.generateSecret();
    return { secret, hashlock };
  });

  // Withdraw: receiver claims tokens by providing the correct preimage
  fastify.post<{
    Body: { orderId: string; fillId: string; preimage: string; chain?: string };
  }>(
    '/bridge/withdraw',
    wrapHandler(async (request, reply) => {
      const { orderId, fillId, preimage, chain } = (request.body as any) || {};

      if (orderId === undefined || orderId === null) {
        return reply.status(400).send({ error: 'orderId is required' });
      }
      if (fillId === undefined || fillId === null) {
        return reply.status(400).send({ error: 'fillId is required' });
      }
      if (!preimage) {
        return reply.status(400).send({ error: 'preimage is required' });
      }

      const result = await bridgeService.withdraw({
        orderId: orderId.toString(),
        fillId: fillId.toString(),
        preimage,
        chain,
      });

      return { success: true, data: result };
    })
  );

  // Refund: sender reclaims tokens after timelock expires
  fastify.post<{ Body: { orderId: string; chain?: string } }>(
    '/bridge/refund',
    wrapHandler(async (request, reply) => {
      const { orderId, chain } = (request.body as any) || {};

      if (orderId === undefined || orderId === null) {
        return reply.status(400).send({ error: 'orderId is required' });
      }

      const result = await bridgeService.refund({ orderId: orderId.toString(), chain });
      return { success: true, data: result };
    })
  );

  // Get order details
  fastify.get<{ Params: { orderId: string }; Querystring: { chain?: string } }>(
    '/bridge/order/:orderId',
    wrapHandler(async (request) => {
      const { orderId } = (request as any).params;
      const { chain } = (request as any).query;
      const order = await bridgeService.getOrder({ orderId, chain });
      return { success: true, data: order };
    })
  );

  // Get fill details
  fastify.get<{ Params: { orderId: string; fillId: string }; Querystring: { chain?: string } }>(
    '/bridge/order/:orderId/fill/:fillId',
    wrapHandler(async (request) => {
      const { orderId, fillId } = (request as any).params;
      const { chain } = (request as any).query;
      const fill = await bridgeService.getFill({ orderId, fillId, chain });
      return { success: true, data: fill };
    })
  );

  // Get all fills for an order
  fastify.get<{ Params: { orderId: string }; Querystring: { chain?: string } }>(
    '/bridge/order/:orderId/fills',
    wrapHandler(async (request) => {
      const { orderId } = (request as any).params;
      const { chain } = (request as any).query;
      const fills = await bridgeService.getOrderFills({ orderId, chain });
      return { success: true, data: fills };
    })
  );
};

export default bridgeRoutes;
