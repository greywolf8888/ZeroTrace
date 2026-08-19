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
  succeed(id: string, resultRef: string): DurableJob | Promise<DurableJob>;
  fail(id: string, error: string): DurableJob | Promise<DurableJob>;
  checkpoint(id: string, checkpoint: string): DurableJob | Promise<DurableJob>;
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
      job.leaseOwner = workerId;
      job.leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
      return job;
    }
    return undefined;
  }

  succeed(id: string, resultRef: string): DurableJob {
    const job = this.require(id);
    job.status = 'SUCCEEDED';
    job.resultRef = resultRef;
    return job;
  }

  fail(id: string, error: string): DurableJob {
    const job = this.require(id);
    job.lastError = error;
    job.status = job.attempt >= job.maxAttempts ? 'DEAD_LETTER' : 'PENDING';
    return job;
  }

  checkpoint(id: string, checkpoint: string): DurableJob {
    const job = this.require(id);
    job.checkpoint = checkpoint;
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
}
