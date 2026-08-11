import 'dotenv/config';

import { loadActionCaptureWorkerConfig } from './action-capture-config.js';
import {
  createActionCaptureWorkerResources,
  runActionCaptureWorkerLoop,
} from './action-capture-worker.js';
import { publicWorkerError } from './errors.js';

const HELP = `ZeroTrace durable Action Semantics capture worker

Usage:
  npm run actions:capture [-- --once]

The worker leases read-only transaction captures, requires completed SQD ledger-record coverage,
and writes Evidence-bound immutable reports. It never signs or broadcasts transactions.`;

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
  let resources: ReturnType<typeof createActionCaptureWorkerResources> | undefined;
  try {
    const config = loadActionCaptureWorkerConfig(process.env, args);
    resources = createActionCaptureWorkerResources(config);
    process.stdout.write(
      `${JSON.stringify({ event: 'action_capture_worker_started', owner: config.owner, once: config.once })}\n`,
    );
    await runActionCaptureWorkerLoop(config, resources, {
      signal: controller.signal,
      emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    });
  } catch (error) {
    const safe = publicWorkerError(error, 'ACTION_CAPTURE_WORKER_FAILED');
    process.stderr.write(`${JSON.stringify({ event: 'action_capture_worker_failed', ...safe })}\n`);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await resources?.close();
  }
}

await main();
