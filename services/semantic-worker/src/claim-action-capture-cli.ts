import 'dotenv/config';

import { loadClaimActionsCaptureWorkerConfig } from './claim-action-capture-config.js';
import {
  createClaimActionsCaptureWorkerResources,
  runClaimActionsCaptureWorkerLoop,
} from './claim-action-capture-worker.js';
import { publicWorkerError } from './errors.js';

const HELP = `ZeroTrace durable Claim Actions capture worker

Usage:
  npm run claims:actions:capture [-- --once]

The worker leases reviewed EVM Claim Actions ranges, requires a finalized BSC Snapshot,
collects both address directions through SQD, and writes immutable Evidence-bound verification
reports. Action Semantics remains explicitly Unknown until a window-complete action adapter exists.
The worker is read-only and never accepts private keys, signs, swaps, or broadcasts.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let resources: ReturnType<typeof createClaimActionsCaptureWorkerResources> | undefined;
  try {
    const config = loadClaimActionsCaptureWorkerConfig(process.env, args);
    resources = createClaimActionsCaptureWorkerResources(config);
    process.stdout.write(
      `${JSON.stringify({ event: 'claim_actions_capture_worker_started', owner: config.owner, once: config.once })}\n`,
    );
    await runClaimActionsCaptureWorkerLoop(config, resources, {
      signal: controller.signal,
      emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    });
  } catch (error) {
    const safe = publicWorkerError(error, 'CLAIM_ACTIONS_CAPTURE_WORKER_FAILED');
    process.stderr.write(
      `${JSON.stringify({ event: 'claim_actions_capture_worker_failed', ...safe })}\n`,
    );
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await resources?.close();
  }
}

await main();
