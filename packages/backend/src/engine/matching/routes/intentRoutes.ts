import type { FastifyPluginAsync } from 'fastify';
import { matchingService } from '../service/matchingService.js';
import { orderStore } from '../store/orderStore.js';
import { orderEvents, type OrderEvent } from '../../events/orderEvents.js';

// ---------------------------------------------------------------------------
// Intent & Match Routes
//
//   POST /intent           — submit an intent order
//   GET  /orders/:id       — query a single order's status
//   GET  /matches          — paginated list of recent match results
// ---------------------------------------------------------------------------

const intentRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // POST /intent
  // Body: { srcChain, desChain, amount, deadline }
  // -------------------------------------------------------------------------
  fastify.post<{
    Body: {
      srcChain: unknown;
      desChain: unknown;
      amount: unknown;
      incentiveFee?: unknown;
      deadline: unknown;
      userAddress: unknown;
    };
  }>('/intent', async (request, reply) => {
    const body = request.body as Record<string, unknown>;

    // Coarse presence check before passing to service validation
    const required = ['srcChain', 'desChain', 'amount', 'deadline', 'userAddress'] as const;
    for (const field of required) {
      if (body[field] === undefined || body[field] === null) {
        return reply.code(400).send({ error: `Missing required field: ${field}` });
      }
    }

    const result = matchingService.createOrder({
      srcChain: body.srcChain as number | string,
      desChain: body.desChain as number | string,
      amount: body.amount as string | number,
      incentiveFee: body.incentiveFee as string | number | undefined,
      deadline: body.deadline as number | string,
      userAddress: body.userAddress as string,
    });

    if ('error' in result) {
      return reply.code(400).send({ error: result.error });
    }

    return reply.code(201).send({ order: result.order });
  });

  // -------------------------------------------------------------------------
  // GET /orders/:id
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/orders/:id', async (request, reply) => {
    const order = orderStore.get(request.params.id);
    if (!order) {
      return reply.code(404).send({ error: 'Order not found' });
    }
    return reply.send({ order });
  });

  // -------------------------------------------------------------------------
  // GET /orders/:id/events
  // Server-Sent Events stream of lifecycle events for a single order.
  // The stream auto-closes after a 'done' or 'error' event.
  // -------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/orders/:id/events', async (request, reply) => {
    const { id } = request.params;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': request.headers.origin ?? '*',
      'Access-Control-Allow-Credentials': 'true',
    });
    reply.hijack();

    // Nudge the client to consider the stream "open" immediately.
    reply.raw.write(': connected\n\n');

    const listener = (event: OrderEvent) => {
      if (event.orderId !== id) return;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === 'done' || event.type === 'error') {
        reply.raw.end();
      }
    };

    orderEvents.on('order', listener);

    request.raw.on('close', () => {
      orderEvents.off('order', listener);
    });
  });

  // -------------------------------------------------------------------------
  // GET /matches?page=1&pageSize=20
  // -------------------------------------------------------------------------
  fastify.get<{
    Querystring: { page?: string; pageSize?: string };
  }>('/matches', async (request, reply) => {
    const page = Math.max(1, parseInt(request.query.page ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(request.query.pageSize ?? '20', 10) || 20));

    const result = orderStore.getMatchResults(page, pageSize);
    return reply.send(result);
  });
};

export default intentRoutes;
