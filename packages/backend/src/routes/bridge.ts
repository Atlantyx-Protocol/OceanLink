import { FastifyPluginAsync } from 'fastify';
import { bridgeService } from '../engine/execution/bridge.js';

const bridgeRoutes: FastifyPluginAsync = async (fastify) => {
  // Create order with multiple fills: approve + newOrder
  // Timelock is configured via TIME_LOCK env variable (in minutes, default 1)
  fastify.post<{
    Body: {
      privateKey: string; // required: private key of the sender
      receivers: string[]; // required: array of receiver addresses
      amounts: string[]; // required: array of amounts (as strings for bigint)
      chain?: string; // optional, defaults to 'sepolia'
      isPresiding?: boolean; // optional, if true generate new secrets, default false
      hashlocks?: string[]; // required when isPresiding is false
    };
  }>('/bridge/create', async (request, reply) => {
    try {
      const body = request.body || {};

      if (!body.privateKey) {
        return reply.status(400).send({ error: 'privateKey is required' });
      }

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

      // Validate hashlocks when not presiding
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

      // Convert amounts to bigint
      const amounts = body.amounts.map((amt) => BigInt(amt));

      const result = await bridgeService.createOrder({
        privateKey: body.privateKey,
        receivers: body.receivers,
        amounts,
        chain: body.chain,
        isPresiding,
        hashlocks: body.hashlocks,
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
      orderId: string;
      fillId: string;
      preimage: string;
      chain?: string;
    };
  }>('/bridge/withdraw', async (request, reply) => {
    const { privateKey, orderId, fillId, preimage, chain } = request.body || {};

    if (!privateKey) {
      return reply.status(400).send({ error: 'privateKey is required' });
    }

    if (orderId === undefined || orderId === null) {
      return reply.status(400).send({ error: 'orderId is required' });
    }

    if (fillId === undefined || fillId === null) {
      return reply.status(400).send({ error: 'fillId is required' });
    }

    if (!preimage) {
      return reply.status(400).send({ error: 'preimage is required' });
    }

    try {
      const result = await bridgeService.withdraw({
        privateKey,
        orderId: orderId.toString(),
        fillId: fillId.toString(),
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
      orderId: string;
      chain?: string;
    };
  }>('/bridge/refund', async (request, reply) => {
    const { privateKey, orderId, chain } = request.body || {};

    if (!privateKey) {
      return reply.status(400).send({ error: 'privateKey is required' });
    }

    if (orderId === undefined || orderId === null) {
      return reply.status(400).send({ error: 'orderId is required' });
    }

    try {
      const result = await bridgeService.refund({
        privateKey,
        orderId: orderId.toString(),
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

  // Get next order id

  // Get order details
  fastify.get<{
    Params: { orderId: string };
    Querystring: { chain?: string };
  }>('/bridge/order/:orderId', async (request, reply) => {
    const { orderId } = request.params;
    const { chain } = request.query;

    try {
      const order = await bridgeService.getOrder({
        orderId,
        chain,
      });

      return {
        success: true,
        data: order,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });

  // Get fill details
  fastify.get<{
    Params: { orderId: string; fillId: string };
    Querystring: { chain?: string };
  }>('/bridge/order/:orderId/fill/:fillId', async (request, reply) => {
    const { orderId, fillId } = request.params;
    const { chain } = request.query;

    try {
      const fill = await bridgeService.getFill({
        orderId,
        fillId,
        chain,
      });

      return {
        success: true,
        data: fill,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });

  // Get all fills for an order
  fastify.get<{
    Params: { orderId: string };
    Querystring: { chain?: string };
  }>('/bridge/order/:orderId/fills', async (request, reply) => {
    const { orderId } = request.params;
    const { chain } = request.query;

    try {
      const fills = await bridgeService.getOrderFills({
        orderId,
        chain,
      });

      return {
        success: true,
        data: fills,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      fastify.log.error(error);
      return reply.status(500).send({ error: message });
    }
  });
};

export default bridgeRoutes;
