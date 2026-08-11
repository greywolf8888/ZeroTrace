import { describe, expect, it, vi } from 'vitest';

import type {
  ChainAnchorReader,
  DataQualityEvidenceWriter,
  DataQualityRepository,
} from '@zerotrace/data-quality';
import { hashPayload, type EvidenceNode } from '@zerotrace/evidence';
import {
  AnchorReconciliationResultSchema,
  ChainAnchorReadSchema,
  knownValue,
  unknownValue,
  type AnalysisSnapshot,
  type DataQualityAlert,
  type Evidence,
  type PersistedChainAnchorObservation,
} from '@zerotrace/schemas';
import type {
  FlapLifetimeHead,
  FlapLifetimeHeadInvalidation,
  PutFlapLifetimeHeadInvalidationInput,
} from '@zerotrace/storage';
import {
  flapLifetimeExtensionResult,
  flapLifetimeExtensionScanId,
  flapLifetimeInitialResult,
  flapLifetimeInitialScanId,
  flapLifetimeSnapshot,
} from '../../../packages/storage/src/test-fixtures/flap-lifetime.js';

import { reconciledFlapTarget } from './lifetime-head-cycle.js';
import {
  resolveFlapLifetimeRollback,
  type FlapLifetimeRollbackStore,
} from './lifetime-rollback.js';

const sourceIds = ['bsc-rpc-a@test.example', 'bsc-rpc-b@test.example'];

function storedHead(
  result:
    ReturnType<typeof flapLifetimeInitialResult> | ReturnType<typeof flapLifetimeExtensionResult>,
  options: {
    id: string;
    sequence: number;
    scanId: string;
    predecessorId: string | null;
  },
): FlapLifetimeHead {
  const snapshot = result.metadata.snapshot;
  if (snapshot?.ledger !== 'EVM') throw new Error('Fixture requires an EVM Snapshot.');
  return {
    id: options.id,
    chainId: 'eip155:56',
    token: result.token,
    sequence: options.sequence,
    scanId: options.scanId,
    headType: options.predecessorId === null ? 'INITIAL' : 'EXTENSION',
    predecessorId: options.predecessorId,
    targetBlock: Number(result.targetBlock),
    targetHash: snapshot.blockHash,
    resultHash: hashPayload(result),
    result,
    snapshotHash: hashPayload(snapshot),
    terminalEvidenceId: result.terminalEvidenceId,
    createdAt: snapshot.capturedAt,
  };
}

function lineage() {
  const initialResult = flapLifetimeInitialResult();
  const first = storedHead(initialResult, {
    id: `flh_${'1'.repeat(24)}`,
    sequence: 0,
    scanId: flapLifetimeInitialScanId,
    predecessorId: null,
  });
  const current = storedHead(flapLifetimeExtensionResult(initialResult), {
    id: `flh_${'2'.repeat(24)}`,
    sequence: 1,
    scanId: flapLifetimeExtensionScanId,
    predecessorId: first.id,
  });
  return [current, first] as const;
}

function sourceAnchor(source: string, block: number) {
  const snapshot = flapLifetimeSnapshot(block);
  return {
    id: `anchor_${hashPayload({ source, block }).slice(0, 24)}`,
    role: 'COMPARISON' as const,
    evidenceId: `ev_${hashPayload({ source, block }).slice(0, 24)}`,
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    position: String(block),
    hash: snapshot.blockHash,
    parentPosition: String(block - 1),
    parentHash: snapshot.parentBlockHash,
    finality: 'finalized' as const,
    source,
    observedAt: snapshot.capturedAt,
  };
}

