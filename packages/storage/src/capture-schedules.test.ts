import { describe, expect, it, vi } from 'vitest';

import { defineCaptureSchedule } from '@zerotrace/capture-scheduler';

import { PostgresCaptureScheduleRepository } from './capture-schedules.js';

describe('Postgres capture schedule queries', () => {
  it('lists schedules by immutable target and capture kind', async () => {
    const schedule = defineCaptureSchedule({
      captureKind: 'TOKEN_HISTORY_BACKFILL',
      target: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'TOKEN',
        normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      },
      parameters: {
        schemaVersion: 'token-history-backfill-v1',
        dataset: 'binance-mainnet',
        token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
        fromBlock: '100',
        toBlock: '200',
        modelVersion: 'token-history-backfill-v1.0.0',
        policyVersion: 'token-history-policy-v1.0.0',
      },
      trigger: { type: 'ONCE', at: '2026-08-14T00:00:00.000Z' },
      retryPolicy: {
        maxAttempts: 3,
        initialDelaySeconds: 30,
        maximumDelaySeconds: 900,
        backoffMultiplierBps: 20_000,
      },
      createdAt: '2026-08-13T23:59:00.000Z',
    });
    const query = vi.fn(async (text: string) => {
      if (text.includes('FROM capture_schedules')) {
        return {
          rows: [
            {
              id: schedule.definition.id,
              identity_hash: schedule.definition.identityHash,
              definition: schedule.definition,
              status: schedule.status,
              next_run_at: schedule.nextRunAt.state === 'known' ? schedule.nextRunAt.value : null,
              revision: schedule.revision,
              created_at: schedule.createdAt,
              updated_at: schedule.updatedAt,
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresCaptureScheduleRepository.fromPool({
      query,
      connect: vi.fn(),
      end: vi.fn(),
    });

    await expect(
      repository.listSchedules({
        target: schedule.definition.target,
        captureKind: 'TOKEN_HISTORY_BACKFILL',
        limit: 10,
      }),
    ).resolves.toEqual([schedule]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('normalized_identifier = $4'), [
      'EVM',
      'eip155:56',
      'TOKEN',
      '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      'TOKEN_HISTORY_BACKFILL',
      10,
    ]);
  });

  it('rejects malformed run lookup identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresCaptureScheduleRepository.fromPool({
      query,
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(repository.listRunsForSchedule('invalid')).rejects.toMatchObject({
      code: 'CAPTURE_SCHEDULER_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects malformed targeted schedule selectors before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresCaptureScheduleRepository.fromPool({
      query,
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(
      repository.claimDue({
        owner: 'worker-a',
        captureKinds: ['TOKEN_HISTORY_BACKFILL'],
        scheduleId: 'not-a-schedule',
      }),
    ).rejects.toMatchObject({
      code: 'CAPTURE_SCHEDULER_INVALID',
    });
    expect(query).not.toHaveBeenCalled();
  });
});

function sampleSchedule() {
  return defineCaptureSchedule({
    captureKind: 'TOKEN_HISTORY_BACKFILL',
    target: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectType: 'TOKEN',
      normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
    },
    parameters: {
      schemaVersion: 'token-history-backfill-v1',
      dataset: 'binance-mainnet',
      token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      fromBlock: '100',
      toBlock: '200',
      modelVersion: 'token-history-backfill-v1.0.0',
      policyVersion: 'token-history-policy-v1.0.0',
    },
    trigger: { type: 'ONCE', at: '2026-08-14T00:00:00.000Z' },
    retryPolicy: {
      maxAttempts: 3,
      initialDelaySeconds: 30,
      maximumDelaySeconds: 900,
      backoffMultiplierBps: 20_000,
    },
    createdAt: '2026-08-13T23:59:00.000Z',
  });
}

function intervalSchedule() {
  return defineCaptureSchedule({
    captureKind: 'TOKEN_LIVE_CAPTURE',
    target: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectType: 'TOKEN',
      normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
    },
    parameters: {
      schemaVersion: 'token-live-capture-v1',
      dataset: 'binance-mainnet',
      token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      initialFromBlock: '1',
      windowBlocks: 100,
      modelVersion: 'token-live-capture-v1.0.0',
      policyVersion: 'token-history-policy-v1.0.0',
    },
    trigger: {
      type: 'INTERVAL',
      anchorAt: '2026-08-14T00:00:00.000Z',
      everySeconds: 3_600,
      catchupPolicy: 'SKIP_MISSED',
    },
    retryPolicy: {
      maxAttempts: 2,
      initialDelaySeconds: 30,
      maximumDelaySeconds: 900,
      backoffMultiplierBps: 20_000,
    },
    createdAt: '2026-08-14T00:00:00.000Z',
  });
}

function scheduleRow(schedule: ReturnType<typeof sampleSchedule>) {
  return {
    id: schedule.definition.id,
    identity_hash: schedule.definition.identityHash,
    definition: schedule.definition,
    status: schedule.status,
    next_run_at: schedule.nextRunAt.state === 'known' ? schedule.nextRunAt.value : null,
    revision: schedule.revision,
    created_at: schedule.createdAt,
    updated_at: schedule.updatedAt,
  };
}

function leasedRunRow(
  schedule: ReturnType<typeof sampleSchedule>,
  runId: string,
  overrides: Record<string, unknown> = {},
) {
  const scheduledFor =
    schedule.nextRunAt.state === 'known' ? schedule.nextRunAt.value : schedule.createdAt;
  return {
    id: runId,
    schedule_id: schedule.definition.id,
    scheduled_for: scheduledFor,
    status: 'LEASED',
    attempt: 1,
    max_attempts: schedule.definition.retryPolicy.maxAttempts,
    available_at: scheduledFor,
    lease_owner: 'worker-a',
    lease_token: 'a'.repeat(32),
    lease_started_at: '2026-08-14T00:00:00.000Z',
    lease_expires_at: '2026-08-15T00:00:00.000Z',
    result: null,
    failure: null,
    created_at: '2026-08-14T00:00:00.000Z',
    updated_at: '2026-08-14T00:00:00.000Z',
    completed_at: null,
    definition: schedule.definition,
    ...overrides,
  };
}

function successResult() {
  const capturedAt = '2026-08-14T00:00:00.000Z';
  const evidenceId = 'ev_aaaaaaaaaaaaaaaaaaaaaaaa';
  return {
    resultRef: `token-history-backfill#sha256=${'d'.repeat(64)}`,
    snapshot: {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '200',
      blockHash: `0x${'a'.repeat(64)}`,
      parentBlockHash: `0x${'b'.repeat(64)}`,
      finality: 'finalized' as const,
      blockTimestamp: capturedAt,
      capturedAt,
      providerVersions: { 'bsc-rpc@bsc.example': 'json-rpc' },
      adapterVersions: { evm: '0.1.0' },
      configHash: 'c'.repeat(64),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    },
    terminalEvidenceId: evidenceId,
    evidenceIds: [evidenceId],
    sourceSet: ['bsc-rpc@bsc.example'],
    modelVersion: 'token-history-backfill-v1.0.0',
    coverage: 1,
    freshness: capturedAt,
    confidence: 1,
  };
}

function transactionalPool(
  clientQuery: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }>,
) {
  const client = {
    query: vi.fn(async (text: string, values?: readonly unknown[]) => {
      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [], rowCount: 0 };
      }
      return clientQuery(text, values);
    }),
    release: vi.fn(),
  };
  const query = vi.fn(async (text: string, values?: readonly unknown[]) =>
    clientQuery(text, values),
  );
  return {
    query,
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    client,
  };
}

describe('Postgres capture schedule writes and leases', () => {
  it('constructs a pool, writes a schedule, and fail-closes identity conflicts', async () => {
    const constructed = new PostgresCaptureScheduleRepository({
      connectionString: 'postgresql://zerotrace:secret@127.0.0.1:1/zerotrace',
      connectionTimeoutMs: 50,
      statementTimeoutMs: 50,
      maxConnections: 1,
    });
    await constructed.close();

    const schedule = sampleSchedule();
    const query = vi.fn(async (text: string, values?: readonly unknown[]) => {
      if (text.includes('INSERT INTO capture_schedules')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM capture_schedules')) {
        if (values?.[0] === 'missing') return { rows: [], rowCount: 0 };
        return { rows: [scheduleRow(schedule)], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresCaptureScheduleRepository.fromPool({
      query,
      connect: vi.fn(),
      end: vi.fn(async () => undefined),
    });
    await expect(repository.putSchedule(schedule)).resolves.toEqual(schedule);
    await expect(repository.getSchedule(schedule.definition.id)).resolves.toEqual(schedule);
    await expect(repository.getSchedule('missing')).resolves.toBeUndefined();
    await expect(repository.putSchedule({ ...schedule, revision: 2 })).rejects.toMatchObject({
      code: 'CAPTURE_SCHEDULER_INVALID',
    });

    const conflict = PostgresCaptureScheduleRepository.fromPool({
      query: vi.fn(async (text: string) => {
        if (text.includes('INSERT INTO capture_schedules')) return { rows: [], rowCount: 1 };
        if (text.includes('FROM capture_schedules')) {
          return {
            rows: [
              scheduleRow({
                ...schedule,
                definition: { ...schedule.definition, identityHash: 'e'.repeat(64) },
              }),
            ],
            rowCount: 1,
          };
        }
        throw new Error(`Unexpected SQL: ${text}`);
      }),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(conflict.putSchedule(schedule)).rejects.toMatchObject({
      code: 'CAPTURE_SCHEDULER_CONFLICT',
    });

    const duplicate = PostgresCaptureScheduleRepository.fromPool({
      query: vi.fn(async () => {
        const error = new Error('duplicate') as Error & { code?: string };
        error.code = '23505';
        throw error;
      }),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(duplicate.putSchedule(schedule)).rejects.toMatchObject({
      code: 'CAPTURE_SCHEDULER_CONFLICT',
    });
  });

  it('keeps missing runs undefined and maps postgres unavailability without inventing a schedule', async () => {
    const schedule = sampleSchedule();
    const down = PostgresCaptureScheduleRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(down.getSchedule(schedule.definition.id)).rejects.toMatchObject({
      code: 'CAPTURE_SCHEDULER_UNAVAILABLE',
    });
    await expect(down.getRun('cpr_aaaaaaaaaaaaaaaaaaaaaaaa')).rejects.toMatchObject({
      code: 'CAPTURE_SCHEDULER_UNAVAILABLE',
    });
    await expect(
      down.listSchedules({
        target: schedule.definition.target,
        captureKind: 'TOKEN_HISTORY_BACKFILL',
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_UNAVAILABLE' });
    await expect(down.listRunsForSchedule(schedule.definition.id)).rejects.toMatchObject({
      code: 'CAPTURE_SCHEDULER_UNAVAILABLE',
    });

    const empty = PostgresCaptureScheduleRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(empty.getRun('cpr_aaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toBeUndefined();
    await expect(
      empty.listSchedules({
        target: schedule.definition.target,
        captureKind: 'TOKEN_HISTORY_BACKFILL',
        limit: 1,
      }),
    ).resolves.toEqual([]);
    await expect(empty.listRunsForSchedule(schedule.definition.id, 5)).resolves.toEqual([]);
    await expect(
      empty.listSchedules({
        target: schedule.definition.target,
        captureKind: 'TOKEN_HISTORY_BACKFILL',
        limit: 0,
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_INVALID' });
  });

  it('claims due one-shot and interval runs, recovers expired leases, and retries waiting work', async () => {
    const once = sampleSchedule();
    const repeating = intervalSchedule();
    const retryId = 'cpr_bbbbbbbbbbbbbbbbbbbbbbbb';
    const expiredId = 'cpr_cccccccccccccccccccccccc';
    const now = '2026-08-14T01:00:00.000Z';
    const pool = transactionalPool(async (text, values) => {
      if (text.includes('lease_expires_at <=')) {
        return {
          rows: [
            {
              id: expiredId,
              schedule_id: once.definition.id,
              attempt: 1,
              max_attempts: 3,
              lease_owner: 'worker-old',
              lease_token: 'b'.repeat(32),
              lease_started_at: '2026-08-14T00:00:00.000Z',
              retry_policy: once.definition.retryPolicy,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes("run.status = 'RETRY_WAIT'")) {
        return {
          rows: [{ id: retryId, attempt: 1 }],
          rowCount: 1,
        };
      }
      if (text.includes("status = 'ACTIVE'")) {
        return {
          rows: [
            {
              id: repeating.definition.id,
              next_run_at:
                repeating.nextRunAt.state === 'known'
                  ? repeating.nextRunAt.value
                  : '2026-08-14T01:00:00.000Z',
              definition: repeating.definition,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO capture_run_attempts')) return { rows: [], rowCount: 1 };
      if (text.includes('INSERT INTO capture_runs')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE capture_runs') && text.includes("SET status = 'LEASED'")) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('UPDATE capture_runs')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE capture_schedules')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM capture_runs run')) {
        const id = String(values?.[0] ?? '');
        const definition = id === retryId ? once.definition : repeating.definition;
        return {
          rows: [leasedRunRow({ ...once, definition }, id, { definition })],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresCaptureScheduleRepository.fromPool(pool);
    const claimed = await repository.claimDue({
      owner: 'worker-a',
      captureKinds: ['TOKEN_HISTORY_BACKFILL', 'TOKEN_LIVE_CAPTURE'],
      now,
      leaseSeconds: 300,
      limit: 10,
    });
    expect(claimed.length).toBeGreaterThan(0);
    expect(claimed.every((run) => run.status === 'LEASED')).toBe(true);

    await expect(
      repository.claimDue({
        owner: '',
        captureKinds: ['TOKEN_HISTORY_BACKFILL'],
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_INVALID' });
    await expect(
      repository.claimDue({
        owner: 'worker-a',
        captureKinds: ['TOKEN_HISTORY_BACKFILL'],
        now: 'not-a-date',
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_INVALID' });
  });

  it('completes, renews, and fails leased runs without treating missing evidence as a zero result', async () => {
    const schedule = sampleSchedule();
    const runId = 'cpr_dddddddddddddddddddddddd';
    const token = 'a'.repeat(32);
    const result = successResult();
    const leased = leasedRunRow(schedule, runId);
    const succeeded = {
      ...leased,
      status: 'SUCCEEDED',
      lease_owner: null,
      lease_token: null,
      lease_started_at: null,
      lease_expires_at: null,
      result,
      completed_at: '2026-08-14T00:01:00.000Z',
    };
    const failed = {
      ...leased,
      status: 'RETRY_WAIT',
      lease_owner: null,
      lease_token: null,
      result: null,
      failure: { code: 'RPC_DOWN', detail: 'provider unavailable', sourceRetryable: true },
      completed_at: null,
    };

    const completePool = transactionalPool(async (text) => {
      if (text.includes('FOR UPDATE') && text.includes('FROM capture_runs')) {
        return { rows: [leased], rowCount: 1 };
      }
      if (text.includes('FROM evidence terminal')) {
        return { rows: [{ id: '11111111-1111-1111-1111-111111111111' }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO capture_run_attempts')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE capture_runs')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE capture_schedules')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM capture_runs run')) return { rows: [succeeded], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${text}`);
    });
    await expect(
      PostgresCaptureScheduleRepository.fromPool(completePool).complete({
        runId,
        leaseToken: token,
        result,
        completedAt: '2026-08-14T00:01:00.000Z',
      }),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });

    const missing = transactionalPool(async (text) => {
      if (text.includes('FOR UPDATE')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${text}`);
    });
    await expect(
      PostgresCaptureScheduleRepository.fromPool(missing).complete({
        runId,
        leaseToken: token,
        result,
        completedAt: '2026-08-14T00:01:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_NOT_FOUND' });

    const unbound = transactionalPool(async (text) => {
      if (text.includes('FOR UPDATE')) return { rows: [leased], rowCount: 1 };
      if (text.includes('FROM evidence terminal')) return { rows: [], rowCount: 0 };
      throw new Error(`Unexpected SQL: ${text}`);
    });
    await expect(
      PostgresCaptureScheduleRepository.fromPool(unbound).complete({
        runId,
        leaseToken: token,
        result,
        completedAt: '2026-08-14T00:01:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_CONFLICT' });

    const lostLease = transactionalPool(async (text) => {
      if (text.includes('FOR UPDATE'))
        return { rows: [{ ...leased, status: 'SUCCEEDED' }], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${text}`);
    });
    await expect(
      PostgresCaptureScheduleRepository.fromPool(lostLease).complete({
        runId,
        leaseToken: token,
        result,
        completedAt: '2026-08-14T00:01:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_LEASE_LOST' });

    const renewPool = transactionalPool(async (text) => {
      if (text.includes('FOR UPDATE')) return { rows: [leased], rowCount: 1 };
      if (text.includes('UPDATE capture_runs')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM capture_runs run')) return { rows: [leased], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${text}`);
    });
    await expect(
      PostgresCaptureScheduleRepository.fromPool(renewPool).renew({
        runId,
        leaseToken: token,
        leaseSeconds: 120,
        renewedAt: '2026-08-14T00:02:00.000Z',
      }),
    ).resolves.toMatchObject({ status: 'LEASED' });

    const failPool = transactionalPool(async (text) => {
      if (text.includes('FOR UPDATE OF run, schedule')) {
        return {
          rows: [{ ...leased, retry_policy: schedule.definition.retryPolicy }],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO capture_run_attempts')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE capture_runs')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM capture_runs run')) return { rows: [failed], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${text}`);
    });
    await expect(
      PostgresCaptureScheduleRepository.fromPool(failPool).fail({
        runId,
        leaseToken: token,
        code: 'RPC_DOWN',
        detail: 'provider unavailable',
        sourceRetryable: true,
        failedAt: '2026-08-14T00:03:00.000Z',
      }),
    ).resolves.toMatchObject({ status: 'RETRY_WAIT' });

    const terminalFail = transactionalPool(async (text) => {
      if (text.includes('FOR UPDATE OF run, schedule')) {
        return {
          rows: [
            {
              ...leased,
              attempt: 3,
              max_attempts: 3,
              retry_policy: schedule.definition.retryPolicy,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO capture_run_attempts')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE capture_runs')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE capture_schedules')) return { rows: [], rowCount: 1 };
      if (text.includes('FROM capture_runs run')) {
        return {
          rows: [
            {
              ...leased,
              status: 'FAILED_TERMINAL',
              attempt: 3,
              max_attempts: 3,
              lease_owner: null,
              lease_token: null,
              result: null,
              failure: { code: 'RPC_DOWN', detail: 'exhausted', sourceRetryable: false },
              completed_at: '2026-08-14T00:04:00.000Z',
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    await expect(
      PostgresCaptureScheduleRepository.fromPool(terminalFail).fail({
        runId,
        leaseToken: token,
        code: 'RPC_DOWN',
        detail: 'exhausted',
        sourceRetryable: false,
        failedAt: '2026-08-14T00:04:00.000Z',
      }),
    ).resolves.toMatchObject({ status: 'FAILED_TERMINAL' });
  });

  it('reports uninitialized and unavailable scheduler health without coercing missing tables to ready', async () => {
    const up = PostgresCaptureScheduleRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [
          {
            schedules: 'capture_schedules',
            runs: 'capture_runs',
            attempts: 'capture_run_attempts',
            migrated: true,
          },
        ],
        rowCount: 1,
      })),
      connect: vi.fn(),
      end: vi.fn(async () => undefined),
    });
    await expect(up.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await up.close();

    const missing = PostgresCaptureScheduleRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ schedules: null, runs: null, attempts: null, migrated: false }],
        rowCount: 1,
      })),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(missing.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'CAPTURE_SCHEDULER_NOT_INITIALIZED',
    });

    const down = PostgresCaptureScheduleRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      connect: vi.fn(),
      end: vi.fn(),
    });
    await expect(down.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'CAPTURE_SCHEDULER_UNAVAILABLE',
    });
  });

  it('rolls back a failed claim transaction and maps integrity errors', async () => {
    const client = {
      query: vi.fn(async (text: string) => {
        if (text === 'BEGIN') return { rows: [], rowCount: 0 };
        if (text === 'ROLLBACK') return { rows: [], rowCount: 0 };
        throw Object.assign(new Error('raise'), { code: 'P0001' });
      }),
      release: vi.fn(),
    };
    const repository = PostgresCaptureScheduleRepository.fromPool({
      query: vi.fn(),
      connect: vi.fn(async () => client),
      end: vi.fn(),
    });
    await expect(
      repository.claimDue({
        owner: 'worker-a',
        captureKinds: ['TOKEN_HISTORY_BACKFILL'],
        now: '2026-08-14T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_CONFLICT' });
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.release).toHaveBeenCalled();
  });
});
