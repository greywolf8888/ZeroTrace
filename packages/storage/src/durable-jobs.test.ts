import { describe, expect, it, vi } from 'vitest';

import { PostgresJobQueue, type JobPool } from './durable-jobs.js';

type JobRow = Record<string, unknown>;

function memoryPool(seed: JobRow[] = []) {
  const jobs = [...seed];
  const clientQuery = vi.fn(async (text: string, values: readonly unknown[] = []) => {
    if (text === 'BEGIN' || text === 'COMMIT') return { rows: [] };
    if (text === 'ROLLBACK') return { rows: [] };
    if (text.includes('lease_expires_at IS NOT NULL')) {
      const now = String(values[0]);
      for (const job of jobs) {
        const expires = job.lease_expires_at;
        if (job.status !== 'RUNNING' || expires === null || expires === undefined) continue;
        const iso = expires instanceof Date ? expires.toISOString() : String(expires);
        if (iso < now) {
          job.status = Number(job.attempt) >= Number(job.max_attempts) ? 'DEAD_LETTER' : 'PENDING';
        }
      }
      return { rows: [] };
    }
    if (text.includes('SELECT id FROM durable_jobs')) {
      const pending = jobs.find((job) => job.status === 'PENDING');
      return { rows: pending === undefined ? [] : [{ id: pending.id }] };
    }
    if (text.includes("SET status = 'RUNNING'")) {
      const job = jobs.find((item) => item.id === values[0]);
      if (job === undefined) return { rows: [] };
      job.status = 'RUNNING';
      job.attempt = Number(job.attempt) + 1;
      job.fencing_token = Number(job.fencing_token ?? 0) + 1;
      job.lease_owner = values[1];
      job.lease_expires_at = values[2];
      return { rows: [job] };
    }
    throw new Error(`Unexpected client SQL: ${text}`);
  });
  const pool: JobPool = {
    query: vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('idempotency_key = $1 LIMIT 1')) {
        const existing = jobs.find((job) => job.idempotency_key === values[0]);
        return { rows: existing === undefined ? [] : [existing] };
      }
      if (text.includes('INSERT INTO durable_jobs')) {
        const row: JobRow = {
          id: values[0],
          type: values[1],
          idempotency_key: values[2],
          status: 'PENDING',
          attempt: 0,
          max_attempts: values[3],
          lease_owner: null,
          lease_expires_at: null,
          checkpoint: null,
          payload: JSON.parse(String(values[4])),
          result_ref: null,
          last_error: null,
          fencing_token: 0,
        };
        jobs.push(row);
        return { rows: [row] };
      }
      if (text.includes("status = 'SUCCEEDED'")) {
        const job = jobs.find((item) => item.id === values[0]);
        if (job === undefined) return { rows: [] };
        job.status = 'SUCCEEDED';
        job.result_ref = values[1];
        return { rows: [job] };
      }
      if (text.includes('last_error = $2')) {
        const job = jobs.find((item) => item.id === values[0]);
        if (job === undefined) return { rows: [] };
        job.last_error = values[1];
        job.status = Number(job.attempt) >= Number(job.max_attempts) ? 'DEAD_LETTER' : 'PENDING';
        return { rows: [job] };
      }
      if (text.includes('SET checkpoint = $2')) {
        const job = jobs.find((item) => item.id === values[0]);
        if (job === undefined) return { rows: [] };
        job.checkpoint = values[1];
        return { rows: [job] };
      }
      if (text.includes('SELECT * FROM durable_jobs WHERE id = $1')) {
        const job = jobs.find((item) => item.id === values[0]);
        return { rows: job === undefined ? [] : [job] };
      }
      throw new Error(`Unexpected pool SQL: ${text}`);
    }),
    connect: vi.fn(async () => ({
      query: clientQuery,
      release: vi.fn(),
    })),
    end: vi.fn(async () => undefined),
  };
  return { pool, jobs, clientQuery };
}

