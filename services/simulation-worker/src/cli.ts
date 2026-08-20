import { readFileSync } from 'node:fs';

import { InMemoryJobQueue } from '@zerotrace/workflow-core';
import { isolatedRvSumIsIllegal, simulateMarketWideExit } from '@zerotrace/market-reality-engine';
import { MarketWideExitScenarioSchema } from '@zerotrace/schemas';

const queue = new InMemoryJobQueue();

function readInput(): unknown {
  const raw = readFileSync(0, 'utf8').trim();
  if (raw.length === 0) {
    throw new Error('simulation-worker requires a JSON MarketWideExit request on stdin.');
  }
  return JSON.parse(raw) as unknown;
}

const job = queue.enqueue({ type: 'MARKET_WIDE_EXIT', idempotencyKey: 'stdin' });
const claimed = queue.claim('simulation-worker');
if (claimed === undefined || claimed.fencingToken === undefined) {
  throw new Error('simulation-worker failed to acquire a fenced job lease.');
}
const guard = { workerId: 'simulation-worker', fencingToken: claimed.fencingToken };
try {
  const input = readInput() as Parameters<typeof simulateMarketWideExit>[0] & {
    isolatedQuotes?: string[];
  };
  if (input.isolatedQuotes !== undefined && input.isolatedQuotes.length > 1) {
    isolatedRvSumIsIllegal(input.isolatedQuotes.map((item) => BigInt(item)));
  }
  const scenario = simulateMarketWideExit(input);
  queue.succeed(job.id, scenario.id, guard);
  process.stdout.write(
    `${JSON.stringify(MarketWideExitScenarioSchema.parse(scenario), null, 2)}\n`,
  );
} catch (error) {
  queue.fail(job.id, error instanceof Error ? error.message : 'simulation failed', guard);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
