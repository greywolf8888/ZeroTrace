import { loadWorkspaceEnv } from './workspace-env.js';

loadWorkspaceEnv();

import { publicWorkerError } from './errors.js';
import { loadSupplyContinuityWorkerConfig } from './supply-continuity-config.js';
import {
  createSupplyContinuityWorkerResources,
  runSupplyContinuityWorker,
} from './supply-continuity-worker.js';

const HELP = `ZeroTrace durable ERC-20 all-block supply continuity

Usage:
  npm run claims:supply:scan -- --token <address> --from <block> --to <block>
    [--segment-size <count>] [--max-transfers <count>]

The worker compares totalSupply at every finalized block transition through EIP-1898 canonical
block-hash calls. Every observed supply change is reconciled against complete same-block mint/burn
Transfer coverage before the checkpoint advances. Independent operators are required for a verified
result; same-operator or unregistered sources remain INCONCLUSIVE.

This worker accepts no private keys, signs nothing, and never broadcasts a transaction.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }
  let resources: ReturnType<typeof createSupplyContinuityWorkerResources> | undefined;
  try {
    const config = loadSupplyContinuityWorkerConfig(process.env, args);
    resources = createSupplyContinuityWorkerResources(config);
    const result = await runSupplyContinuityWorker(config, resources);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const safe = publicWorkerError(error, 'ERC20_SUPPLY_CONTINUITY_FAILED');
    process.stderr.write(
      `${JSON.stringify({ event: 'erc20_supply_continuity_failed', ...safe })}\n`,
    );
    process.exitCode = 1;
  } finally {
    await resources?.close();
  }
}

await main();
