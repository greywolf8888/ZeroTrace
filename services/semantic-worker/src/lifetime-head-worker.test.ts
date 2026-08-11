import { describe, expect, it, vi } from 'vitest';

import { hashPayload } from '@zerotrace/evidence';
import type { FlapLifetimeHead, FlapLifetimeHeadInvalidation } from '@zerotrace/storage';
import {
  flapLifetimeInitialResult,
  flapLifetimeInitialScanId,
} from '../../../packages/storage/src/test-fixtures/flap-lifetime.js';

import type { FlapLifetimeHeadWorkerConfig } from './lifetime-head-config.js';
import {
  runFlapLifetimeHeadLoop,
  type FlapLifetimeHeadRuntime,
  type FlapLifetimeHeadWorkerResources,
} from './lifetime-head-worker.js';

const config = {
  token: `0x${'a'.repeat(40)}`,
  intervalMs: 1000,
  maxCycles: 2,
} as FlapLifetimeHeadWorkerConfig;

function storedHead(): FlapLifetimeHead {
  const result = flapLifetimeInitialResult();
  const snapshot = result.metadata.snapshot;
  if (snapshot?.ledger !== 'EVM') throw new Error('Fixture requires an EVM Snapshot.');
  return {
    id: `flh_${'1'.repeat(24)}`,
    chainId: 'eip155:56',
    token: result.token,
    sequence: 0,
    scanId: flapLifetimeInitialScanId,
    headType: 'INITIAL',
    predecessorId: null,
    targetBlock: Number(result.targetBlock),
    targetHash: snapshot.blockHash,
    resultHash: hashPayload(result),
    result,
    snapshotHash: hashPayload(snapshot),
    terminalEvidenceId: result.terminalEvidenceId,
    createdAt: '2026-08-10T00:02:00.000Z',
  };
}

function resources(down?: string): FlapLifetimeHeadWorkerResources {
  const component = (code: string) => ({
    health: vi
      .fn()
      .mockResolvedValue(
        down === code
          ? { status: 'DOWN', errorCode: `${code.toUpperCase()}_DOWN` }
          : { status: 'UP' },
      ),
    close: vi.fn(),
  });
  return {
    evidence: component('evidence'),
    checkpoints: component('checkpoints'),
    projection: component('projection'),
    dataQuality: component('data_quality'),
    heads: component('heads'),
    close: vi.fn(),
  } as unknown as FlapLifetimeHeadWorkerResources;
}

function runtime(runCycle: FlapLifetimeHeadRuntime['runCycle']): FlapLifetimeHeadRuntime {
  return {
    inspect: vi.fn().mockResolvedValue([{ ledger: 'EVM', chainId: 'eip155:56' }]),
    runCycle,
  };
}

describe('continuous Flap lifetime head worker', () => {
  it('runs sequential cycles and emits credential-free accepted-head summaries', async () => {
    const head = storedHead();
    const runCycle = vi.fn().mockResolvedValue({
      action: 'UNCHANGED',
      targetBlock: String(head.targetBlock),
      targetHash: head.targetHash,
      head,
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const emit = vi.fn();
    const events = await runFlapLifetimeHeadLoop(config, resources(), runtime(runCycle), {
      sleep,
      emit,
    });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: 'flap_lifetime_head_cycle_complete',
      cycle: 1,
      action: 'UNCHANGED',
      scanId: head.scanId,
      terminalEvidenceId: head.terminalEvidenceId,
    });
    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(events)).not.toMatch(/postgres|password|secret/i);
  });

  it('defers retryable storage/provider failures and resumes the next cycle', async () => {
    const head = storedHead();
    const runCycle = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('provider URL with secret'), {
          code: 'LIFETIME_CONTINUITY_UNAVAILABLE',
          retryable: true,
        }),
      )
      .mockResolvedValueOnce({
        action: 'UNCHANGED',
        targetBlock: String(head.targetBlock),
        targetHash: head.targetHash,
        head,
      });
    const events = await runFlapLifetimeHeadLoop(config, resources(), runtime(runCycle), {
      sleep: vi.fn().mockResolvedValue(undefined),
    });
    expect(events.map((event) => event.event)).toEqual([
      'flap_lifetime_head_cycle_deferred',
      'flap_lifetime_head_cycle_complete',
    ]);
    expect(events[0]).toMatchObject({
      code: 'LIFETIME_CONTINUITY_UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.stringify(events)).not.toContain('provider URL with secret');
  });

  it('emits an append-only rollback and immediately re-enters the next replay cycle', async () => {
    const head = storedHead();
    const invalidation = {
      id: `fli_${'2'.repeat(24)}`,
      token: head.token,
      invalidatedFromHeadId: head.id,
      invalidatedThroughHeadId: head.id,
      rollbackToHeadId: null,
      alertId: `dqa_${'3'.repeat(24)}`,
      terminalEvidenceId: `ev_${'4'.repeat(24)}`,
      result: { metadata: { modelVersion: 'flap-lifetime-rollback-v1' } },
    } as FlapLifetimeHeadInvalidation;
    const runCycle = vi
      .fn()
      .mockResolvedValueOnce({
        action: 'ROLLED_BACK',
        targetBlock: '107',
        targetHash: `0x${'7'.repeat(64)}`,
        head: undefined,
        invalidation,
      })
      .mockResolvedValueOnce({
        action: 'UNCHANGED',
        targetBlock: String(head.targetBlock),
        targetHash: head.targetHash,
        head,
      });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const events = await runFlapLifetimeHeadLoop(config, resources(), runtime(runCycle), { sleep });
    expect(events[0]).toMatchObject({
      event: 'flap_lifetime_head_rollback_complete',
      invalidationId: invalidation.id,
      rollbackToHeadId: null,
      terminalEvidenceId: invalidation.terminalEvidenceId,
    });
    expect(events[1]).toMatchObject({ event: 'flap_lifetime_head_cycle_complete' });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not inspect providers when durable head storage is down', async () => {
    const workerRuntime = runtime(vi.fn());
    const events = await runFlapLifetimeHeadLoop(
      { ...config, maxCycles: 1 },
      resources('heads'),
      workerRuntime,
    );
    expect(events).toEqual([
      {
        event: 'flap_lifetime_head_cycle_deferred',
        cycle: 1,
        token: config.token,
        code: 'HEADS_DOWN',
        retryable: true,
      },
    ]);
    expect(workerRuntime.inspect).not.toHaveBeenCalled();
  });

  it('surfaces an unresolved non-retryable finalized conflict instead of looping', async () => {
    const workerRuntime = runtime(
      vi.fn().mockRejectedValue(
        Object.assign(new Error('finalized conflict'), {
          code: 'LIFETIME_FINALIZED_REORG',
          retryable: false,
        }),
      ),
    );
    await expect(
      runFlapLifetimeHeadLoop(config, resources(), workerRuntime, {
        sleep: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toMatchObject({ code: 'LIFETIME_FINALIZED_REORG' });
    expect(workerRuntime.runCycle).toHaveBeenCalledOnce();
  });
});
