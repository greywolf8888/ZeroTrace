import { describe, expect, it, vi } from 'vitest';

import type { CaptureRun } from '@zerotrace/schemas';

import type { TokenHistoryBackfillWorkerConfig } from './token-history-backfill-config.js';
import {
  createTokenHistoryBackfillWorkerResources,
  runTokenHistoryBackfillWorkerCycle,
  runTokenHistoryBackfillWorkerLoop,
  type TokenHistoryBackfillWorkerResources,
} from './token-history-backfill-worker.js';

const config: TokenHistoryBackfillWorkerConfig = {
  postgresUrl: 'postgresql://worker@database.example/zerotrace',
  clickhouseUrl: 'http://clickhouse.example:8123',
  objectStoreEndpoint: 'http://objects.example:9000',
  objectStoreAccessKey: 'access',
  objectStoreSecretKey: 'secret',
  objectStoreBucket: 'zerotrace-raw',
  ethereumRpcUrls: [],
  bscRpcUrls: ['https://bsc.example/'],
  sqdPortalUrl: 'https://portal.sqd.dev',
  providerAllowedHosts: ['bsc.example'],
  sqdAllowedHosts: ['portal.sqd.dev'],
  allowPrivateProviderUrls: false,
  requestTimeoutMs: 1_000,
  ethereumRequestsPerSecond: 0,
  bscRequestsPerSecond: 0,
  sqdRequestsPerSecond: 0,
  maxAttempts: 1,
  retryBaseDelayMs: 0,
  retryMaxDelayMs: 0,
  maxFactRows: 10,
  checkpointBatchSize: 50,
  owner: 'test-worker',
  pollIntervalMs: 250,
  leaseSeconds: 30,
  batchSize: 1,
  once: true,
};

function resources(status: 'UP' | 'DOWN' = 'UP') {
  const health = vi.fn(async () => ({
    status,
    durable: true,
    checkedAt: '2026-08-14T00:00:00.000Z',
    ...(status === 'DOWN' ? { errorCode: 'TEST_STORAGE_DOWN' } : {}),
  }));
  return {
    schedules: {
      health,
      claimDue: vi.fn(async () => []),
      fail: vi.fn(async () => undefined),
    },
    facts: { health },
    checkpoints: { health },
    artifacts: { health },
    evidence: { health },
    actionSemantics: { health },
    reports: { health },
    funding: { health },
    campaigns: { health },
    alerts: { health },
    close: vi.fn(async () => undefined),
  } as unknown as TokenHistoryBackfillWorkerResources;
}

function invalidRun(): CaptureRun {
  return {
    id: 'cpr_0123456789abcdef01234567',
    captureKind: 'TOKEN_HISTORY_BACKFILL',
    parameters: { schemaVersion: 'invalid' },
    lease: {
      state: 'known',
      value: {
        owner: 'test-worker',
        token: '0123456789abcdef0123456789abcdef',
        expiresAt: '2026-08-14T00:05:00.000Z',
      },
    },
  } as unknown as CaptureRun;
}

describe('Token History backfill worker', () => {
  it('runs an idle cycle only after every durable backend is healthy', async () => {
    const fixture = resources();
    await expect(runTokenHistoryBackfillWorkerCycle(config, fixture)).resolves.toEqual({
      event: 'token_history_backfill_capture_cycle_complete',
      claimed: 0,
      succeeded: 0,
      retryWaiting: 0,
      failedTerminal: 0,
      runIds: [],
    });
    expect(fixture.schedules.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: 'test-worker',
        captureKinds: ['TOKEN_HISTORY_BACKFILL', 'TOKEN_LIVE_CAPTURE'],
        leaseSeconds: 30,
        limit: 1,
      }),
    );
  });

  it('fails preflight with the backend error instead of claiming work', async () => {
    const fixture = resources('DOWN');
    await expect(runTokenHistoryBackfillWorkerCycle(config, fixture)).rejects.toMatchObject({
      code: 'TEST_STORAGE_DOWN',
      retryable: true,
    });
    expect(fixture.schedules.claimDue).not.toHaveBeenCalled();
  });

  it('records a terminal handler failure and emits only claimed cycles', async () => {
    const fixture = resources();
    const run = invalidRun();
    const failedRun = { ...run, status: 'FAILED_TERMINAL' } as CaptureRun;
    const fail = vi.fn(async () => failedRun);
    (fixture.schedules as unknown as { claimDue: ReturnType<typeof vi.fn> }).claimDue = vi.fn(
      async () => [run],
    );
    (fixture.schedules as unknown as { fail: ReturnType<typeof vi.fn> }).fail = fail;

    await expect(runTokenHistoryBackfillWorkerCycle(config, fixture)).resolves.toMatchObject({
      claimed: 1,
      failedTerminal: 1,
      runIds: [run.id],
    });
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: run.id,
        code: 'TOKEN_HISTORY_BACKFILL_INVALID_PARAMETERS',
        sourceRetryable: false,
      }),
    );
  });

  it('stops an abortable polling loop after one injected sleep', async () => {
    const fixture = resources();
    const controller = new AbortController();
    const emit = vi.fn();
    const sleep = vi.fn(async () => controller.abort());

    await expect(
      runTokenHistoryBackfillWorkerLoop({ ...config, once: false }, fixture, {
        signal: controller.signal,
        emit,
        sleep,
      }),
    ).resolves.toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(250, controller.signal);
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits a non-idle cycle and exits immediately when already aborted', async () => {
    const fixture = resources();
    const run = invalidRun();
    const failedRun = { ...run, status: 'FAILED_TERMINAL' } as CaptureRun;
    (fixture.schedules as unknown as { claimDue: ReturnType<typeof vi.fn> }).claimDue = vi.fn(
      async () => [run],
    );
    (fixture.schedules as unknown as { fail: ReturnType<typeof vi.fn> }).fail = vi
      .fn()
      .mockResolvedValue(failedRun);
    const controller = new AbortController();
    const emit = vi.fn();
    const sleep = vi.fn(async () => controller.abort());

    await expect(
      runTokenHistoryBackfillWorkerLoop({ ...config, once: false }, fixture, {
        emit,
        sleep,
        signal: controller.signal,
      }),
    ).resolves.toHaveLength(1);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ claimed: 1, failedTerminal: 1 }));
    expect(sleep).toHaveBeenCalledWith(250, controller.signal);

    controller.abort();
    await expect(
      runTokenHistoryBackfillWorkerLoop(config, fixture, { signal: controller.signal }),
    ).resolves.toEqual([]);
  });

  it('constructs and closes all production storage resources without contacting providers', async () => {
    const created = createTokenHistoryBackfillWorkerResources(config);
    await expect(created.close()).resolves.toBeUndefined();
  });
});
