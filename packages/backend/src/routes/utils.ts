import type { FastifyReply, FastifyRequest } from 'fastify';
import { getChainConfig, CHAIN_KEYS } from '../config/chains.js';

/**
 * Wraps an async route handler with standardized error handling.
 * Catches thrown errors, logs them, and returns a consistent JSON error response.
 */
export function wrapHandler<T>(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<T>
) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      return await handler(request, reply);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      request.server.log.error(error);
      return reply.status(500).send({ error: message });
    }
  };
}

/**
 * Validates a chain key parameter. Returns the validated key if valid,
 * or sends a 400 error response and returns null if invalid.
 */
export function validateChainKey(chain: string, reply: FastifyReply): string | null {
  if (!getChainConfig(chain)) {
    reply.status(400).send({
      success: false,
      error: `Unknown chain: ${chain}. Available: ${CHAIN_KEYS.join(', ')}`,
    });
    return null;
  }
  return chain;
}
