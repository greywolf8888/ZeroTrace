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
});
