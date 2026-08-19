import { describe, expect, it, vi } from 'vitest';

import type { ClaimActionsCaptureWorkerConfig } from './claim-action-capture-config.js';
import {
  runClaimActionsCaptureWorkerCycle,
  runClaimActionsCaptureWorkerLoop,
  type ClaimActionsCaptureWorkerResources,
} from './claim-action-capture-worker.js';

const config: ClaimActionsCaptureWorkerConfig = {
  postgresUrl: 'postgresql://worker@database.example/zerotrace',
  bscRpcUrls: ['https://bsc.example/'],
  sqdPortalUrl: 'https://portal.sqd.dev',
  providerAllowedHosts: ['bsc.example'],
  sqdAllowedHosts: ['portal.sqd.dev'],
  allowPrivateProviderUrls: false,
  requestTimeoutMs: 1_000,
  bscRequestsPerSecond: 0,
  sqdRequestsPerSecond: 0,
  maxAttempts: 1,
  retryBaseDelayMs: 0,
  retryMaxDelayMs: 0,
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
    ...(status === 'DOWN' ? { errorCode: 'CLAIM_TEST_STORAGE_DOWN' } : {}),
  }));
  return {
    schedules: { health, claimDue: vi.fn(async () => []) },
    reviews: { health },
    addressReports: { health },
    verifications: { health },
    evidence: { health },
    close: vi.fn(async () => undefined),
  } as unknown as ClaimActionsCaptureWorkerResources;
}

describe('Claim Actions capture worker', () => {
  it('runs an idle cycle after all durable stores pass health', async () => {
    const fixture = resources();
    await expect(runClaimActionsCaptureWorkerCycle(config, fixture)).resolves.toEqual({
      event: 'claim_actions_capture_cycle_complete',
      claimed: 0,
      succeeded: 0,
      retryWaiting: 0,
      failedTerminal: 0,
      runIds: [],
    });
    expect(fixture.schedules.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'test-worker', captureKinds: ['CLAIM_ACTIONS'] }),
    );
  });

  it('fails closed before constructing providers when a durable store is unavailable', async () => {
    const fixture = resources('DOWN');
    await expect(runClaimActionsCaptureWorkerCycle(config, fixture)).rejects.toMatchObject({
      code: 'CLAIM_TEST_STORAGE_DOWN',
      retryable: true,
    });
    expect(fixture.schedules.claimDue).not.toHaveBeenCalled();
  });

  it('supports abortable polling without emitting idle cycles', async () => {
    const fixture = resources();
    const controller = new AbortController();
    const emit = vi.fn();
    const sleep = vi.fn(async () => controller.abort());
    await expect(
      runClaimActionsCaptureWorkerLoop({ ...config, once: false }, fixture, {
        signal: controller.signal,
        emit,
        sleep,
      }),
    ).resolves.toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(250, controller.signal);
    expect(emit).not.toHaveBeenCalled();
  });
});