describe('PostgresJobQueue', () => {
  it('enqueues idempotently, claims, checkpoints, succeeds, and maps jsonb payload', async () => {
    const { pool } = memoryPool();
    const queue = PostgresJobQueue.fromPool(pool);
    const first = await queue.enqueue({
      type: 'TOKEN_MARKET_STRUCTURE',
      idempotencyKey: 'same',
      payload: '{"token":"0x1"}',
    });
    const second = await queue.enqueue({
      type: 'TOKEN_MARKET_STRUCTURE',
      idempotencyKey: 'same',
      payload: '{"token":"0x2"}',
    });
    expect(second.id).toBe(first.id);
    expect(first.payload).toBe('{"token":"0x1"}');
    const claimed = await queue.claim('worker-1');
    expect(claimed?.status).toBe('RUNNING');
    expect(claimed?.leaseOwner).toBe('worker-1');
    expect(claimed?.fencingToken).toBe(1);
    const marked = await queue.checkpoint(first.id, 'block:100');
    expect(marked.checkpoint).toBe('block:100');
    const done = await queue.succeed(first.id, 'env_1');
    expect(done).toMatchObject({ status: 'SUCCEEDED', resultRef: 'env_1' });
    await expect(queue.get(first.id)).resolves.toMatchObject({ status: 'SUCCEEDED' });
    await queue.close();
    expect(pool.end).toHaveBeenCalled();
  });

  it('returns undefined when nothing is pending and dead-letters exhausted claims', async () => {
    const expired = new Date('2020-01-01T00:00:00.000Z');
    const { pool } = memoryPool([
      {
        id: 'job_aaaaaaaaaaaaaaaaaaaaaaaa',
        type: 'TOKEN_ORIGIN_HISTORY',
        idempotency_key: 'origin',
        status: 'RUNNING',
        attempt: 5,
        max_attempts: 5,
        lease_owner: 'stale',
        lease_expires_at: expired,
        checkpoint: null,
        payload: null,
        result_ref: null,
        last_error: null,
      },
    ]);
    const queue = PostgresJobQueue.fromPool(pool);
    await expect(queue.claim('worker-2', new Date('2026-08-19T00:00:00.000Z'))).resolves.toBe(
      undefined,
    );
    await expect(queue.get('missing')).resolves.toBeUndefined();
  });

  it('maps Date leases, string payloads, and fail-closed missing mutations', async () => {
    const lease = new Date('2026-08-19T00:00:30.000Z');
    const { pool } = memoryPool([
      {
        id: 'job_bbbbbbbbbbbbbbbbbbbbbbbb',
        type: 'TOKEN_ORIGIN_HISTORY',
        idempotency_key: 'string-payload',
        status: 'PENDING',
        attempt: 0,
        max_attempts: 1,
        lease_owner: 'keeper',
        lease_expires_at: lease,
        checkpoint: 'cp',
        payload: '{"ok":true}',
        result_ref: 'ref',
        last_error: 'old',
      },
    ]);
    const queue = PostgresJobQueue.fromPool(pool);
    const loaded = await queue.get('job_bbbbbbbbbbbbbbbbbbbbbbbb');
    expect(loaded).toMatchObject({
      payload: '{"ok":true}',
      leaseOwner: 'keeper',
      leaseExpiresAt: lease.toISOString(),
      checkpoint: 'cp',
      resultRef: 'ref',
      lastError: 'old',
    });
    const claimed = await queue.claim('worker-3');
    expect(claimed?.attempt).toBe(1);
    const dead = await queue.fail(claimed!.id, 'provider down');
    expect(dead.status).toBe('DEAD_LETTER');
    await expect(queue.succeed('missing', 'x')).rejects.toThrow('was not found');
    await expect(queue.fail('missing', 'x')).rejects.toThrow('was not found');
    await expect(queue.checkpoint('missing', 'x')).rejects.toThrow('was not found');
  });

  it('rolls back a claim when the lease update fails', async () => {
    const { pool, clientQuery } = memoryPool([
      {
        id: 'job_cccccccccccccccccccccccc',
        type: 'OTHER',
        idempotency_key: 'other',
        status: 'PENDING',
        attempt: 0,
        max_attempts: 5,
        lease_owner: null,
        lease_expires_at: null,
        checkpoint: null,
        payload: {},
        result_ref: null,
        last_error: null,
      },
    ]);
    clientQuery.mockImplementation(async (text: string) => {
      if (text === 'BEGIN') return { rows: [] };
      if (text === 'ROLLBACK') return { rows: [] };
      if (text.includes('lease_expires_at IS NOT NULL')) return { rows: [] };
      if (text.includes('SELECT id FROM durable_jobs')) {
        return { rows: [{ id: 'job_cccccccccccccccccccccccc' }] };
      }
      throw new Error('lease update failed');
    });
    const queue = PostgresJobQueue.fromPool(pool);
    await expect(queue.claim('worker-4')).rejects.toThrow('lease update failed');
    expect(clientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('can construct a real pg pool without querying it', async () => {
    const queue = new PostgresJobQueue({
      connectionString: 'postgresql://127.0.0.1:1/zerotrace',
    });
    await queue.close();
  });
});