function reconciliation(block = 107) {
  const base = flapLifetimeSnapshot(block);
  const snapshot = {
    ...base,
    providerVersions: Object.fromEntries(sourceIds.map((source) => [source, 'evm-v1'])),
  };
  return AnchorReconciliationResultSchema.parse({
    ledger: 'EVM',
    chainId: 'eip155:56',
    status: 'AGREEMENT',
    requiredSources: 2,
    configuredSources: 2,
    observedSources: 2,
    comparisonPosition: knownValue(String(block)),
    canonicalAnchor: knownValue({
      ledger: 'EVM',
      chainId: 'eip155:56',
      position: String(block),
      hash: snapshot.blockHash,
      parentPosition: String(block - 1),
      parentHash: snapshot.parentBlockHash,
      finality: 'finalized',
    }),
    sourceIndependence: unknownValue('NOT_QUERIED'),
    snapshotSet: [snapshot, snapshot],
    sources: sourceIds.map((source) => {
      const anchor = sourceAnchor(source, block);
      return { source, head: knownValue(anchor), comparison: knownValue(anchor) };
    }),
    alerts: [],
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.capturedAt,
      sourceSet: sourceIds,
      modelVersion: 'anchor-reconciliation-v1',
      confidence: 1,
      evidenceIds: sourceIds.map((source) => sourceAnchor(source, block).evidenceId),
    },
  });
}

function reader(
  sourceId: string,
  hashes: Readonly<Record<string, string>>,
  failAt?: string,
): ChainAnchorReader {
  return {
    sourceId,
    ledger: 'EVM',
    chainId: 'eip155:56',
    readHead: vi.fn(),
    readAt: vi.fn(async (position) => {
      if (position === failAt) throw new Error('fixture provider unavailable');
      const base = flapLifetimeSnapshot(Number(position));
      const hash = hashes[position] ?? base.blockHash;
      const snapshot = { ...base, blockHash: hash, providerVersions: { [sourceId]: 'evm-v1' } };
      return ChainAnchorReadSchema.parse({
        anchor: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          position,
          hash,
          parentPosition: String(Number(position) - 1),
          parentHash: base.parentBlockHash,
          finality: 'finalized',
          source: sourceId,
          observedAt: base.capturedAt,
        },
        snapshot,
        payload: { position, hash },
      });
    }),
  };
}

function stores() {
  const anchors: PersistedChainAnchorObservation[] = [];
  const alerts: DataQualityAlert[] = [];
  const writes: EvidenceNode[] = [];
  const invalidations: FlapLifetimeHeadInvalidation[] = [];
  const evidence: DataQualityEvidenceWriter = {
    put: vi.fn(async (item: Evidence, sourceEvidenceIds = [], snapshot?: AnalysisSnapshot) => {
      const node: EvidenceNode = {
        evidence: item,
        sourceEvidenceIds: [...sourceEvidenceIds],
        ...(snapshot === undefined ? {} : { snapshot }),
      };
      writes.push(node);
      return node;
    }),
  };
  const repository: DataQualityRepository = {
    durable: true,
    putAnchor: vi.fn(async (item) => {
      anchors.push(item);
      return item;
    }),
    latestHead: vi.fn(),
    putAlert: vi.fn(async (item) => {
      alerts.push(item);
      return item;
    }),
  };
  const heads: FlapLifetimeRollbackStore = {
    putInvalidation: vi.fn(async (input: PutFlapLifetimeHeadInvalidationInput) => {
      const result = input.result;
      const snapshot = result.metadata.snapshot;
      if (snapshot?.ledger !== 'EVM') throw new Error('Fixture rollback Snapshot vanished.');
      const resultHash = hashPayload(result);
      const invalidation: FlapLifetimeHeadInvalidation = {
        id: `fli_${resultHash.slice(0, 24)}`,
        chainId: 'eip155:56',
        token: result.token,
        eventSequence: invalidations.length,
        invalidatedFromHeadId: result.invalidatedHeads[0]?.headId ?? '',
        invalidatedThroughHeadId:
          result.invalidatedHeads[result.invalidatedHeads.length - 1]?.headId ?? '',
        rollbackToHeadId: result.rollbackTo?.headId ?? null,
        alertId: result.alertId,
        terminalEvidenceId: result.terminalEvidenceId,
        resultHash,
        result,
        snapshotHash: hashPayload(snapshot),
        createdAt: snapshot.capturedAt,
      };
      invalidations.push(invalidation);
      return invalidation;
    }),
  };
  return { evidence, repository, heads, anchors, alerts, writes, invalidations };
}

