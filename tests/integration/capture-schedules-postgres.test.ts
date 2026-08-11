import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { defineCaptureSchedule } from '@zerotrace/capture-scheduler';
import { createEvidence } from '@zerotrace/evidence';
import type { CaptureRunSuccess } from '@zerotrace/schemas';
import {
  CaptureScheduleStorageError,
  PostgresCaptureScheduleRepository,
  PostgresEvidenceRepository,
} from '@zerotrace/storage';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;

function target(nonce: string) {
  return {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    subjectType: 'TOKEN' as const,
    normalizedIdentifier: `0x${nonce.padEnd(40, '0').slice(0, 40)}`,
  };
}

postgresDescribe('PostgreSQL durable capture scheduling', () => {
  let schedules: PostgresCaptureScheduleRepository;
  let competingWorker: PostgresCaptureScheduleRepository;
  let evidence: PostgresEvidenceRepository;

  beforeAll(() => {
    schedules = new PostgresCaptureScheduleRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    competingWorker = new PostgresCaptureScheduleRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => Promise.all([schedules.close(), competingWorker.close(), evidence.close()]));

  it('leases once across workers, retries with bounded backoff, and commits Evidence-bound success', async () => {
    await expect(schedules.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    const nonce = randomBytes(8).toString('hex');
    const schedule = defineCaptureSchedule({
      captureKind: 'CLAIM_ACTIONS',
      target: target(nonce),
      parameters: { policyId: `policy-${nonce}` },
      trigger: {
        type: 'INTERVAL',
        anchorAt: '2026-08-12T00:00:00.000Z',
        everySeconds: 31_536_000,
        catchupPolicy: 'SKIP_MISSED',
      },
      retryPolicy: {
        maxAttempts: 3,
        initialDelaySeconds: 10,
        maximumDelaySeconds: 20,
        backoffMultiplierBps: 20_000,
      },
      createdAt: '2026-08-12T00:00:00.000Z',
    });
    const storedSchedule = await schedules.putSchedule(schedule);
    await expect(
      schedules.putSchedule(
        defineCaptureSchedule({
          captureKind: 'CLAIM_ACTIONS',
          target: target(nonce),
          parameters: { policyId: `policy-${nonce}` },
          trigger: {
            type: 'INTERVAL',
            anchorAt: '2026-08-12T00:00:00.000Z',
            everySeconds: 31_536_000,
            catchupPolicy: 'SKIP_MISSED',
          },
          retryPolicy: {
            maxAttempts: 3,
            initialDelaySeconds: 10,
            maximumDelaySeconds: 20,
            backoffMultiplierBps: 20_000,
          },
          createdAt: '2026-08-12T00:00:00.500Z',
        }),
      ),
    ).resolves.toEqual(storedSchedule);

    const [firstWorker, secondWorker] = await Promise.all([
      schedules.claimDue({
        owner: 'integration-worker-a',
        captureKinds: ['CLAIM_ACTIONS'],
        now: '2026-08-12T00:00:00.000Z',
        leaseSeconds: 30,
        limit: 1,
      }),
      competingWorker.claimDue({
        owner: 'integration-worker-b',
        captureKinds: ['CLAIM_ACTIONS'],
        now: '2026-08-12T00:00:00.000Z',
        leaseSeconds: 30,
        limit: 1,
      }),
    ]);
    expect(firstWorker.length + secondWorker.length).toBe(1);
    const first = [...firstWorker, ...secondWorker][0];
    expect(first).toMatchObject({ status: 'LEASED', attempt: 1, operation: 'READ_ONLY_CAPTURE' });
    if (first === undefined || first.lease.state !== 'known') throw new Error('Expected lease.');

    const retry = await schedules.fail({
      runId: first.id,
      leaseToken: first.lease.value.token,
      code: 'PROVIDER_DOWN',
      detail: 'Integration provider outage.',
      sourceRetryable: true,
      failedAt: '2026-08-12T00:00:05.000Z',
    });
    expect(retry).toMatchObject({
      status: 'RETRY_WAIT',
      attempt: 1,
      availableAt: '2026-08-12T00:00:15.000Z',
    });
    await expect(
      schedules.claimDue({
        owner: 'integration-worker-a',
        captureKinds: ['CLAIM_ACTIONS'],
        now: '2026-08-12T00:00:14.999Z',
        limit: 1,
      }),
    ).resolves.toEqual([]);
    const [second] = await schedules.claimDue({
      owner: 'integration-worker-a',
      captureKinds: ['CLAIM_ACTIONS'],
      now: '2026-08-12T00:00:15.000Z',
      leaseSeconds: 30,
      limit: 1,
    });
    expect(second).toMatchObject({ status: 'LEASED', attempt: 2 });
    if (second === undefined || second.lease.state !== 'known') throw new Error('Expected retry.');

    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:56',
      blockNumber: '50000000',
      blockHash: `0x${'ab'.repeat(32)}`,
      parentBlockHash: `0x${'cd'.repeat(32)}`,
      finality: 'finalized' as const,
      capturedAt: '2026-08-12T00:00:20.000Z',
      providerVersions: { 'bsc-rpc': '1' },
      adapterVersions: { claim: '1' },
      configHash: 'ef'.repeat(32),
      entityModelVersion: 'entity-v1',
      labelSnapshot: 'labels-v1',
    };
    const raw = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'PROVIDER_OBSERVATION',
      source: 'bsc-rpc@integration',
      locator: `capture:${nonce}:raw`,
      payload: { nonce, block: snapshot.blockNumber },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: 'finalized',
      summary: 'Integration capture source.',
    });
    const terminal = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:capture-integration-v1',
      locator: `capture:${nonce}:terminal`,
      payload: { nonce, result: 'complete' },
      observedAt: snapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: 'finalized',
      summary: 'Integration capture terminal.',
      sourceEvidenceIds: [raw.id],
    });
    await evidence.put(raw, [], snapshot);
    await evidence.put(terminal, [raw.id], snapshot);
    const success: CaptureRunSuccess = {
      resultRef: `integration:${nonce}`,
      snapshot,
      terminalEvidenceId: terminal.id,
      evidenceIds: [raw.id, terminal.id].sort(),
      sourceSet: ['bsc-rpc@integration'],
      modelVersion: 'capture-integration-v1',
      coverage: 0.5,
      freshness: snapshot.capturedAt,
      confidence: 1,
    };
    const unrelatedSnapshot = {
      ...snapshot,
      blockNumber: '49999999',
      blockHash: `0x${'12'.repeat(32)}`,
      parentBlockHash: `0x${'34'.repeat(32)}`,
      capturedAt: '2026-08-12T00:00:19.000Z',
    };
    const unrelated = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:56',
      kind: 'PROVIDER_OBSERVATION',
      source: 'bsc-rpc@integration',
      locator: `capture:${nonce}:unrelated`,
      payload: { nonce, block: unrelatedSnapshot.blockNumber },
      observedAt: unrelatedSnapshot.capturedAt,
      blockOrSlot: unrelatedSnapshot.blockNumber,
      finality: 'finalized',
      summary: 'Unrelated integration Evidence.',
    });
    await evidence.put(unrelated, [], unrelatedSnapshot);
    await expect(
      schedules.complete({
        runId: second.id,
        leaseToken: second.lease.value.token,
        result: {
          ...success,
          evidenceIds: [raw.id, terminal.id, unrelated.id].sort(),
        },
        completedAt: '2026-08-12T00:00:20.500Z',
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_CONFLICT', retryable: false });
    await expect(
      schedules.complete({
        runId: second.id,
        leaseToken: second.lease.value.token,
        result: { ...success, sourceSet: ['invented-source'] },
        completedAt: '2026-08-12T00:00:20.750Z',
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_CONFLICT', retryable: false });
    const completed = await schedules.complete({
      runId: second.id,
      leaseToken: second.lease.value.token,
      result: success,
      completedAt: '2026-08-12T00:00:21.000Z',
    });
    expect(completed).toMatchObject({ status: 'SUCCEEDED', attempt: 2 });
    expect(completed.result).toEqual({ state: 'known', value: success });
    await expect(
      schedules.complete({
        runId: second.id,
        leaseToken: second.lease.value.token,
        result: success,
        completedAt: '2026-08-12T00:00:22.000Z',
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_SCHEDULER_LEASE_LOST' });
  });

  it('recovers an expired lease and terminates an exhausted one-shot without inventing a result', async () => {
    const nonce = randomBytes(8).toString('hex');
    const schedule = await schedules.putSchedule(
      defineCaptureSchedule({
        captureKind: 'LABEL_INTELLIGENCE',
        target: target(nonce),
        parameters: { subject: nonce },
        trigger: { type: 'ONCE', at: '2026-08-12T01:00:00.000Z' },
        retryPolicy: {
          maxAttempts: 2,
          initialDelaySeconds: 5,
          maximumDelaySeconds: 5,
          backoffMultiplierBps: 10_000,
        },
        createdAt: '2026-08-12T01:00:00.000Z',
      }),
    );
    const [first] = await schedules.claimDue({
      owner: 'expiring-worker',
      captureKinds: ['LABEL_INTELLIGENCE'],
      now: '2026-08-12T01:00:00.000Z',
      leaseSeconds: 30,
      limit: 1,
    });
    expect(first).toMatchObject({ status: 'LEASED', attempt: 1 });
    await expect(
      schedules.claimDue({
        owner: 'recovery-worker',
        captureKinds: ['LABEL_INTELLIGENCE'],
        now: '2026-08-12T01:00:31.000Z',
        limit: 1,
      }),
    ).resolves.toEqual([]);
    const recovered = await schedules.getRun(first?.id ?? 'missing');
    expect(recovered).toMatchObject({
      status: 'RETRY_WAIT',
      availableAt: '2026-08-12T01:00:36.000Z',
    });
    const [retry] = await schedules.claimDue({
      owner: 'recovery-worker',
      captureKinds: ['LABEL_INTELLIGENCE'],
      now: '2026-08-12T01:00:36.000Z',
      leaseSeconds: 30,
      limit: 1,
    });
    if (retry === undefined || retry.lease.state !== 'known') throw new Error('Expected retry.');
    const terminal = await schedules.fail({
      runId: retry.id,
      leaseToken: retry.lease.value.token,
      code: 'SOURCE_UNAVAILABLE',
      detail: 'Second and final attempt failed.',
      sourceRetryable: true,
      failedAt: '2026-08-12T01:00:40.000Z',
    });
    expect(terminal).toMatchObject({ status: 'FAILED_TERMINAL', attempt: 2 });
    expect(terminal.result).toMatchObject({ state: 'unknown', reason: 'INSUFFICIENT_DATA' });
    await expect(schedules.getSchedule(schedule.definition.id)).resolves.toMatchObject({
      status: 'COMPLETED',
      nextRunAt: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    });
  });

  it('rejects terminal writes after lease expiry', async () => {
    const nonce = randomBytes(8).toString('hex');
    await schedules.putSchedule(
      defineCaptureSchedule({
        captureKind: 'CONTROL_SURFACE',
        target: target(nonce),
        parameters: {},
        trigger: { type: 'ONCE', at: '2026-08-12T02:00:00.000Z' },
        retryPolicy: {
          maxAttempts: 1,
          initialDelaySeconds: 5,
          maximumDelaySeconds: 5,
          backoffMultiplierBps: 10_000,
        },
        createdAt: '2026-08-12T02:00:00.000Z',
      }),
    );
    const [run] = await schedules.claimDue({
      owner: 'late-worker',
      captureKinds: ['CONTROL_SURFACE'],
      now: '2026-08-12T02:00:00.000Z',
      leaseSeconds: 30,
      limit: 1,
    });
    if (run === undefined || run.lease.state !== 'known') throw new Error('Expected lease.');
    await expect(
      schedules.fail({
        runId: run.id,
        leaseToken: run.lease.value.token,
        code: 'LATE_RESULT',
        detail: 'Worker tried to commit after its lease.',
        sourceRetryable: false,
        failedAt: '2026-08-12T02:00:31.000Z',
      }),
    ).rejects.toBeInstanceOf(CaptureScheduleStorageError);
  });
});
