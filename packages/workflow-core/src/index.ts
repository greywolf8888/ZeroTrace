import { contentAddressedId } from '@zerotrace/evidence';

export const WORKFLOW_CORE_MODEL_VERSION = 'workflow-core-v1.0.0';

export type JobStatus =
  'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'DEAD_LETTER';

export interface DurableJob {
  id: string;
  type: string;
  idempotencyKey: string;
  status: JobStatus;
  attempt: number;
  maxAttempts: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  checkpoint?: string;
  payload?: string;
  resultRef?: string;
  lastError?: string;
  fencingToken?: number;
}

export interface JobLeaseGuard {
  workerId: string;
  fencingToken: number;
}

export interface JobQueue {
  enqueue(input: {
    type: string;
    idempotencyKey: string;
    maxAttempts?: number;
    payload?: string;
  }): DurableJob | Promise<DurableJob>;
  claim(
    workerId: string,
    now?: Date,
    leaseMs?: number,
  ): DurableJob | undefined | Promise<DurableJob | undefined>;
  heartbeat(
    id: string,
    guard: JobLeaseGuard,
    now?: Date,
    leaseMs?: number,
  ): DurableJob | Promise<DurableJob>;
  succeed(id: string, resultRef: string, guard?: JobLeaseGuard): DurableJob | Promise<DurableJob>;
  fail(id: string, error: string, guard?: JobLeaseGuard): DurableJob | Promise<DurableJob>;
  checkpoint(
    id: string,
    checkpoint: string,
    guard?: JobLeaseGuard,
  ): DurableJob | Promise<DurableJob>;
  cancel(id: string): DurableJob | Promise<DurableJob>;
  retry(id: string): DurableJob | Promise<DurableJob>;
  get(id: string): DurableJob | undefined | Promise<DurableJob | undefined>;
}

export class InMemoryJobQueue implements JobQueue {
  readonly #jobs = new Map<string, DurableJob>();

  enqueue(input: {
    type: string;
    idempotencyKey: string;
    maxAttempts?: number;
    payload?: string;
  }): DurableJob {
    const existing = [...this.#jobs.values()].find(
      (job) => job.idempotencyKey === input.idempotencyKey,
    );
    if (existing !== undefined) return existing;
    const job: DurableJob = {
      id: contentAddressedId('job', input),
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      status: 'PENDING',
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 5,
      ...(input.payload === undefined ? {} : { payload: input.payload }),
    };
    this.#jobs.set(job.id, job);
    return job;
  }

  claim(workerId: string, now = new Date(), leaseMs = 30_000): DurableJob | undefined {
    for (const job of this.#jobs.values()) {
      if (job.status === 'RUNNING' && job.leaseExpiresAt !== undefined) {
        if (new Date(job.leaseExpiresAt).getTime() < now.getTime()) {
          job.status = job.attempt >= job.maxAttempts ? 'DEAD_LETTER' : 'PENDING';
        }
      }
      if (job.status !== 'PENDING') continue;
      job.status = 'RUNNING';
      job.attempt += 1;
      job.fencingToken = (job.fencingToken ?? 0) + 1;
      job.leaseOwner = workerId;
      job.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      return job;
    }
    return undefined;
  }

  heartbeat(id: string, guard: JobLeaseGuard, now = new Date(), leaseMs = 30_000): DurableJob {
    const job = this.requireGuarded(id, guard);
    job.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    return job;
  }

  succeed(id: string, resultRef: string, guard?: JobLeaseGuard): DurableJob {
    const job = guard === undefined ? this.require(id) : this.requireGuarded(id, guard);
    job.status = 'SUCCEEDED';
    job.resultRef = resultRef;
    delete job.leaseOwner;
    delete job.leaseExpiresAt;
    return job;
  }

  fail(id: string, error: string, guard?: JobLeaseGuard): DurableJob {
    const job = guard === undefined ? this.require(id) : this.requireGuarded(id, guard);
    job.lastError = error;
    job.status = job.attempt >= job.maxAttempts ? 'DEAD_LETTER' : 'PENDING';
    delete job.leaseOwner;
    delete job.leaseExpiresAt;
    return job;
  }

  checkpoint(id: string, checkpoint: string, guard?: JobLeaseGuard): DurableJob {
    const job = guard === undefined ? this.require(id) : this.requireGuarded(id, guard);
    job.checkpoint = checkpoint;
    return job;
  }

  cancel(id: string): DurableJob {
    const job = this.require(id);
    if (!['PENDING', 'RUNNING'].includes(job.status)) {
      throw new Error(`Job ${id} cannot be cancelled from ${job.status}.`);
    }
    job.status = 'CANCELLED';
    delete job.leaseOwner;
    delete job.leaseExpiresAt;
    return job;
  }

  retry(id: string): DurableJob {
    const job = this.require(id);
    if (!['FAILED', 'CANCELLED', 'DEAD_LETTER'].includes(job.status)) {
      throw new Error(`Job ${id} cannot be retried from ${job.status}.`);
    }
    job.status = 'PENDING';
    job.attempt = 0;
    delete job.lastError;
    delete job.resultRef;
    delete job.leaseOwner;
    delete job.leaseExpiresAt;
    return job;
  }

  get(id: string): DurableJob | undefined {
    return this.#jobs.get(id);
  }

  private require(id: string): DurableJob {
    const job = this.#jobs.get(id);
    if (job === undefined) throw new Error(`Job ${id} was not found.`);
    return job;
  }

  private requireGuarded(id: string, guard: JobLeaseGuard): DurableJob {
    const job = this.require(id);
    if (
      job.status !== 'RUNNING' ||
      job.leaseOwner !== guard.workerId ||
      job.fencingToken !== guard.fencingToken
    ) {
      throw new Error(`Job ${id} lease is stale.`);
    }
    return job;
  }
}
