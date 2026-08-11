import { randomBytes } from 'node:crypto';

import { hashPayload } from '@zerotrace/evidence';
import {
  CaptureRetryPolicySchema,
  CaptureRunSuccessSchema,
  CaptureRunSchema,
  CaptureScheduleDefinitionSchema,
  CaptureScheduleRecordSchema,
  CaptureTargetSchema,
  CaptureTriggerSchema,
  JsonValueSchema,
  unknownValue,
  type CaptureKind,
  type CaptureRetryPolicy,
  type CaptureRun,
  type CaptureRunSuccess,
  type CaptureScheduleDefinition,
  type CaptureScheduleRecord,
  type CaptureTarget,
  type CaptureTrigger,
  type JsonValue,
} from '@zerotrace/schemas';

export const CAPTURE_SCHEDULER_MODEL_VERSION = 'capture-scheduler-v0.1.0';

export interface DefineCaptureScheduleInput {
  captureKind: CaptureKind;
  target: CaptureTarget;
  parameters: JsonValue;
  trigger: CaptureTrigger;
  retryPolicy: CaptureRetryPolicy;
  createdAt?: string;
}

export interface CaptureLeaseRepository {
  claimDue(input: {
    owner: string;
    now?: string;
    leaseSeconds?: number;
    limit?: number;
  }): Promise<CaptureRun[]>;
  complete(input: {
    runId: string;
    leaseToken: string;
    result: CaptureRunSuccess;
    completedAt?: string;
  }): Promise<CaptureRun>;
  fail(input: {
    runId: string;
    leaseToken: string;
    code: string;
    detail: string;
    sourceRetryable: boolean;
    failedAt?: string;
  }): Promise<CaptureRun>;
}

export type CaptureHandler = (run: CaptureRun, signal?: AbortSignal) => Promise<CaptureRunSuccess>;

export class CaptureExecutionError extends Error {
  readonly code: string;
  readonly sourceRetryable: boolean;

  constructor(code: string, message: string, sourceRetryable: boolean, cause?: unknown) {
    super(message, { cause });
    this.name = 'CaptureExecutionError';
    this.code = code;
    this.sourceRetryable = sourceRetryable;
  }
}

export interface RunCaptureCycleInput {
  repository: CaptureLeaseRepository;
  handlers: ReadonlyMap<CaptureKind, CaptureHandler>;
  owner: string;
  now?: string;
  leaseSeconds?: number;
  limit?: number;
  signal?: AbortSignal;
}

