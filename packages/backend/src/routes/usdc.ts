import { FastifyPluginAsync } from 'fastify';
import { approvalService } from '../engine/execution/approval.js';
import { getAllChainConfigs } from '../config/chains.js';
import { wrapHandler, validateChainKey } from './utils.js';

const usdcRoutes: FastifyPluginAsync = async (fastify) => {
  // USDC allowance for an address on a chain.
  fastify.get<{ Params: { chain: string }; Querystring: { address: string } }>(
    '/usdc/allowance/:chain',
    wrapHandler(async (request, reply) => {
      const { chain } = (request as any).params;
      const { address } = (request as any).query;

      if (!address) {
        return reply
          .status(400)
          .send({ success: false, error: 'address query parameter is required' });
      }
      if (!validateChainKey(chain, reply)) return;

      const result = await approvalService.getAllowance(chain, address);
      return {
        success: true,
        chain,
        address,
        allowance: result.allowance,
        htlcAddress: result.htlcAddress,
      };
    })
  );

  // USDC balance for an address on a chain.
  fastify.get<{ Params: { chain: string }; Querystring: { address: string } }>(
    '/usdc/balance/:chain',
    wrapHandler(async (request, reply) => {
      const { chain } = (request as any).params;
      const { address } = (request as any).query;

      if (!address) {
        return reply
          .status(400)
          .send({ success: false, error: 'address query parameter is required' });
      }
      if (!validateChainKey(chain, reply)) return;

      const result = await approvalService.getBalance(chain, address);
      return { success: true, chain, address, balance: result.balance, decimals: result.decimals };
    })
  );

  // approve USDC spending on a chain.
  fastify.post<{ Params: { chain: string }; Body: { privateKey: string; amount?: string } }>(
    '/usdc/approve/:chain',
    wrapHandler(async (request, reply) => {
      const { chain } = (request as any).params;
      const { privateKey, amount } = (request as any).body;

      if (!privateKey) {
        return reply.status(400).send({ success: false, error: 'privateKey is required' });
      }
      if (!validateChainKey(chain, reply)) return;

      const result = await approvalService.approve(chain, privateKey, amount);
      return { success: true, chain, address: result.address, txHash: result.txHash };
    })
  );

  // derive wallet address from private key.
  fastify.post<{ Body: { privateKey: string } }>(
    '/usdc/wallet-address',
    wrapHandler(async (request, reply) => {
      const { privateKey } = (request as any).body;

      if (!privateKey) {
        return reply.status(400).send({ success: false, error: 'privateKey is required' });
      }

      const address = approvalService.addressFromKey(privateKey);
      return { success: true, address };
    })
  );

  // list available chains.
  fastify.get('/usdc/chains', async () => {
    const configs = getAllChainConfigs();
    return {
      success: true,
      chains: Object.entries(configs).map(([key, config]) => ({
        key,
        name: config.name,
        chainId: config.chainId,
        usdcAddress: config.usdcAddress,
        htlcAddress: config.htlcAddress,
      })),
    };
  });
};

export default usdcRoutes;
