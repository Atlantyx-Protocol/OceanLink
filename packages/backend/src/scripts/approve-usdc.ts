import dotenv from 'dotenv';
import { approvalService } from '../services/approval.js';
import { getChainConfig, CHAIN_KEYS } from '../config/chains.js';

dotenv.config({ path: '../../../.env' });

async function main() {
  const args = process.argv.slice(2);
  const chainArg = args[0];

  console.log('='.repeat(60));
  console.log('USDC Approval Script for HTLC Contracts');
  console.log('='.repeat(60));
  console.log('');

  if (chainArg && chainArg !== 'all') {
    // Approve for specific chain
    if (!getChainConfig(chainArg)) {
      console.error(`Unknown chain: ${chainArg}`);
      console.log(`Available chains: ${CHAIN_KEYS.join(', ')}`);
      process.exit(1);
    }

    console.log(`Approving USDC for ${chainArg}...\n`);
    const result = await approvalService.approveUSDCForSpecificChain(chainArg);
    console.log('\nResult:', JSON.stringify(result, null, 2));
  } else {
    // Approve for all chains
    console.log('Approving USDC for all chains...\n');
    const results = await approvalService.approveUSDCForAllChains();

    console.log('\n' + '='.repeat(60));
    console.log('Summary:');
    console.log('='.repeat(60));

    for (const result of results) {
      const status = result.status === 'success'
        ? '✓ SUCCESS'
        : result.status === 'already_approved'
          ? '○ ALREADY APPROVED'
          : '✗ FAILED';

      console.log(`${status} - ${result.chain}`);
      if (result.txHash) {
        console.log(`  TX: ${result.txHash}`);
      }
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      }
    }
  }

  console.log('\nDone.');
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
