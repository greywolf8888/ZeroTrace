import { describe, expect, it } from 'vitest';

import { InMemoryJobQueue } from './index.js';

describe('workflow-core', () => {
  it('is idempotent, leases work, and dead-letters after max attempts', () => {
    const queue = new InMemoryJobQueue();
    const first = queue.enqueue({ type: 'supply-materialize', idempotencyKey: 'same' });
    const second = queue.enqueue({ type: 'supply-materialize', idempotencyKey: 'same' });
    expect(second.id).toBe(first.id);
    let last = first;
    for (let index = 0; index < 5; index += 1) {
      const claimed = queue.claim('worker-1');
      expect(claimed?.status).toBe('RUNNING');
      last = queue.fail(first.id, 'provider down');
    }
    expect(last.status).toBe('DEAD_LETTER');
  });

  it('increments fencing tokens so a stale worker cannot overwrite a newer lease', () => {
    const queue = new InMemoryJobQueue();
    queue.enqueue({ type: 'token', idempotencyKey: 'fence', maxAttempts: 3 });
    const first = queue.claim('worker-old');
    const firstToken = first?.fencingToken;
    queue.fail(first!.id, 'killed');
    const second = queue.claim('worker-new');
    expect(firstToken).toBe(1);
    expect(second?.fencingToken).toBe(2);
    expect(second?.fencingToken).toBeGreaterThan(firstToken ?? 0);
  });

  it('stores payload, expires stale leases, and fail-closes missing ids', () => {
    const queue = new InMemoryJobQueue();
    expect(queue.claim('worker-1')).toBeUndefined();
    const job = queue.enqueue({
      type: 'origin',
      idempotencyKey: 'payload',
      payload: '{"ok":true}',
      maxAttempts: 1,
    });
    expect(job.payload).toBe('{"ok":true}');
    const running = queue.claim('worker-1', new Date('2026-08-19T00:00:00.000Z'), 1);
    expect(running?.status).toBe('RUNNING');
    expect(queue.claim('worker-2', new Date('2026-08-19T00:00:01.000Z'), 1_000)).toBeUndefined();
    expect(queue.get(job.id)?.status).toBe('DEAD_LETTER');
    const live = queue.enqueue({ type: 'origin', idempotencyKey: 'live' });
    const claimed = queue.claim('worker-3');
    expect(queue.checkpoint(live.id, 'block:9').checkpoint).toBe('block:9');
    expect(queue.succeed(live.id, 'done')).toMatchObject({
      status: 'SUCCEEDED',
      resultRef: 'done',
    });
    expect(queue.get(live.id)?.status).toBe('SUCCEEDED');
    expect(claimed?.id).toBe(live.id);
    expect(() => queue.succeed('missing', 'x')).toThrow('was not found');
  });
});