export async function runCaptureCycle(input: RunCaptureCycleInput): Promise<CaptureRun[]> {
  if (input.signal?.aborted === true) return [];
  const runs = await input.repository.claimDue({
    owner: input.owner,
    ...(input.now === undefined ? {} : { now: input.now }),
    ...(input.leaseSeconds === undefined ? {} : { leaseSeconds: input.leaseSeconds }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });
  return Promise.all(
    runs.map(async (run) => {
      if (run.lease.state !== 'known') {
        throw new CaptureExecutionError(
          'CAPTURE_LEASE_INVALID',
          'Claimed capture run did not contain an active lease.',
          false,
        );
      }
      const handler = input.handlers.get(run.captureKind);
      if (handler === undefined) {
        return input.repository.fail({
          runId: run.id,
          leaseToken: run.lease.value.token,
          code: 'CAPTURE_HANDLER_UNREGISTERED',
          detail: `No production handler is registered for ${run.captureKind}.`,
          sourceRetryable: false,
          ...(input.now === undefined ? {} : { failedAt: input.now }),
        });
      }
      try {
        const result = CaptureRunSuccessSchema.parse(await handler(run, input.signal));
        return input.repository.complete({
          runId: run.id,
          leaseToken: run.lease.value.token,
          result,
          ...(input.now === undefined ? {} : { completedAt: input.now }),
        });
      } catch (error) {
        const failure =
          error instanceof CaptureExecutionError
            ? error
            : new CaptureExecutionError(
                'CAPTURE_HANDLER_FAILED',
                error instanceof Error ? error.message : 'Capture handler threw a non-Error value.',
                true,
                error,
              );
        return input.repository.fail({
          runId: run.id,
          leaseToken: run.lease.value.token,
          code: failure.code,
          detail: failure.message,
          sourceRetryable: failure.sourceRetryable,
          ...(input.now === undefined ? {} : { failedAt: input.now }),
        });
      }
    }),
  );
}

function canonicalTime(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError(`${field} must be an ISO date-time.`);
  return date.toISOString();
}

function normalizeTrigger(trigger: CaptureTrigger): CaptureTrigger {
  const parsed = CaptureTriggerSchema.parse(trigger);
  return parsed.type === 'ONCE'
    ? { type: 'ONCE', at: canonicalTime(parsed.at, 'trigger.at') }
    : {
        type: 'INTERVAL',
        anchorAt: canonicalTime(parsed.anchorAt, 'trigger.anchorAt'),
        everySeconds: parsed.everySeconds,
        catchupPolicy: 'SKIP_MISSED',
      };
}

export function nextCaptureOccurrence(
  trigger: CaptureTrigger,
  referenceTime: string,
  inclusive = true,
): string | undefined {
  const normalized = normalizeTrigger(trigger);
  const reference = new Date(canonicalTime(referenceTime, 'referenceTime')).getTime();
  if (normalized.type === 'ONCE') {
    const at = new Date(normalized.at).getTime();
    return at > reference || (inclusive && at === reference) ? normalized.at : undefined;
  }

  const anchor = new Date(normalized.anchorAt).getTime();
  const interval = normalized.everySeconds * 1_000;
  if (anchor > reference || (inclusive && anchor === reference)) return normalized.anchorAt;
  const elapsed = reference - anchor;
  const periods = Math.floor(elapsed / interval) + (inclusive && elapsed % interval === 0 ? 0 : 1);
  return new Date(anchor + periods * interval).toISOString();
}

export function defineCaptureSchedule(input: DefineCaptureScheduleInput): CaptureScheduleRecord {
  const createdAt = canonicalTime(input.createdAt ?? new Date().toISOString(), 'createdAt');
  const target = CaptureTargetSchema.parse(input.target);
  const parameters = JsonValueSchema.parse(input.parameters);
  const trigger = normalizeTrigger(input.trigger);
  const retryPolicy = CaptureRetryPolicySchema.parse(input.retryPolicy);
  const identity = {
    schemaVersion: 'capture-schedule-v1' as const,
    captureKind: input.captureKind,
    operation: 'READ_ONLY_CAPTURE' as const,
    target,
    parameters,
    trigger,
    retryPolicy,
  };
  const identityHash = hashPayload(identity);
  const definition = CaptureScheduleDefinitionSchema.parse({
    ...identity,
    id: `cps_${identityHash.slice(0, 24)}`,
    identityHash,
    createdAt,
  });
  const nextRunAt = nextCaptureOccurrence(trigger, createdAt);
  return CaptureScheduleRecordSchema.parse({
    definition,
    status: nextRunAt === undefined ? 'COMPLETED' : 'ACTIVE',
    nextRunAt:
      nextRunAt === undefined
        ? unknownValue('NOT_APPLICABLE', 'One-shot time has elapsed.')
        : { state: 'known', value: nextRunAt },
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  });
}

export function captureScheduleIdFor(
  definition: Omit<CaptureScheduleDefinition, 'id' | 'identityHash' | 'createdAt'>,
): string {
  return `cps_${hashPayload(definition).slice(0, 24)}`;
}

export function captureRunIdFor(scheduleId: string, scheduledFor: string): string {
  const canonicalScheduledFor = canonicalTime(scheduledFor, 'scheduledFor');
  return `cpr_${hashPayload({ schema: 'capture-run-identity-v1', scheduleId, scheduledFor: canonicalScheduledFor }).slice(0, 24)}`;
}

export function retryDelaySeconds(policy: CaptureRetryPolicy, failedAttempt: number): number {
  const parsed = CaptureRetryPolicySchema.parse(policy);
  if (
    !Number.isInteger(failedAttempt) ||
    failedAttempt < 1 ||
    failedAttempt >= parsed.maxAttempts
  ) {
    throw new RangeError('failedAttempt must be retryable under the configured policy.');
  }
  let delay = parsed.initialDelaySeconds;
  for (let attempt = 1; attempt < failedAttempt; attempt += 1) {
    delay = Math.ceil((delay * parsed.backoffMultiplierBps) / 10_000);
    if (delay >= parsed.maximumDelaySeconds) return parsed.maximumDelaySeconds;
  }
  return Math.min(delay, parsed.maximumDelaySeconds);
}

export function leaseToken(): string {
  return randomBytes(16).toString('hex');
}

export function parseCaptureRun(value: unknown): CaptureRun {
  return CaptureRunSchema.parse(value);
}

export type {
  CaptureKind,
  CaptureRetryPolicy,
  CaptureRun,
  CaptureScheduleDefinition,
  CaptureScheduleRecord,
  CaptureTarget,
  CaptureTrigger,
};
