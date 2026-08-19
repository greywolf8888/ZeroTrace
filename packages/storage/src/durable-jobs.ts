import { Pool } from 'pg';

import { contentAddressedId } from '@zerotrace/evidence';
import type { DurableJob, JobQueue, JobStatus } from '@zerotrace/workflow-core';

export interface PostgresJobQueueOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

function asJob(row: Record<string, unknown>): DurableJob {
  const payload = row.payload;
  const payloadText =
    payload === null || payload === undefined
      ? undefined
      : typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);
  return {
    id: String(row.id),
    type: String(row.type),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as JobStatus,
    attempt: Number(row.attempt),
    maxAttempts: Number(row.max_attempts),
    ...(row.lease_owner === null || row.lease_owner === undefined
      ? {}
      : { leaseOwner: String(row.lease_owner) }),
    ...(row.lease_expires_at === null || row.lease_expires_at === undefined
      ? {}
      : {
          leaseExpiresAt:
            row.lease_expires_at instanceof Date
              ? row.lease_expires_at.toISOString()
              : String(row.lease_expires_at),
        }),
    ...(row.checkpoint === null || row.checkpoint === undefined
      ? {}
      : { checkpoint: String(row.checkpoint) }),
    ...(payloadText === undefined ? {} : { payload: payloadText }),
    ...(row.result_ref === null || row.result_ref === undefined
      ? {}
      : { resultRef: String(row.result_ref) }),
    ...(row.last_error === null || row.last_error === undefined
      ? {}
      : { lastError: String(row.last_error) }),
  };
}

export class PostgresJobQueue implements JobQueue {
  readonly #pool: Pool;

  constructor(options: PostgresJobQueueOptions) {
    this.#pool = new Pool({
      connectionString: options.connectionString,
      max: options.maxConnections ?? 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
      statement_timeout: options.statementTimeoutMs ?? 15_000,
      application_name: 'zerotrace-durable-jobs',
    });
  }

  async enqueue(input: {
    type: string;
    idempotencyKey: string;
    maxAttempts?: number;
    payload?: string;
  }): Promise<DurableJob> {
    const existing = await this.#pool.query(
      `SELECT * FROM durable_jobs WHERE idempotency_key = $1 LIMIT 1`,
      [input.idempotencyKey],
    );
    const existingRow = existing.rows[0];
    if (existingRow !== undefined) return asJob(existingRow as Record<string, unknown>);
    const id = contentAddressedId('job', input);
    const payload = JSON.parse(input.payload ?? '{}') as unknown;
    const inserted = await this.#pool.query(
      `INSERT INTO durable_jobs (
         id, type, idempotency_key, status, attempt, max_attempts, payload
       ) VALUES ($1,$2,$3,'PENDING',0,$4,$5::jsonb)
       ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
       RETURNING *`,
      [id, input.type, input.idempotencyKey, input.maxAttempts ?? 5, JSON.stringify(payload)],
    );
    return asJob(inserted.rows[0] as Record<string, unknown>);
  }

  async claim(
    workerId: string,
    now = new Date(),
    leaseMs = 30_000,
  ): Promise<DurableJob | undefined> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE durable_jobs
         SET status = CASE WHEN attempt >= max_attempts THEN 'DEAD_LETTER' ELSE 'PENDING' END,
             updated_at = $1
         WHERE status = 'RUNNING' AND lease_expires_at IS NOT NULL AND lease_expires_at < $1`,
        [now.toISOString()],
      );
      const selected = await client.query(
        `SELECT id FROM durable_jobs
         WHERE status = 'PENDING'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1`,
      );
      const id = selected.rows[0]?.id as string | undefined;
      if (id === undefined) {
        await client.query('COMMIT');
        return undefined;
      }
      const expires = new Date(now.getTime() + leaseMs).toISOString();
      const updated = await client.query(
        `UPDATE durable_jobs
         SET status = 'RUNNING',
             attempt = attempt + 1,
             lease_owner = $2,
             lease_expires_at = $3,
             updated_at = $4
         WHERE id = $1
         RETURNING *`,
        [id, workerId, expires, now.toISOString()],
      );
      await client.query('COMMIT');
      return asJob(updated.rows[0] as Record<string, unknown>);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async succeed(id: string, resultRef: string): Promise<DurableJob> {
    const result = await this.#pool.query(
      `UPDATE durable_jobs
       SET status = 'SUCCEEDED', result_ref = $2, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, resultRef],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Job ${id} was not found.`);
    return asJob(row as Record<string, unknown>);
  }

  async fail(id: string, error: string): Promise<DurableJob> {
    const result = await this.#pool.query(
      `UPDATE durable_jobs
       SET last_error = $2,
           status = CASE WHEN attempt >= max_attempts THEN 'DEAD_LETTER' ELSE 'PENDING' END,
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [id, error],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Job ${id} was not found.`);
    return asJob(row as Record<string, unknown>);
  }

  async checkpoint(id: string, checkpoint: string): Promise<DurableJob> {
    const result = await this.#pool.query(
      `UPDATE durable_jobs SET checkpoint = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, checkpoint],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`Job ${id} was not found.`);
    return asJob(row as Record<string, unknown>);
  }

  async get(id: string): Promise<DurableJob | undefined> {
    const result = await this.#pool.query(`SELECT * FROM durable_jobs WHERE id = $1`, [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : asJob(row as Record<string, unknown>);
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
