import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import approvalRoutes from './routes/usdc.js';
import bridgeRoutes from './routes/bridge.js';
import intentRoutes from './engine/matching/routes/intentRoutes.js';
import orchestratorRoutes from './engine/orchestrator/routes/orchestratorRoutes.js';
import { matchScheduler } from './engine/matching/scheduler/matchScheduler.js';
import { LiquidityService, loadLPConfigsFromEnv } from './engine/liquidity/liquidityService.js';
import { matchingService } from './engine/matching/service/matchingService.js';
import { orderStore } from './engine/matching/store/orderStore.js';
import { orchestrator } from './engine/orchestrator/orchestrator.js';

dotenv.config({ path: '../../.env' });

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
  disableRequestLogging: true, // suppress automatic "incoming request" / "request completed" logs
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  },
});

async function start() {
  try {
    // Hydrate in-memory stores from Postgres before the scheduler starts,
    // so any orders/matches/executions persisted in a previous run are
    // restored. Failure here is fatal — better to crash than silently lose
    // pending bridge state.
    await orderStore.hydrate();
    await orchestrator.hydrate();
    fastify.log.info('Stores hydrated from Postgres');

    // Register CORS
    await fastify.register(cors, {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
    });

    // Register routes
    await fastify.register(approvalRoutes, { prefix: '/api' });
    await fastify.register(bridgeRoutes, { prefix: '/api' });
    await fastify.register(intentRoutes, { prefix: '/api' });
    await fastify.register(orchestratorRoutes, { prefix: '/api' });

    // Start liquidity market service if LP keys are available.
    // The liquidity service runs its own matching loop (with LP-aware filtering)
    // so the default matchScheduler is only used as fallback.
    //
    // Approval-failures from liquidityService.start() are NOT caught here:
    // they must crash the boot so the operator fixes pre-approvals rather
    // than silently downgrading to the fallback scheduler.
    let lpConfigs: ReturnType<typeof loadLPConfigsFromEnv> | null = null;
    try {
      lpConfigs = loadLPConfigsFromEnv();
    } catch {
      console.warn('[LiquidityService] LP keys not found — falling back to default scheduler');
    }

    if (lpConfigs) {
      const liquidityService = new LiquidityService(matchingService, orderStore, lpConfigs);
      await liquidityService.start();

      const shutdown = async () => {
        liquidityService.stop();
        await fastify.close();
        process.exit(0);
      };
      process.once('SIGINT', () => void shutdown());
      process.once('SIGTERM', () => void shutdown());
    } else {
      matchScheduler.start();

      const shutdown = async () => {
        matchScheduler.stop();
        await fastify.close();
        process.exit(0);
      };
      process.once('SIGINT', () => void shutdown());
      process.once('SIGTERM', () => void shutdown());
    }

    // Start server
    await fastify.listen({ port: PORT, host: HOST });

    console.log(`Backend server running on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
