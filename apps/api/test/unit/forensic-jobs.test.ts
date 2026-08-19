import { describe, expect, it } from 'vitest';

import { InMemoryJobQueue } from '@zerotrace/workflow-core';

import type { AppRuntime } from '../../src/runtime.js';
import { processOneForensicJob } from '../../src/workers/forensic-jobs.js';

function runtime(overrides: Partial<AppRuntime> = {}): AppRuntime {
  return overrides as AppRuntime;
}

describe('forensic job worker', () => {
  it('no-ops when the queue is empty', async () => {
    const queue = new InMemoryJobQueue();
    await expect(processOneForensicJob(queue, runtime())).resolves.toBeUndefined();
  });

  it('keeps origin history offline without a creation reader', async () => {
    const queue = new InMemoryJobQueue();
    const job = queue.enqueue({ type: 'TOKEN_ORIGIN_HISTORY', idempotencyKey: 'origin-offline' });
    const result = await processOneForensicJob(queue, runtime());
    expect(result).toMatchObject({ id: job.id, status: 'SUCCEEDED', resultRef: 'OFFLINE' });
  });

  it('does not start origin capture just because a reader exists', async () => {
    const queue = new InMemoryJobQueue();
    queue.enqueue({ type: 'TOKEN_ORIGIN_HISTORY', idempotencyKey: 'origin-reader' });
    const result = await processOneForensicJob(
      queue,
      runtime({ sqdBscCreationReader: { kind: 'stub' } as never }),
    );
    expect(result).toMatchObject({ status: 'SUCCEEDED', resultRef: 'ORIGIN_CAPTURE_NOT_STARTED' });
  });

  it('refuses an empty market-structure worker materialization', async () => {
    const queue = new InMemoryJobQueue();
    const job = queue.enqueue({
      type: 'TOKEN_MARKET_STRUCTURE',
      idempotencyKey: 'market',
      maxAttempts: 1,
    });
    const result = await processOneForensicJob(queue, runtime());
    expect(result).toMatchObject({
      id: job.id,
      status: 'DEAD_LETTER',
    });
    expect(result?.lastError).toContain('analyze path');
  });

  it('dead-letters unsupported forensic job types', async () => {
    const queue = new InMemoryJobQueue();
    queue.enqueue({ type: 'UNKNOWN', idempotencyKey: 'unknown', maxAttempts: 1 });
    const result = await processOneForensicJob(queue, runtime());
    expect(result?.status).toBe('DEAD_LETTER');
    expect(result?.lastError).toContain('Unsupported forensic job type');
  });
});
