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
    try {
      const lpConfigs = loadLPConfigsFromEnv();
      const liquidityService = new LiquidityService(matchingService, orderStore, lpConfigs);
      liquidityService.start();

      const shutdown = () => {
        liquidityService.stop();
        void fastify.close();
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    } catch {
      // No LP keys — fall back to the default match scheduler (user↔user matching only)
      console.warn('[LiquidityService] LP keys not found — falling back to default scheduler');
      matchScheduler.start();

      const shutdown = () => {
        matchScheduler.stop();
        void fastify.close();
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
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
