import { Pool } from 'pg';

import {
  captureRunIdFor,
  leaseToken,
  nextCaptureOccurrence,
  retryDelaySeconds,
} from '@zerotrace/capture-scheduler';
import {
  CaptureRunFailureSchema,
  CaptureRunSchema,
  CaptureRunSuccessSchema,
  CaptureKindSchema,
  CaptureScheduleDefinitionSchema,
  CaptureScheduleRecordSchema,
  knownValue,
  unknownValue,
  type CaptureRun,
  type CaptureRunSuccess,
  type CaptureKind,
  type CaptureScheduleRecord,
} from '@zerotrace/schemas';

export interface CaptureScheduleRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface SchedulerClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

interface SchedulerPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  connect(): Promise<SchedulerClient>;
  end(): Promise<void>;
}

interface InternalOptions {
  pool: SchedulerPool;
}

export type CaptureScheduleStorageErrorCode =
  | 'CAPTURE_SCHEDULER_INVALID'
  | 'CAPTURE_SCHEDULER_CONFLICT'
  | 'CAPTURE_SCHEDULER_NOT_FOUND'
  | 'CAPTURE_SCHEDULER_LEASE_LOST'
  | 'CAPTURE_SCHEDULER_UNAVAILABLE'
  | 'CAPTURE_SCHEDULER_NOT_INITIALIZED';

export class CaptureScheduleStorageError extends Error {
  readonly code: CaptureScheduleStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: CaptureScheduleStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'CaptureScheduleStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface ClaimDueCaptureRunsInput {
  owner: string;
  captureKinds: readonly CaptureKind[];
  now?: string;
  leaseSeconds?: number;
  limit?: number;
}

export interface CompleteCaptureRunInput {
  runId: string;
  leaseToken: string;
  result: CaptureRunSuccess;
  completedAt?: string;
}

export interface FailCaptureRunInput {
  runId: string;
  leaseToken: string;
  code: string;
  detail: string;
  sourceRetryable: boolean;
  failedAt?: string;
}

const SELECT_SCHEDULE = `
  SELECT
    id,
    identity_hash,
    definition,
    status,
    next_run_at,
    revision,
    created_at,
    updated_at
  FROM capture_schedules
`;

const SELECT_RUN = `
  SELECT
    run.id,
    run.schedule_id,
    run.scheduled_for,
    run.status,
    run.attempt,
    run.max_attempts,
    run.available_at,
    run.lease_owner,
    run.lease_token,
    run.lease_started_at,
    run.lease_expires_at,
    run.result,
    run.failure,
    run.created_at,
    run.updated_at,
    run.completed_at,
    schedule.definition
  FROM capture_runs run
  JOIN capture_schedules schedule ON schedule.id = run.schedule_id
`;

function createPool(options: CaptureScheduleRepositoryOptions): SchedulerPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-capture-scheduler',
  });
  pool.on('error', () => undefined);
  return pool;
}

function canonicalTime(value: string, field: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new CaptureScheduleStorageError(
      'CAPTURE_SCHEDULER_INVALID',
      `${field} must be an ISO date-time.`,
    );
  }
  return date.toISOString();
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new CaptureScheduleStorageError(
      'CAPTURE_SCHEDULER_CONFLICT',
      `Stored capture ${field} is invalid.`,
    );
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new CaptureScheduleStorageError(
      'CAPTURE_SCHEDULER_CONFLICT',
      `Stored capture ${field} is invalid.`,
    );
  }
  return date.toISOString();
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  return value === null || value === undefined ? undefined : timestamp(value, field);
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CaptureScheduleStorageError(
      'CAPTURE_SCHEDULER_CONFLICT',
      `Stored capture ${field} is invalid.`,
    );
  }
  return parsed;
}

function jsonObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CaptureScheduleStorageError(
      'CAPTURE_SCHEDULER_CONFLICT',
      `Stored capture ${field} is invalid.`,
    );
  }
  return value as Record<string, unknown>;
}

