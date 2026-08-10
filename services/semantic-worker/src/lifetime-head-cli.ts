import 'dotenv/config';

import { publicWorkerError } from './errors.js';
import { loadFlapLifetimeHeadWorkerConfig } from './lifetime-head-config.js';
import {
  createFlapLifetimeHeadWorkerResources,
  runFlapLifetimeHeadLoop,
} from './lifetime-head-worker.js';

const HELP = `ZeroTrace continuous finalized Flap lifetime heads

Usage:
  npm run flap:lifetime:heads -- --token <address> [--interval-ms <milliseconds>]
    [--max-cycles <count>] [--origin-chunk-size <blocks>]
    [--history-segment-size <blocks>] [--history-chunk-size <blocks>]
    [--history-max-transactions <count>] [--history-max-logs <count>]

Every cycle reconciles at least DATA_QUALITY_MIN_SOURCES finalized BSC RPC anchors. The first
accepted head materializes exact lifetime coverage; later heads scan only the continuous delta.
Provider disagreement, regression, finalized hash conflict, incomplete history, or unavailable
Evidence storage blocks advancement. This worker is read-only and never signs or broadcasts.`;

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
  let resources: ReturnType<typeof createFlapLifetimeHeadWorkerResources> | undefined;
  try {
    const config = loadFlapLifetimeHeadWorkerConfig(process.env, args);
    resources = createFlapLifetimeHeadWorkerResources(config);
    await runFlapLifetimeHeadLoop(config, resources, undefined, {
      signal: controller.signal,
      emit: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
    });
  } catch (error) {
    const safe = publicWorkerError(error, 'FLAP_LIFETIME_HEAD_FAILED');
    process.stderr.write(`${JSON.stringify({ event: 'flap_lifetime_head_failed', ...safe })}\n`);
    process.exitCode = 1;
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await resources?.close();
  }
}

await main();
