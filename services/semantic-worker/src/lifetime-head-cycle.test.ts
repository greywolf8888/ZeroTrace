import { describe, expect, it, vi } from 'vitest';

import { hashPayload } from '@zerotrace/evidence';
import { AnchorReconciliationResultSchema, knownValue, unknownValue } from '@zerotrace/schemas';
import type { FlapLifetimeHead } from '@zerotrace/storage';
import {
  flapLifetimeExtensionResult,
  flapLifetimeFixtureToken,
  flapLifetimeInitialResult,
  flapLifetimeInitialScanId,
  flapLifetimeSnapshot,
} from '../../../packages/storage/src/test-fixtures/flap-lifetime.js';

import { runFlapLifetimeHeadCycle, type FlapLifetimeHeadStore } from './lifetime-head-cycle.js';

function reconciliation(block: number, status: 'AGREEMENT' | 'DISAGREEMENT' = 'AGREEMENT') {
  const base = flapLifetimeSnapshot(block);
  const snapshot = {
    ...base,
    providerVersions: { 'bsc-rpc-a@test.example': 'evm-v1', 'bsc-rpc-b@test.example': 'evm-v1' },
  };
  const anchor = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    position: String(block),
    hash: snapshot.blockHash,
    parentPosition: String(block - 1),
    parentHash: snapshot.parentBlockHash,
    finality: 'finalized' as const,
  };
  return AnchorReconciliationResultSchema.parse({
    ledger: 'EVM',
    chainId: 'eip155:56',
    status,
    requiredSources: 2,
    configuredSources: 2,
    observedSources: 2,
    comparisonPosition: knownValue(String(block)),
    canonicalAnchor:
      status === 'AGREEMENT'
        ? knownValue(anchor)
        : unknownValue('CONFLICTING_SOURCES', 'Fixture providers disagree.'),
    sourceIndependence: unknownValue('NOT_QUERIED'),
    snapshotSet: [snapshot, snapshot],
    sources: [],
    alerts: [],
    metadata: {
      snapshot: status === 'AGREEMENT' ? snapshot : null,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.capturedAt,
      sourceSet: ['bsc-rpc-a@test.example', 'bsc-rpc-b@test.example'],
      modelVersion: 'anchor-reconciliation-v1',
      confidence: 1,
      evidenceIds: [`ev_${'8'.repeat(24)}`],
    },
  });
}

function storedHead(
  result = flapLifetimeInitialResult(),
  overrides: Partial<FlapLifetimeHead> = {},
): FlapLifetimeHead {
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
    ...overrides,
  };
}

function headStore(initial?: FlapLifetimeHead) {
  let current = initial;
  const store: FlapLifetimeHeadStore = {
    latestHead: vi.fn(async () => current),
    putHead: vi.fn(async ({ scanId, result }) => {
      current = storedHead(result, {
        id: `flh_${hashPayload({ scanId }).slice(0, 24)}`,
        scanId,
        sequence: current === undefined ? 0 : current.sequence + 1,
        headType: current === undefined ? 'INITIAL' : 'EXTENSION',
        predecessorId: current?.id ?? null,
      });
      return current;
    }),
  };
  return store;
}

describe('Flap lifetime finalized-head cycle', () => {
  it('materializes the first agreed target and persists its accepted head', async () => {
    const initial = flapLifetimeInitialResult();
    const heads = headStore();
    const materialize = vi.fn().mockResolvedValue({
      scanId: flapLifetimeInitialScanId,
      result: initial,
    });
    const result = await runFlapLifetimeHeadCycle({
      token: flapLifetimeFixtureToken,
      reconciliation: reconciliation(103),
      heads,
      materialize,
      proveContinuity: vi.fn(),
      extend: vi.fn(),
    });
    expect(result).toMatchObject({ action: 'INITIALIZED', targetBlock: '103' });
    expect(materialize).toHaveBeenCalledOnce();
    expect(heads.putHead).toHaveBeenCalledWith({
      scanId: flapLifetimeInitialScanId,
      result: initial,
    });
  });

  it('extends only after a Known continuity proof and replays the new head', async () => {
    const initial = flapLifetimeInitialResult();
    const extension = flapLifetimeExtensionResult(initial);
    const heads = headStore(storedHead(initial));
    const proveContinuity = vi.fn().mockResolvedValue(extension.continuity);
    const extend = vi.fn().mockResolvedValue({
      scanId: '22222222-2222-4222-8222-222222222222',
      result: extension,
    });
    const result = await runFlapLifetimeHeadCycle({
      token: flapLifetimeFixtureToken,
      reconciliation: reconciliation(105),
      heads,
      materialize: vi.fn(),
      proveContinuity,
      extend,
    });
    expect(result).toMatchObject({ action: 'EXTENDED', targetBlock: '105' });
    expect(proveContinuity).toHaveBeenCalledOnce();
    expect(extend).toHaveBeenCalledOnce();
    expect(heads.putHead).toHaveBeenCalledOnce();
  });

  it('does no child work when the accepted finalized head is unchanged', async () => {
    const initial = flapLifetimeInitialResult();
    const materialize = vi.fn();
    const proveContinuity = vi.fn();
    const extend = vi.fn();
    const result = await runFlapLifetimeHeadCycle({
      token: flapLifetimeFixtureToken,
      reconciliation: reconciliation(103),
      heads: headStore(storedHead(initial)),
      materialize,
      proveContinuity,
      extend,
    });
    expect(result.action).toBe('UNCHANGED');
    expect(materialize).not.toHaveBeenCalled();
    expect(proveContinuity).not.toHaveBeenCalled();
    expect(extend).not.toHaveBeenCalled();
  });

  it('fails closed on disagreement, regression, and conflicting finalized hashes', async () => {
    const initial = flapLifetimeInitialResult();
    const options = {
      token: flapLifetimeFixtureToken,
      heads: headStore(storedHead(initial)),
      materialize: vi.fn(),
      proveContinuity: vi.fn(),
      extend: vi.fn(),
    };
    await expect(
      runFlapLifetimeHeadCycle({ ...options, reconciliation: reconciliation(105, 'DISAGREEMENT') }),
    ).rejects.toMatchObject({ code: 'LIFETIME_RECONCILIATION_REQUIRED' });
    await expect(
      runFlapLifetimeHeadCycle({ ...options, reconciliation: reconciliation(102) }),
    ).rejects.toMatchObject({ code: 'LIFETIME_HEAD_REGRESSION' });
    const changed = reconciliation(103);
    if (changed.canonicalAnchor.state !== 'known' || changed.metadata.snapshot?.ledger !== 'EVM') {
      throw new Error('Fixture reconciliation vanished.');
    }
    changed.canonicalAnchor.value.hash = `0x${'9'.repeat(64)}`;
    changed.metadata.snapshot.blockHash = changed.canonicalAnchor.value.hash;
    await expect(
      runFlapLifetimeHeadCycle({ ...options, reconciliation: changed }),
    ).rejects.toMatchObject({ code: 'LIFETIME_FINALIZED_REORG' });
    expect(options.materialize).not.toHaveBeenCalled();
    expect(options.proveContinuity).not.toHaveBeenCalled();
    expect(options.extend).not.toHaveBeenCalled();
  });
});
