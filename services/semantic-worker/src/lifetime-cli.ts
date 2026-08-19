import { loadWorkspaceEnv } from './workspace-env.js';

loadWorkspaceEnv();

import { publicWorkerError } from './errors.js';
import { loadFlapLifetimeWorkerConfig } from './lifetime-config.js';
import { createFlapLifetimeWorkerResources, runFlapLifetimeWorker } from './lifetime-worker.js';

const HELP = `ZeroTrace exact finalized Flap lifetime materialization

Usage:
  npm run flap:lifetime -- --token <address> [--target <finalized-block>]
    [--origin-hint-block <finalized-block>]
    [--origin-chunk-size <blocks>] [--history-segment-size <blocks>]
    [--history-chunk-size <blocks>] [--history-max-transactions <count>]
    [--history-max-logs <count>] [--sqd-creation-request-range-size <blocks>]

The worker reads the official SQD binance-mainnet dataset start, captures the current finalized
BSC head (or proves an explicit target is not above it), finds a unique deployment origin, and
projects every supported Flap Portal event from that origin through the same target Snapshot.
An explicit origin hint is verified against SQD and finalized RPC but keeps lifetime coverage
Unknown until the full dataset origin search is complete.

Lifetime coverage becomes Known(true) only when both child scans are complete and Snapshot-exact.
Otherwise it remains Unknown or the run fails closed. The worker never accepts private keys and
never signs or broadcasts transactions.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  let resources: ReturnType<typeof createFlapLifetimeWorkerResources> | undefined;
  try {
    const config = loadFlapLifetimeWorkerConfig(process.env, args);
    resources = createFlapLifetimeWorkerResources(config);
    const result = await runFlapLifetimeWorker(config, resources);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const safe = publicWorkerError(error);
    process.stderr.write(
      `${JSON.stringify({ event: 'flap_lifetime_materialization_failed', ...safe })}\n`,
    );
    process.exitCode = 1;
  } finally {
    await resources?.close();
  }
}

await main();
