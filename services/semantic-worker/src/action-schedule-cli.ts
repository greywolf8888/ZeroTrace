import 'dotenv/config';

import { PostgresCaptureScheduleRepository } from '@zerotrace/storage';

import { buildActionTransactionSchedule, loadActionScheduleConfig } from './action-schedule.js';
import { publicWorkerError } from './errors.js';

const HELP = `Schedule a durable read-only transaction Action Semantics capture

Usage:
  npm run actions:schedule -- --dataset <dataset> --transaction <id> --block-or-slot <position>
    [--at <ISO date-time>]

Supported datasets: ethereum-mainnet, binance-mainnet, bitcoin-mainnet, solana-mainnet.
The exact ledger-record range must already be ingested before the worker can complete the run.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  let repository: PostgresCaptureScheduleRepository | undefined;
  try {
    const config = loadActionScheduleConfig(process.env, args);
    repository = new PostgresCaptureScheduleRepository({ connectionString: config.postgresUrl });
    const health = await repository.health();
    if (health.status !== 'UP') {
      throw Object.assign(new Error('Durable capture scheduling is unavailable.'), {
        code: health.errorCode ?? 'CAPTURE_SCHEDULER_UNAVAILABLE',
        retryable: true,
      });
    }
    const stored = await repository.putSchedule(buildActionTransactionSchedule(config));
    process.stdout.write(
      `${JSON.stringify({
        event: 'action_capture_scheduled',
        scheduleId: stored.definition.id,
        dataset: config.dataset,
        transactionId: config.transactionId,
        blockOrSlot: config.blockOrSlot,
        nextRunAt: stored.nextRunAt,
      })}\n`,
    );
  } catch (error) {
    const safe = publicWorkerError(error, 'ACTION_CAPTURE_SCHEDULE_FAILED');
    process.stderr.write(
      `${JSON.stringify({ event: 'action_capture_schedule_failed', ...safe })}\n`,
    );
    process.exitCode = 1;
  } finally {
    await repository?.close();
  }
}

await main();
