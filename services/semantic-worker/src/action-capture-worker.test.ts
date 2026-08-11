import { describe, expect, it, vi } from 'vitest';

import type { ActionCaptureWorkerConfig } from './action-capture-config.js';
import {
  runActionCaptureWorkerCycle,
  runActionCaptureWorkerLoop,
  type ActionCaptureWorkerResources,
} from './action-capture-worker.js';

const config: ActionCaptureWorkerConfig = {
  postgresUrl: 'postgresql://unused',
  clickhouseUrl: 'http://unused',
  owner: 'test-worker',
  pollIntervalMs: 250,
  leaseSeconds: 300,
  batchSize: 10,
  requestTimeoutMs: 30_000,
  once: true,
};

function resources(status: 'UP' | 'DOWN' = 'UP'): ActionCaptureWorkerResources {
  const health = vi.fn(async () => ({
    status,
    durable: true,
    checkedAt: new Date().toISOString(),
  }));
  return {
    schedules: {
      health,
      claimDue: vi.fn(async () => []),
    } as never,
    facts: { health } as never,
    ingestion: { health } as never,
    evidence: { health } as never,
    reports: { health } as never,
    close: vi.fn(async () => undefined),
  };
}

describe('Action Semantics capture worker', () => {
  it('runs one bounded idle cycle after every durable backend passes health', async () => {
    const fixture = resources();
    await expect(runActionCaptureWorkerLoop(config, fixture)).resolves.toEqual([
      {
        event: 'action_capture_cycle_complete',
        claimed: 0,
        succeeded: 0,
        retryWaiting: 0,
        failedTerminal: 0,
        runIds: [],
      },
    ]);
    expect(fixture.schedules.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'test-worker', leaseSeconds: 300, limit: 10 }),
    );
  });

  it('does not claim work when a durable backend is down', async () => {
    const fixture = resources('DOWN');
    await expect(runActionCaptureWorkerCycle(config, fixture)).rejects.toMatchObject({
      code: 'ACTION_CAPTURE_STORAGE_UNAVAILABLE',
      retryable: true,
    });
    expect(fixture.schedules.claimDue).not.toHaveBeenCalled();
  });

  it('polls abortably without emitting idle-cycle log noise', async () => {
    const fixture = resources();
    const controller = new AbortController();
    const emit = vi.fn();
    const sleep = vi.fn(async () => controller.abort());
    await expect(
      runActionCaptureWorkerLoop({ ...config, once: false }, fixture, {
        signal: controller.signal,
        emit,
        sleep,
      }),
    ).resolves.toHaveLength(1);
    expect(sleep).toHaveBeenCalledWith(250, controller.signal);
    expect(emit).not.toHaveBeenCalled();
  });
});
