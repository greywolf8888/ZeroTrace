import { loadWorkspaceEnv } from './workspace-env.js';

loadWorkspaceEnv();

import { loadFlapOriginWorkerConfig } from './config.js';
import { publicWorkerError } from './errors.js';
import { createFlapOriginWorkerResources, runFlapOriginWorker } from './worker.js';

const HELP = `ZeroTrace durable Flap contract-origin scan

Usage:
  npm run flap:origin -- --token <address> --from <block> --to <block> [--chunk-size <blocks>]

The worker scans finalized BNB Smart Chain history through SQD, verifies a unique creation
against the exact read-only RPC transaction Snapshot, and checkpoints every completed chunk.
Re-running the exact command resumes after interruption or replays an immutable terminal result.

This worker never accepts private keys and never signs or broadcasts transactions.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  let resources: ReturnType<typeof createFlapOriginWorkerResources> | undefined;
  try {
    const config = loadFlapOriginWorkerConfig(process.env, args);
    resources = createFlapOriginWorkerResources(config);
    const result = await runFlapOriginWorker(config, resources);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const safe = publicWorkerError(error);
    process.stderr.write(`${JSON.stringify({ event: 'flap_origin_scan_failed', ...safe })}\n`);
    process.exitCode = 1;
  } finally {
    await resources?.close();
  }
}

await main();
