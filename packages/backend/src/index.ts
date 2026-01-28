import Fastify from 'fastify';
import cors from '@fastify/cors';
import dotenv from 'dotenv';
import { healthRoutes } from './routes/health.js';
import { contractRoutes } from './routes/contracts.js';
import approvalRoutes from './routes/approval.js';
import htlcRoutes from './routes/htlc.js';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';

const fastify = Fastify({
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
    await fastify.register(healthRoutes, { prefix: '/api' });
    await fastify.register(contractRoutes, { prefix: '/api/contracts' });
    await fastify.register(approvalRoutes, { prefix: '/api' });
    await fastify.register(htlcRoutes, { prefix: '/api' });

    // Start server
    await fastify.listen({ port: PORT, host: HOST });
    
    console.log(`🚀 Backend server running on http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();