describe('Flap lifetime automatic rollback resolver', () => {
  it('invalidates only the divergent suffix and retains the newest verified ancestor', async () => {
    const state = stores();
    const activeLineage = lineage();
    const agreed = reconciliation();
    const replacementHash = `0x${'9'.repeat(64)}`;
    const readers = sourceIds.map((source) =>
      reader(source, { '105': replacementHash, '103': activeLineage[1].targetHash }),
    );
    const invalidation = await resolveFlapLifetimeRollback({
      token: activeLineage[0].token,
      target: reconciledFlapTarget(agreed),
      reconciliation: agreed,
      activeLineage,
      readers,
      evidence: state.evidence,
      repository: state.repository,
      heads: state.heads,
      nowImplementation: () => new Date('2026-08-10T00:03:00.000Z'),
    });
    expect(invalidation.result.invalidatedHeads.map((head) => head.headId)).toEqual([
      activeLineage[0].id,
    ]);
    expect(invalidation.result.rollbackTo?.headId).toBe(activeLineage[1].id);
    expect(invalidation.result.lineageCoverage).toBe(1);
    expect(readers.every((item) => vi.mocked(item.readAt).mock.calls.length === 2)).toBe(true);
    expect(state.anchors).toHaveLength(4);
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]).toMatchObject({ kind: 'REORG_DETECTED', severity: 'CRITICAL' });
    expect(state.writes.at(-1)?.evidence.id).toBe(invalidation.terminalEvidenceId);
  });

  it('invalidates the complete lineage only when every checked source agrees no ancestor survives', async () => {
    const state = stores();
    const activeLineage = lineage();
    const agreed = reconciliation();
    const readers = sourceIds.map((source) =>
      reader(source, { '105': `0x${'9'.repeat(64)}`, '103': `0x${'8'.repeat(64)}` }),
    );
    const invalidation = await resolveFlapLifetimeRollback({
      token: activeLineage[0].token,
      target: reconciledFlapTarget(agreed),
      reconciliation: agreed,
      activeLineage,
      readers,
      evidence: state.evidence,
      repository: state.repository,
      heads: state.heads,
    });
    expect(invalidation.result.invalidatedHeads.map((head) => head.headId)).toEqual([
      activeLineage[1].id,
      activeLineage[0].id,
    ]);
    expect(invalidation.result.rollbackTo).toBeNull();
  });

  it('records historical disagreement and refuses to choose a rollback ancestor', async () => {
    const state = stores();
    const activeLineage = lineage();
    const agreed = reconciliation();
    await expect(
      resolveFlapLifetimeRollback({
        token: activeLineage[0].token,
        target: reconciledFlapTarget(agreed),
        reconciliation: agreed,
        activeLineage,
        readers: [
          reader(sourceIds[0] as string, { '105': `0x${'9'.repeat(64)}` }),
          reader(sourceIds[1] as string, { '105': `0x${'8'.repeat(64)}` }),
        ],
        evidence: state.evidence,
        repository: state.repository,
        heads: state.heads,
      }),
    ).rejects.toMatchObject({
      code: 'LIFETIME_ROLLBACK_SOURCE_DISAGREEMENT',
      retryable: true,
    });
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]).toMatchObject({
      kind: 'CROSS_SOURCE_DISAGREEMENT',
      severity: 'CRITICAL',
    });
    expect(state.invalidations).toHaveLength(0);
  });

  it('defers without invalidation when any agreed source is unavailable', async () => {
    const state = stores();
    const activeLineage = lineage();
    const agreed = reconciliation();
    await expect(
      resolveFlapLifetimeRollback({
        token: activeLineage[0].token,
        target: reconciledFlapTarget(agreed),
        reconciliation: agreed,
        activeLineage,
        readers: [
          reader(sourceIds[0] as string, { '105': `0x${'9'.repeat(64)}` }),
          reader(sourceIds[1] as string, { '105': `0x${'9'.repeat(64)}` }, '105'),
        ],
        evidence: state.evidence,
        repository: state.repository,
        heads: state.heads,
      }),
    ).rejects.toMatchObject({ code: 'LIFETIME_ROLLBACK_SOURCE_UNAVAILABLE', retryable: true });
    expect(state.invalidations).toHaveLength(0);
  });
});
