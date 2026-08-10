import 'dotenv/config';

import { publicWorkerError } from './errors.js';
import { loadFlapHistoryWorkerConfig } from './history-config.js';
import { createFlapHistoryWorkerResources, runFlapHistoryWorker } from './history-worker.js';

const HELP = `ZeroTrace durable Flap event-history projection

Usage:
  npm run flap:history -- --token <address> --from <block> --to <block>
    [--segment-size <blocks>] [--chunk-size <blocks>]
    [--max-transactions <count>] [--max-logs <count>]

The worker scans finalized BNB Smart Chain Portal logs through SQD in bounded segments,
replays every candidate receipt through read-only BSC RPC, persists Evidence and immutable
segments before advancing its checkpoint, and returns a scan ID for paginated replay.

Re-running the exact command resumes after interruption or replays the immutable terminal result.
This worker never accepts private keys and never signs or broadcasts transactions.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  let resources: ReturnType<typeof createFlapHistoryWorkerResources> | undefined;
  try {
    const config = loadFlapHistoryWorkerConfig(process.env, args);
    resources = createFlapHistoryWorkerResources(config);
    const result = await runFlapHistoryWorker(config, resources);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const safe = publicWorkerError(error);
    process.stderr.write(
      `${JSON.stringify({ event: 'flap_history_projection_failed', ...safe })}\n`,
    );
    process.exitCode = 1;
  } finally {
    await resources?.close();
  }
}

await main();
