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
    await orderStore.hydrate();
    await orchestrator.hydrate();
    fastify.log.info('Stores hydrated from Postgres');

    await fastify.register(cors, {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      credentials: true,
    });

    // register routes
    await fastify.register(approvalRoutes, { prefix: '/api' });
    await fastify.register(bridgeRoutes, { prefix: '/api' });
    await fastify.register(intentRoutes, { prefix: '/api' });
    await fastify.register(orchestratorRoutes, { prefix: '/api' });

    let lpConfigs: ReturnType<typeof loadLPConfigsFromEnv> | null = null;
    try {
      lpConfigs = loadLPConfigsFromEnv();
    } catch {
      console.warn('[LiquidityService] LP keys not found — falling back to default scheduler');
    }

    // start liquidity market service if LP keys are available
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

    // start server
    await fastify.listen({ port: PORT, host: HOST });

    console.log(`Backend server running on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
