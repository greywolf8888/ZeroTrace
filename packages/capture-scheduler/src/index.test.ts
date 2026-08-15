import { describe, expect, it, vi } from 'vitest';

import { CaptureRunSchema } from '@zerotrace/schemas';

import {
  CaptureExecutionError,
  captureRunIdFor,
  defineCaptureSchedule,
  nextCaptureOccurrence,
  retryDelaySeconds,
  runCaptureCycle,
} from './index.js';

const retryPolicy = {
  maxAttempts: 4,
  initialDelaySeconds: 10,
  maximumDelaySeconds: 25,
  backoffMultiplierBps: 20_000,
} as const;

describe('capture scheduling contracts', () => {
  it('defines a content-addressed read-only schedule independent of creation time', () => {
    const input = {
      captureKind: 'CLAIM_ACTIONS' as const,
      target: {
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        subjectType: 'TOKEN' as const,
        normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      },
      parameters: { window: 'registered-policy-window' },
      trigger: {
        type: 'INTERVAL' as const,
        anchorAt: '2026-08-12T00:00:00.1234567Z',
        everySeconds: 60,
        catchupPolicy: 'SKIP_MISSED' as const,
      },
      retryPolicy,
    };
    const first = defineCaptureSchedule({ ...input, createdAt: '2026-08-12T00:00:30.000Z' });
    const replay = defineCaptureSchedule({ ...input, createdAt: '2026-08-12T00:00:45.000Z' });

    expect(first.definition.id).toBe(replay.definition.id);
    expect(first.definition.operation).toBe('READ_ONLY_CAPTURE');
    expect(first.definition.trigger).toEqual({
      type: 'INTERVAL',
      anchorAt: '2026-08-12T00:00:00.123Z',
      everySeconds: 60,
      catchupPolicy: 'SKIP_MISSED',
    });
    expect(first.nextRunAt).toEqual({ state: 'known', value: '2026-08-12T00:01:00.123Z' });
  });

  it('keeps one-shot Token History backfill identity stable across enqueue time', () => {
    const input = {
      captureKind: 'TOKEN_HISTORY_BACKFILL' as const,
      target: {
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        subjectType: 'TOKEN' as const,
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
      retryPolicy,
    };
    const first = defineCaptureSchedule({
      ...input,
      trigger: { type: 'ONCE' as const, at: '2026-08-14T00:00:00.000Z' },
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    const second = defineCaptureSchedule({
      ...input,
      trigger: { type: 'ONCE' as const, at: '2026-08-15T00:00:00.000Z' },
      createdAt: '2026-08-15T00:00:00.000Z',
    });
    expect(first.definition.id).toBe(second.definition.id);
    expect(first.definition.trigger).not.toEqual(second.definition.trigger);
  });

  it('keeps live monitor identity stable across interval anchor time', () => {
    const input = {
      captureKind: 'TOKEN_LIVE_CAPTURE' as const,
      target: {
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        subjectType: 'TOKEN' as const,
        normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      },
      parameters: {
        schemaVersion: 'token-live-capture-v1',
        dataset: 'binance-mainnet',
        token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
        initialFromBlock: '100',
        windowBlocks: 1000,
        modelVersion: 'token-live-capture-v1.0.0',
        policyVersion: 'token-history-policy-v1.0.0',
      },
      retryPolicy,
    };
    const first = defineCaptureSchedule({
      ...input,
      trigger: {
        type: 'INTERVAL' as const,
        anchorAt: '2026-08-14T00:00:00.000Z',
        everySeconds: 60,
        catchupPolicy: 'SKIP_MISSED' as const,
      },
      createdAt: '2026-08-14T00:00:00.000Z',
    });
    const second = defineCaptureSchedule({
      ...input,
      trigger: {
        type: 'INTERVAL' as const,
        anchorAt: '2026-08-15T00:00:00.000Z',
        everySeconds: 60,
        catchupPolicy: 'SKIP_MISSED' as const,
      },
      createdAt: '2026-08-15T00:00:00.000Z',
    });
    expect(first.definition.id).toBe(second.definition.id);
    expect(first.definition.trigger).not.toEqual(second.definition.trigger);
  });

  it('dispatches registered handlers and fails closed for an unregistered kind', async () => {
    const leasedRun = CaptureRunSchema.parse({
      schemaVersion: 'capture-run-v1',
      id: 'cpr_0123456789abcdef01234567',
      scheduleId: 'cps_0123456789abcdef01234567',
      captureKind: 'CHAIN_HEAD',
      operation: 'READ_ONLY_CAPTURE',
      target: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'BLOCK',
        normalizedIdentifier: 'finalized',
      },
      parameters: {},
      scheduledFor: '2026-08-12T00:00:00.000Z',
      status: 'LEASED',
      attempt: 1,
      maxAttempts: 2,
      availableAt: '2026-08-12T00:00:00.000Z',
      lease: {
        state: 'known',
        value: {
          owner: 'worker-a',
          token: '0123456789abcdef0123456789abcdef',
          expiresAt: '2026-08-12T00:05:00.000Z',
        },
      },
      result: { state: 'unknown', reason: 'NOT_QUERIED' },
      failure: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
      completedAt: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    });
    const fail = vi.fn(async () => leasedRun);
    const repository = {
      claimDue: vi.fn(async () => [leasedRun]),
      complete: vi.fn(),
      fail,
    };
    await runCaptureCycle({
      repository,
      handlers: new Map([['TRANSACTION', vi.fn()]]),
      owner: 'worker-a',
      now: '2026-08-12T00:00:01.000Z',
    });
    expect(repository.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({ captureKinds: ['TRANSACTION'] }),
    );
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CAPTURE_HANDLER_UNREGISTERED',
        sourceRetryable: false,
      }),
    );
  });

  it('preserves typed handler retryability instead of swallowing execution failures', async () => {
    const repository = {
      claimDue: vi.fn(async () => []),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const error = new CaptureExecutionError('PROVIDER_DOWN', 'RPC unavailable.', true);
    expect(error).toMatchObject({ code: 'PROVIDER_DOWN', sourceRetryable: true });
    await expect(
      runCaptureCycle({
        repository,
        handlers: new Map(),
        owner: 'worker-a',
        signal: AbortSignal.abort(),
      }),
    ).resolves.toEqual([]);
    expect(repository.claimDue).not.toHaveBeenCalled();
  });

  it('renews a long-running handler lease when the repository supports heartbeats', async () => {
    vi.useFakeTimers();
    try {
      const leasedRun = CaptureRunSchema.parse({
        schemaVersion: 'capture-run-v1',
        id: 'cpr_0123456789abcdef01234567',
        scheduleId: 'cps_0123456789abcdef01234567',
        captureKind: 'TOKEN_HISTORY_BACKFILL',
        operation: 'READ_ONLY_CAPTURE',
        target: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          subjectType: 'TOKEN',
          normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
        },
        parameters: {},
        scheduledFor: '2026-08-12T00:00:00.000Z',
        status: 'LEASED',
        attempt: 1,
        maxAttempts: 2,
        availableAt: '2026-08-12T00:00:00.000Z',
        lease: {
          state: 'known',
          value: {
            owner: 'worker-a',
            token: '0123456789abcdef0123456789abcdef',
            expiresAt: '2026-08-12T00:05:00.000Z',
          },
        },
        result: { state: 'unknown', reason: 'NOT_QUERIED' },
        failure: { state: 'unknown', reason: 'NOT_APPLICABLE' },
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
        completedAt: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      });
      if (leasedRun.lease.state !== 'known') throw new Error('Expected heartbeat lease.');
      const result = {
        resultRef: 'token-history:heartbeat',
        snapshot: {
          ledger: 'EVM' as const,
          chainId: 'eip155:56',
          blockNumber: '50000000',
          blockHash: `0x${'ab'.repeat(32)}`,
          parentBlockHash: `0x${'cd'.repeat(32)}`,
          finality: 'finalized' as const,
          capturedAt: '2026-08-12T00:00:01.000Z',
          providerVersions: { rpc: '1' },
          adapterVersions: { capture: '1' },
          configHash: 'ef'.repeat(32),
          entityModelVersion: 'entity-v1',
          labelSnapshot: 'labels-v1',
        },
        terminalEvidenceId: 'ev_000000000000000000000002',
        evidenceIds: ['ev_000000000000000000000001', 'ev_000000000000000000000002'],
        sourceSet: ['bsc-rpc'],
        modelVersion: 'token-history-heartbeat-v1',
        coverage: 1,
        freshness: '2026-08-12T00:00:01.000Z',
        confidence: 1,
      };
      let release!: () => void;
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const renew = vi.fn(async () => leasedRun);
      const complete = vi.fn(async () => leasedRun);
      const repository = {
        claimDue: vi.fn(async () => [leasedRun]),
        renew,
        complete,
        fail: vi.fn(async () => leasedRun),
      };
      const cycle = runCaptureCycle({
        repository,
        handlers: new Map([
          [
            'TOKEN_HISTORY_BACKFILL',
            vi.fn(async () => {
              await blocked;
              return result;
            }),
          ],
        ]),
        owner: 'worker-a',
        leaseSeconds: 30,
      });

      await vi.runAllTicks();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(renew).toHaveBeenCalledWith({
        runId: leasedRun.id,
        leaseToken: leasedRun.lease.value.token,
        leaseSeconds: 30,
      });
      release();
      await cycle;
      expect(complete).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('skips missed intervals without drifting the original anchor', () => {
    const trigger = {
      type: 'INTERVAL' as const,
      anchorAt: '2026-08-12T00:00:00.000Z',
      everySeconds: 60,
      catchupPolicy: 'SKIP_MISSED' as const,
    };
    expect(nextCaptureOccurrence(trigger, '2026-08-12T00:05:12.000Z')).toBe(
      '2026-08-12T00:06:00.000Z',
    );
    expect(nextCaptureOccurrence(trigger, '2026-08-12T00:05:00.000Z', true)).toBe(
      '2026-08-12T00:05:00.000Z',
    );
    expect(nextCaptureOccurrence(trigger, '2026-08-12T00:05:00.000Z', false)).toBe(
      '2026-08-12T00:06:00.000Z',
    );
  });

  it('bounds deterministic exponential retry and occurrence identity', () => {
    expect(retryDelaySeconds(retryPolicy, 1)).toBe(10);
    expect(retryDelaySeconds(retryPolicy, 2)).toBe(20);
    expect(retryDelaySeconds(retryPolicy, 3)).toBe(25);
    expect(() => retryDelaySeconds(retryPolicy, 4)).toThrow(/retryable/);
    expect(captureRunIdFor('cps_0123456789abcdef01234567', '2026-08-12T00:00:00Z')).toBe(
      captureRunIdFor('cps_0123456789abcdef01234567', '2026-08-12T00:00:00.000Z'),
    );
  });

  it('requires successful captures to retain Snapshot, Evidence, coverage and confidence', () => {
    const common = {
      schemaVersion: 'capture-run-v1' as const,
      id: 'cpr_0123456789abcdef01234567',
      scheduleId: 'cps_0123456789abcdef01234567',
      captureKind: 'LABEL_INTELLIGENCE' as const,
      operation: 'READ_ONLY_CAPTURE' as const,
      target: {
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        subjectType: 'TOKEN' as const,
        normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      },
      parameters: {},
      scheduledFor: '2026-08-12T00:00:00.000Z',
      status: 'SUCCEEDED' as const,
      attempt: 1,
      maxAttempts: 4,
      availableAt: '2026-08-12T00:00:00.000Z',
      lease: { state: 'unknown' as const, reason: 'NOT_APPLICABLE' as const },
      failure: { state: 'unknown' as const, reason: 'NOT_APPLICABLE' as const },
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:02.000Z',
      completedAt: { state: 'known' as const, value: '2026-08-12T00:00:02.000Z' },
    };
    const result = {
      resultRef: 'lir_0123456789abcdef01234567',
      snapshot: {
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        blockNumber: '50000000',
        blockHash: `0x${'ab'.repeat(32)}`,
        finality: 'finalized' as const,
        capturedAt: '2026-08-12T00:00:01.000Z',
        providerVersions: { rpc: '1' },
        adapterVersions: { evm: '1' },
        configHash: 'cd'.repeat(32),
        entityModelVersion: 'entity-v1',
        labelSnapshot: 'labels-v1',
      },
      terminalEvidenceId: 'ev_000000000000000000000002',
      evidenceIds: ['ev_000000000000000000000001', 'ev_000000000000000000000002'],
      sourceSet: ['bsc-rpc'],
      modelVersion: 'label-intelligence-v0.1.0',
      coverage: 0.5,
      freshness: '2026-08-12T00:00:01.000Z',
      confidence: 0.8,
    };
    expect(
      CaptureRunSchema.parse({ ...common, result: { state: 'known', value: result } }),
    ).toBeTruthy();
    expect(() =>
      CaptureRunSchema.parse({
        ...common,
        result: { state: 'unknown', reason: 'NOT_QUERIED' },
      }),
    ).toThrow(/successful run/i);
  });
});
