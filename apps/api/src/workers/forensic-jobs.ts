import { originHistoryWithoutReader } from '@zerotrace/forensic-pipeline';
import type { JobQueue } from '@zerotrace/workflow-core';

import type { AppRuntime } from '../runtime.js';

export async function processOneForensicJob(queue: JobQueue, runtime: AppRuntime) {
  const job = await queue.claim('forensic-worker');
  if (job === undefined) return undefined;
  if (job.type === 'TOKEN_ORIGIN_HISTORY') {
    if (runtime.sqdBscCreationReader === undefined) {
      return queue.succeed(job.id, originHistoryWithoutReader().status);
    }
    return queue.succeed(job.id, 'ORIGIN_CAPTURE_NOT_STARTED');
  }
  if (job.type === 'TOKEN_MARKET_STRUCTURE') {
    return queue.fail(
      job.id,
      'Token market-structure jobs must complete in the analyze path; refusing an empty worker materialization.',
    );
  }
  return queue.fail(job.id, `Unsupported forensic job type ${job.type}`);
}
