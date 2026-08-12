import 'dotenv/config';

import {
  PostgresCaptureScheduleRepository,
  PostgresClaimRuleReviewReportRepository,
} from '@zerotrace/storage';

import { buildClaimActionsSchedule } from './claim-action-schedule.js';
import { required } from './config.js';
import { publicWorkerError } from './errors.js';

interface Arguments {
  reviewReportId?: string;
  fromBlock?: string;
  toBlock?: string;
  at?: string;
}

function parseArguments(args: readonly string[]): Arguments {
  const result: Arguments = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!['--review-report', '--from', '--to', '--at'].includes(argument ?? '')) {
      throw new Error(`Unknown Claim Actions schedule argument: ${argument ?? ''}`);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === '--review-report') result.reviewReportId = value;
    if (argument === '--from') result.fromBlock = value;
    if (argument === '--to') result.toBlock = value;
    if (argument === '--at') result.at = value;
  }
  return result;
}

function requiredArgument(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '') throw new Error(`${field} is required.`);
  return value.trim();
}

const HELP = `Schedule a durable reviewed EVM Claim Actions capture

Usage:
  npm run claims:actions:schedule -- \
    --review-report crr_<id> --from <block> --to <block> [--at <ISO date-time>]

The schedule binds the exact reviewed rule result hash, EVM asset, range, observer version and
bounded request limits. It performs no chain write and does not imply that the Claim is true.`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  let schedules: PostgresCaptureScheduleRepository | undefined;
  let reviews: PostgresClaimRuleReviewReportRepository | undefined;
  try {
    const parsed = parseArguments(args);
    const reviewReportId = requiredArgument(parsed.reviewReportId, '--review-report');
    if (!/^crr_[0-9a-f]{24}$/.test(reviewReportId)) {
      throw new Error('--review-report must be a canonical crr_ report id.');
    }
    const fromBlock = requiredArgument(parsed.fromBlock, '--from');
    const toBlock = requiredArgument(parsed.toBlock, '--to');
    if (!/^(?:0|[1-9]\d*)$/.test(fromBlock) || !/^(?:0|[1-9]\d*)$/.test(toBlock)) {
      throw new Error('--from and --to must be unsigned block numbers.');
    }
    const postgresUrl = required(process.env, 'POSTGRES_URL');
    reviews = new PostgresClaimRuleReviewReportRepository({ connectionString: postgresUrl });
    schedules = new PostgresCaptureScheduleRepository({ connectionString: postgresUrl });
    const [review, scheduleHealth] = await Promise.all([
      reviews.get(reviewReportId),
      schedules.health(),
    ]);
    if (scheduleHealth.status !== 'UP') {
      throw Object.assign(new Error('Durable Claim Actions scheduling is unavailable.'), {
        code: scheduleHealth.errorCode ?? 'CAPTURE_SCHEDULER_UNAVAILABLE',
        retryable: true,
      });
    }
    if (review === undefined) throw new Error('The reviewed Claim rule report was not found.');
    const now = new Date().toISOString();
    const schedule = buildClaimActionsSchedule({
      reviewReport: review.report,
      fromBlock,
      toBlock,
      createdAt: now,
      at: parsed.at ?? now,
    });
    const stored = await schedules.putSchedule(schedule);
    process.stdout.write(
      `${JSON.stringify({
        event: 'claim_actions_capture_scheduled',
        scheduleId: stored.definition.id,
        reviewReportId,
        ruleId: review.ruleId,
        assetId: review.assetId,
        range: { fromBlock, toBlock },
        nextRunAt: stored.nextRunAt,
      })}\n`,
    );
  } catch (error) {
    const safe = publicWorkerError(error, 'CLAIM_ACTIONS_SCHEDULE_FAILED');
    process.stderr.write(
      `${JSON.stringify({ event: 'claim_actions_schedule_failed', ...safe })}\n`,
    );
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([schedules?.close(), reviews?.close()]);
  }
}

await main();
