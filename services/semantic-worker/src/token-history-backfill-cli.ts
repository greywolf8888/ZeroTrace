import 'dotenv/config';

import { publicWorkerError } from './errors.js';
import { loadTokenHistoryBackfillWorkerConfig } from './token-history-backfill-config.js';
import {
  createTokenHistoryBackfillWorkerResources,
  runTokenHistoryBackfillWorkerLoop,
} from './token-history-backfill-worker.js';

const HELP = `ZeroTrace durable Token History and Token Campaign capture worker

Usage:
  npm run dev:token-history:backfill -- [--once]
  npm run dev:token-live:monitor -- [--once]

The worker claims durable TOKEN_HISTORY_BACKFILL and TOKEN_LIVE_CAPTURE schedules, scans the
configured finalized SQD range, replays exact receipts through a read-only EVM RPC, persists Raw
Facts, Evidence, Token History, Funding/Settlement, Control Campaign reports, and Evidence-bound
alerts, and commits an immutable terminal capture result. Live captures use the prior durable
successful Snapshot as a cursor and fail closed on finalized-anchor disagreement. Provider-down,
missing historical state, and incomplete coverage remain explicit retryable or unknown states.
This worker never accepts private keys and never signs or broadcasts.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  let resources: ReturnType<typeof createTokenHistoryBackfillWorkerResources> | undefined;
  try {
    const config = loadTokenHistoryBackfillWorkerConfig(process.env, args);
    resources = createTokenHistoryBackfillWorkerResources(config);
    const summaries = await runTokenHistoryBackfillWorkerLoop(config, resources);
    for (const summary of summaries) process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    const safe = publicWorkerError(error);
    process.stderr.write(
      `${JSON.stringify({ event: 'token_history_backfill_capture_failed', ...safe })}\n`,
    );
    process.exitCode = 1;
  } finally {
    await resources?.close();
  }
}

await main();