function scheduleFromRow(row: Record<string, unknown>): CaptureScheduleRecord {
  const definition = CaptureScheduleDefinitionSchema.parse(row.definition);
  const status = requiredString(row, 'status');
  const nextRunAt = optionalTimestamp(row.next_run_at, 'next_run_at');
  return CaptureScheduleRecordSchema.parse({
    definition,
    status,
    nextRunAt:
      nextRunAt === undefined
        ? unknownValue('NOT_APPLICABLE', `Schedule is ${status.toLowerCase()}.`)
        : knownValue(nextRunAt),
    revision: integer(row.revision, 'revision'),
    createdAt: timestamp(row.created_at, 'created_at'),
    updatedAt: timestamp(row.updated_at, 'updated_at'),
  });
}

function runFromRow(row: Record<string, unknown>): CaptureRun {
  const definition = CaptureScheduleDefinitionSchema.parse(row.definition);
  const status = requiredString(row, 'status');
  const leaseExpiresAt = optionalTimestamp(row.lease_expires_at, 'lease_expires_at');
  const completedAt = optionalTimestamp(row.completed_at, 'completed_at');
  const storedResult = row.result;
  const storedFailure = row.failure;
  return CaptureRunSchema.parse({
    schemaVersion: 'capture-run-v1',
    id: requiredString(row, 'id'),
    scheduleId: requiredString(row, 'schedule_id'),
    captureKind: definition.captureKind,
    operation: definition.operation,
    target: definition.target,
    parameters: definition.parameters,
    scheduledFor: timestamp(row.scheduled_for, 'scheduled_for'),
    status,
    attempt: integer(row.attempt, 'attempt'),
    maxAttempts: integer(row.max_attempts, 'max_attempts'),
    availableAt: timestamp(row.available_at, 'available_at'),
    lease:
      status === 'LEASED'
        ? knownValue({
            owner: requiredString(row, 'lease_owner'),
            token: requiredString(row, 'lease_token'),
            expiresAt: leaseExpiresAt ?? '',
          })
        : unknownValue('NOT_APPLICABLE', 'Run has no active lease.'),
    result:
      status === 'SUCCEEDED'
        ? knownValue(jsonObject(storedResult, 'result'))
        : unknownValue(
            status === 'FAILED_TERMINAL' ? 'INSUFFICIENT_DATA' : 'NOT_QUERIED',
            'No successful capture result is available.',
          ),
    failure:
      status === 'RETRY_WAIT' || status === 'FAILED_TERMINAL'
        ? knownValue(jsonObject(storedFailure, 'failure'))
        : unknownValue('NOT_APPLICABLE', 'Run has no failure.'),
    createdAt: timestamp(row.created_at, 'created_at'),
    updatedAt: timestamp(row.updated_at, 'updated_at'),
    completedAt:
      completedAt === undefined
        ? unknownValue('NOT_APPLICABLE', 'Run is not terminal.')
        : knownValue(completedAt),
  });
}

function validateOwner(owner: string): string {
  const normalized = owner.trim();
  if (normalized.length < 1 || normalized.length > 160) {
    throw new CaptureScheduleStorageError(
      'CAPTURE_SCHEDULER_INVALID',
      'Capture lease owner must contain 1 to 160 characters.',
    );
  }
  return normalized;
}

function boundedInteger(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new CaptureScheduleStorageError(
      'CAPTURE_SCHEDULER_INVALID',
      `${field} must be an integer from ${minimum} through ${maximum}.`,
    );
  }
  return value;
}

function writeFailure(error: unknown, unavailableMessage: string): CaptureScheduleStorageError {
  if (error instanceof CaptureScheduleStorageError) return error;
  const postgresCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  if (
    postgresCode === 'P0001' ||
    (typeof postgresCode === 'string' && postgresCode.startsWith('23'))
  ) {
    return new CaptureScheduleStorageError(
      'CAPTURE_SCHEDULER_CONFLICT',
      'Durable capture scheduler integrity validation rejected the write.',
      { cause: error },
    );
  }
  return new CaptureScheduleStorageError('CAPTURE_SCHEDULER_UNAVAILABLE', unavailableMessage, {
    retryable: true,
    cause: error,
  });
}

