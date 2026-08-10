import 'dotenv/config';

import { loadBurnPromotionWorkerConfig } from './burn-promotion-config.js';
import {
  createBurnPromotionWorkerResources,
  runBurnPromotionWorker,
} from './burn-promotion-worker.js';
import { publicWorkerError } from './errors.js';

const HELP = `ZeroTrace durable ERC-20 burn candidate promotion

Usage:
  npm run claims:burn:promote -- --token <address> --from <block> --to <block>
    [--segment-size <blocks>] [--max-transfers <count>]
    [--max-candidates-per-segment <count>]

The worker scans finalized BNB Smart Chain zero-address Transfer events through SQD,
then promotes every discovered burn candidate through an exact-block totalSupply and
complete Transfer conservation certificate. Evidence and semantic checkpoints are
persisted before the cursor advances; the returned scan ID supports provider-free replay.

Silent totalSupply changes remain Unknown. This worker never accepts private keys and
never signs, swaps, or broadcasts transactions.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  let resources: ReturnType<typeof createBurnPromotionWorkerResources> | undefined;
  try {
    const config = loadBurnPromotionWorkerConfig(process.env, args);
    resources = createBurnPromotionWorkerResources(config);
    const result = await runBurnPromotionWorker(config, resources);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const safe = publicWorkerError(error, 'ERC20_BURN_PROMOTION_FAILED');
    process.stderr.write(`${JSON.stringify({ event: 'erc20_burn_promotion_failed', ...safe })}\n`);
    process.exitCode = 1;
  } finally {
    await resources?.close();
  }
}

await main();