async function transaction<T>(pool: SchedulerPool, work: (client: SchedulerClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function completeOneShotSchedule(
  client: SchedulerClient,
  scheduleId: string,
  completedAt: string,
): Promise<void> {
  await client.query(
    `
      UPDATE capture_schedules
      SET status = 'COMPLETED', next_run_at = NULL, revision = revision + 1,
          updated_at = $2::timestamptz
      WHERE id = $1
        AND status = 'ACTIVE'
        AND trigger ->> 'type' = 'ONCE'
    `,
    [scheduleId, completedAt],
  );
}

export class PostgresCaptureScheduleRepository {
  readonly #pool: SchedulerPool;

  constructor(options: CaptureScheduleRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: SchedulerPool): PostgresCaptureScheduleRepository {
    return new PostgresCaptureScheduleRepository({ pool });
  }

  async putSchedule(input: CaptureScheduleRecord): Promise<CaptureScheduleRecord> {
    const schedule = CaptureScheduleRecordSchema.parse(input);
    if (schedule.revision !== 1) {
      throw new CaptureScheduleStorageError(
        'CAPTURE_SCHEDULER_INVALID',
        'A new capture schedule must begin at revision 1.',
      );
    }
    const definition = schedule.definition;
    try {
      await this.#pool.query(
        `
          INSERT INTO capture_schedules (
            id, identity_hash, capture_kind, operation, ledger, chain_id, subject_type,
            normalized_identifier, parameters, trigger, retry_policy, definition, status,
            next_run_at, revision, created_at, updated_at
          ) VALUES (
            $1, $2, $3, $4, $5::ledger_kind, $6, $7, $8, $9::jsonb, $10::jsonb,
            $11::jsonb, $12::jsonb, $13, $14::timestamptz, $15, $16::timestamptz,
            $17::timestamptz
          )
          ON CONFLICT (id) DO NOTHING
        `,
        [
          definition.id,
          definition.identityHash,
          definition.captureKind,
          definition.operation,
          definition.target.ledger,
          definition.target.chainId,
          definition.target.subjectType,
          definition.target.normalizedIdentifier,
          JSON.stringify(definition.parameters),
          JSON.stringify(definition.trigger),
          JSON.stringify(definition.retryPolicy),
          JSON.stringify(definition),
          schedule.status,
          schedule.nextRunAt.state === 'known' ? schedule.nextRunAt.value : null,
          schedule.revision,
          schedule.createdAt,
          schedule.updatedAt,
        ],
      );
      const stored = await this.getSchedule(definition.id);
      if (stored === undefined || stored.definition.identityHash !== definition.identityHash) {
        throw new CaptureScheduleStorageError(
          'CAPTURE_SCHEDULER_CONFLICT',
          'Stored capture schedule conflicts with its canonical identity.',
        );
      }
      return stored;
    } catch (error) {
      throw writeFailure(error, 'Durable capture schedule write failed.');
    }
  }

  async getSchedule(id: string): Promise<CaptureScheduleRecord | undefined> {
    try {
      const result = await this.#pool.query(`${SELECT_SCHEDULE} WHERE id = $1`, [id]);
      return result.rows[0] === undefined ? undefined : scheduleFromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof CaptureScheduleStorageError) throw error;
      throw new CaptureScheduleStorageError(
        'CAPTURE_SCHEDULER_UNAVAILABLE',
        'Durable capture schedule read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async getRun(id: string): Promise<CaptureRun | undefined> {
    try {
      const result = await this.#pool.query(`${SELECT_RUN} WHERE run.id = $1`, [id]);
      return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof CaptureScheduleStorageError) throw error;
      throw new CaptureScheduleStorageError(
        'CAPTURE_SCHEDULER_UNAVAILABLE',
        'Durable capture run read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async claimDue(input: ClaimDueCaptureRunsInput): Promise<CaptureRun[]> {
    const owner = validateOwner(input.owner);
    const captureKinds = [
      ...new Set(CaptureKindSchema.array().min(1).parse(input.captureKinds)),
    ].sort();
    const now = canonicalTime(input.now ?? new Date().toISOString(), 'now');
    const leaseSeconds = boundedInteger(input.leaseSeconds ?? 300, 'leaseSeconds', 30, 3_600);
    const limit = boundedInteger(input.limit ?? 10, 'limit', 1, 100);
    try {
      const runIds = await transaction(this.#pool, async (client) => {
        await this.#recoverExpired(client, now, limit, captureKinds);
        const claimed: string[] = [];
        const retries = await client.query(
          `
            SELECT run.id, run.attempt
            FROM capture_runs run
            JOIN capture_schedules schedule ON schedule.id = run.schedule_id
            WHERE run.status = 'RETRY_WAIT'
              AND run.available_at <= $1::timestamptz
              AND schedule.capture_kind = ANY($2::text[])
            ORDER BY run.available_at, run.scheduled_for, run.id
            FOR UPDATE OF run SKIP LOCKED
            LIMIT $3
          `,
          [now, captureKinds, limit],
        );
        for (const row of retries.rows) {
          const id = requiredString(row, 'id');
          const token = leaseToken();
          const updated = await client.query(
            `
              UPDATE capture_runs
              SET status = 'LEASED', attempt = attempt + 1, lease_owner = $2,
                  lease_token = $3, lease_started_at = $4::timestamptz,
                  lease_expires_at = $4::timestamptz + make_interval(secs => $5),
                  failure = NULL, updated_at = $4::timestamptz
              WHERE id = $1 AND status = 'RETRY_WAIT' AND attempt = $6
            `,
            [id, owner, token, now, leaseSeconds, integer(row.attempt, 'attempt')],
          );
          if (updated.rowCount !== 1) {
            throw new CaptureScheduleStorageError(
              'CAPTURE_SCHEDULER_CONFLICT',
              'Retry capture lease changed concurrently.',
            );
          }
          claimed.push(id);
        }

        const remaining = limit - claimed.length;
        if (remaining > 0) {
          const due = await client.query(
            `
              SELECT id, next_run_at, definition
              FROM capture_schedules schedule
              WHERE status = 'ACTIVE'
                AND next_run_at <= $1::timestamptz
                AND capture_kind = ANY($2::text[])
                AND NOT EXISTS (
                  SELECT 1 FROM capture_runs run
                  WHERE run.schedule_id = schedule.id
                    AND run.status IN ('LEASED', 'RETRY_WAIT')
                )
              ORDER BY next_run_at, id
              FOR UPDATE SKIP LOCKED
              LIMIT $3
            `,
            [now, captureKinds, remaining],
          );
          for (const row of due.rows) {
            const definition = CaptureScheduleDefinitionSchema.parse(row.definition);
            const scheduledFor = timestamp(row.next_run_at, 'next_run_at');
            const runId = captureRunIdFor(definition.id, scheduledFor);
            const token = leaseToken();
            const inserted = await client.query(
              `
                INSERT INTO capture_runs (
                  id, schedule_id, scheduled_for, status, attempt, max_attempts,
                  available_at, lease_owner, lease_token, lease_started_at, lease_expires_at,
                  created_at, updated_at
                ) VALUES (
                  $1, $2, $3::timestamptz, 'LEASED', 1, $4, $3::timestamptz,
                  $5, $6, $7::timestamptz,
                  $7::timestamptz + make_interval(secs => $8), $7::timestamptz, $7::timestamptz
                )
                ON CONFLICT (id) DO NOTHING
              `,
              [
                runId,
                definition.id,
                scheduledFor,
                definition.retryPolicy.maxAttempts,
                owner,
                token,
                now,
                leaseSeconds,
              ],
            );
            if (inserted.rowCount !== 1) {
              throw new CaptureScheduleStorageError(
                'CAPTURE_SCHEDULER_CONFLICT',
                'Capture occurrence identity already exists but the schedule did not advance.',
              );
            }
            if (definition.trigger.type === 'INTERVAL') {
              const nextRunAt = nextCaptureOccurrence(definition.trigger, now, false);
              if (nextRunAt === undefined) {
                throw new CaptureScheduleStorageError(
                  'CAPTURE_SCHEDULER_CONFLICT',
                  'Recurring capture schedule did not produce a next occurrence.',
                );
              }
              await client.query(
                `
                  UPDATE capture_schedules
                  SET next_run_at = $2::timestamptz, revision = revision + 1,
                      updated_at = $3::timestamptz
                  WHERE id = $1 AND status = 'ACTIVE'
                `,
                [definition.id, nextRunAt, now],
              );
            }
            claimed.push(runId);
          }
        }
        return claimed;
      });
      const runs = await Promise.all(runIds.map((id) => this.getRun(id)));
      return runs.map((run, index) => {
        if (run === undefined) {
          throw new CaptureScheduleStorageError(
            'CAPTURE_SCHEDULER_CONFLICT',
            `Claimed capture run ${runIds[index] ?? 'unknown'} vanished.`,
          );
        }
        return run;
      });
    } catch (error) {
      throw writeFailure(error, 'Durable capture lease acquisition failed.');
    }
  }

  async complete(input: CompleteCaptureRunInput): Promise<CaptureRun> {
    const result = CaptureRunSuccessSchema.parse(input.result);
    const completedAt = canonicalTime(input.completedAt ?? new Date().toISOString(), 'completedAt');
    try {
      await transaction(this.#pool, async (client) => {
        const locked = await client.query(
          `
            SELECT schedule_id, status, attempt, lease_owner, lease_token, lease_started_at,
                   lease_expires_at
            FROM capture_runs
            WHERE id = $1
            FOR UPDATE
          `,
          [input.runId],
        );
        const row = locked.rows[0];
        if (row === undefined) {
          throw new CaptureScheduleStorageError(
            'CAPTURE_SCHEDULER_NOT_FOUND',
            'Capture run was not found.',
          );
        }
        this.#assertLease(row, input.leaseToken, completedAt);
        const snapshot = await client.query(
          `
            SELECT snapshot.id::text
            FROM evidence terminal
            JOIN analysis_snapshots snapshot ON snapshot.id = terminal.snapshot_id
            WHERE terminal.id = $1 AND snapshot.payload = $2::jsonb
          `,
          [result.terminalEvidenceId, JSON.stringify(result.snapshot)],
        );
        const snapshotId = snapshot.rows[0]?.id;
        if (typeof snapshotId !== 'string') {
          throw new CaptureScheduleStorageError(
            'CAPTURE_SCHEDULER_CONFLICT',
            'Capture terminal Evidence does not bind the submitted Snapshot.',
          );
        }
        await client.query(
          `
            INSERT INTO capture_run_attempts (
              run_id, attempt, lease_owner, lease_token, started_at, finished_at,
              outcome, evidence_ids
            ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, 'SUCCEEDED', $7)
          `,
          [
            input.runId,
            integer(row.attempt, 'attempt'),
            requiredString(row, 'lease_owner'),
            input.leaseToken,
            timestamp(row.lease_started_at, 'lease_started_at'),
            completedAt,
            result.evidenceIds,
          ],
        );
        const updated = await client.query(
          `
            UPDATE capture_runs
            SET status = 'SUCCEEDED', lease_owner = NULL, lease_token = NULL,
                lease_started_at = NULL, lease_expires_at = NULL, result = $3::jsonb,
                result_ref = $4, snapshot_id = $5::uuid, terminal_evidence_id = $6,
                evidence_ids = $7, source_set = $8, model_version = $9,
                coverage = $10, freshness = $11::timestamptz, confidence = $12,
                updated_at = $13::timestamptz, completed_at = $13::timestamptz
            WHERE id = $1 AND status = 'LEASED' AND lease_token = $2
          `,
          [
            input.runId,
            input.leaseToken,
            JSON.stringify(result),
            result.resultRef,
            snapshotId,
            result.terminalEvidenceId,
            result.evidenceIds,
            result.sourceSet,
            result.modelVersion,
            result.coverage,
            result.freshness,
            result.confidence,
            completedAt,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new CaptureScheduleStorageError(
            'CAPTURE_SCHEDULER_LEASE_LOST',
            'Capture lease was lost before completion.',
          );
        }
        await completeOneShotSchedule(client, requiredString(row, 'schedule_id'), completedAt);
      });
      const stored = await this.getRun(input.runId);
      if (stored === undefined) {
        throw new CaptureScheduleStorageError(
          'CAPTURE_SCHEDULER_CONFLICT',
          'Completed capture run vanished.',
        );
      }
      return stored;
    } catch (error) {
      throw writeFailure(error, 'Durable capture completion failed.');
    }
  }

  async fail(input: FailCaptureRunInput): Promise<CaptureRun> {
    const failedAt = canonicalTime(input.failedAt ?? new Date().toISOString(), 'failedAt');
    const failure = CaptureRunFailureSchema.parse({
      code: input.code.trim(),
      detail: input.detail.trim(),
      sourceRetryable: input.sourceRetryable,
    });
    try {
      await transaction(this.#pool, async (client) => {
        const locked = await client.query(
          `
            SELECT run.schedule_id, run.status, run.attempt, run.max_attempts, run.lease_owner,
                   run.lease_token, run.lease_started_at, run.lease_expires_at,
                   schedule.retry_policy
            FROM capture_runs run
            JOIN capture_schedules schedule ON schedule.id = run.schedule_id
            WHERE run.id = $1
            FOR UPDATE OF run, schedule
          `,
          [input.runId],
        );
        const row = locked.rows[0];
        if (row === undefined) {
          throw new CaptureScheduleStorageError(
            'CAPTURE_SCHEDULER_NOT_FOUND',
            'Capture run was not found.',
          );
        }
        this.#assertLease(row, input.leaseToken, failedAt);
        const attempt = integer(row.attempt, 'attempt');
        const maxAttempts = integer(row.max_attempts, 'max_attempts');
        const retryable = input.sourceRetryable && attempt < maxAttempts;
        await client.query(
          `
            INSERT INTO capture_run_attempts (
              run_id, attempt, lease_owner, lease_token, started_at, finished_at,
              outcome, failure
            ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7, $8::jsonb)
          `,
          [
            input.runId,
            attempt,
            requiredString(row, 'lease_owner'),
            input.leaseToken,
            timestamp(row.lease_started_at, 'lease_started_at'),
            failedAt,
            retryable ? 'RETRYABLE_FAILURE' : 'TERMINAL_FAILURE',
            JSON.stringify(failure),
          ],
        );
        const availableAt = retryable
          ? new Date(
              Date.parse(failedAt) +
                retryDelaySeconds(
                  CaptureScheduleDefinitionSchema.shape.retryPolicy.parse(row.retry_policy),
                  attempt,
                ) *
                  1_000,
            ).toISOString()
          : failedAt;
        const updated = await client.query(
          `
            UPDATE capture_runs
            SET status = $3, available_at = $4::timestamptz, lease_owner = NULL,
                lease_token = NULL, lease_started_at = NULL, lease_expires_at = NULL,
                failure = $5::jsonb, updated_at = $6::timestamptz,
                completed_at = CASE WHEN $3 = 'FAILED_TERMINAL' THEN $6::timestamptz ELSE NULL END
            WHERE id = $1 AND status = 'LEASED' AND lease_token = $2
          `,
          [
            input.runId,
            input.leaseToken,
            retryable ? 'RETRY_WAIT' : 'FAILED_TERMINAL',
            availableAt,
            JSON.stringify(failure),
            failedAt,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new CaptureScheduleStorageError(
            'CAPTURE_SCHEDULER_LEASE_LOST',
            'Capture lease was lost before failure could be recorded.',
          );
        }
        if (!retryable) {
          await completeOneShotSchedule(client, requiredString(row, 'schedule_id'), failedAt);
        }
      });
      const stored = await this.getRun(input.runId);
      if (stored === undefined) {
        throw new CaptureScheduleStorageError(
          'CAPTURE_SCHEDULER_CONFLICT',
          'Failed capture run vanished.',
        );
      }
      return stored;
    } catch (error) {
      throw writeFailure(error, 'Durable capture failure transition failed.');
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: CaptureScheduleStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(`
        SELECT
          to_regclass('public.capture_schedules')::text AS schedules,
          to_regclass('public.capture_runs')::text AS runs,
          to_regclass('public.capture_run_attempts')::text AS attempts,
          EXISTS (
            SELECT 1 FROM schema_migrations WHERE version = '024_capture_schedules'
          ) AS migrated
      `);
      const row = result.rows[0];
      if (
        row?.schedules !== 'capture_schedules' ||
        row.runs !== 'capture_runs' ||
        row.attempts !== 'capture_run_attempts' ||
        row.migrated !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'CAPTURE_SCHEDULER_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'CAPTURE_SCHEDULER_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }

  #assertLease(row: Record<string, unknown>, token: string, eventAt: string): void {
    if (row.status !== 'LEASED') {
      throw new CaptureScheduleStorageError(
        'CAPTURE_SCHEDULER_LEASE_LOST',
        'Capture run is no longer leased.',
      );
    }
    const storedToken = requiredString(row, 'lease_token');
    const expiresAt = timestamp(row.lease_expires_at, 'lease_expires_at');
    if (storedToken !== token || eventAt > expiresAt) {
      throw new CaptureScheduleStorageError(
        'CAPTURE_SCHEDULER_LEASE_LOST',
        'Capture lease is missing, expired, or owned by another attempt.',
      );
    }
  }

  async #recoverExpired(
    client: SchedulerClient,
    now: string,
    limit: number,
    captureKinds: readonly CaptureKind[],
  ): Promise<void> {
    const expired = await client.query(
      `
        SELECT run.id, run.schedule_id, run.attempt, run.max_attempts, run.lease_owner,
               run.lease_token, run.lease_started_at, schedule.retry_policy
        FROM capture_runs run
        JOIN capture_schedules schedule ON schedule.id = run.schedule_id
        WHERE run.status = 'LEASED'
          AND run.lease_expires_at <= $1::timestamptz
          AND schedule.capture_kind = ANY($2::text[])
        ORDER BY run.lease_expires_at, run.id
        FOR UPDATE OF run, schedule SKIP LOCKED
        LIMIT $3
      `,
      [now, captureKinds, limit],
    );
    for (const row of expired.rows) {
      const attempt = integer(row.attempt, 'attempt');
      const maxAttempts = integer(row.max_attempts, 'max_attempts');
      const retryable = attempt < maxAttempts;
      const failure = {
        code: 'CAPTURE_LEASE_EXPIRED',
        detail: 'The worker lease expired before it committed a terminal result.',
        sourceRetryable: true,
      };
      await client.query(
        `
          INSERT INTO capture_run_attempts (
            run_id, attempt, lease_owner, lease_token, started_at, finished_at,
            outcome, failure
          ) VALUES ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz,
                    'LEASE_EXPIRED', $7::jsonb)
        `,
        [
          requiredString(row, 'id'),
          attempt,
          requiredString(row, 'lease_owner'),
          requiredString(row, 'lease_token'),
          timestamp(row.lease_started_at, 'lease_started_at'),
          now,
          JSON.stringify(failure),
        ],
      );
      const availableAt = retryable
        ? new Date(
            Date.parse(now) +
              retryDelaySeconds(
                CaptureScheduleDefinitionSchema.shape.retryPolicy.parse(row.retry_policy),
                attempt,
              ) *
                1_000,
          ).toISOString()
        : now;
      await client.query(
        `
          UPDATE capture_runs
          SET status = $2, available_at = $3::timestamptz, lease_owner = NULL,
              lease_token = NULL, lease_started_at = NULL, lease_expires_at = NULL,
              failure = $4::jsonb, updated_at = $5::timestamptz,
              completed_at = CASE WHEN $2 = 'FAILED_TERMINAL' THEN $5::timestamptz ELSE NULL END
          WHERE id = $1 AND status = 'LEASED'
        `,
        [
          requiredString(row, 'id'),
          retryable ? 'RETRY_WAIT' : 'FAILED_TERMINAL',
          availableAt,
          JSON.stringify(failure),
          now,
        ],
      );
      if (!retryable) {
        await completeOneShotSchedule(client, requiredString(row, 'schedule_id'), now);
      }
    }
  }
}
