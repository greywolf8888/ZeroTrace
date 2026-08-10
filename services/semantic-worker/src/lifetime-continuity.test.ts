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
import type { FlapLifetimeHead } from '@zerotrace/storage';
import {
  flapLifetimeInitialResult,
  flapLifetimeInitialScanId,
  flapLifetimeSnapshot,
} from '../../../packages/storage/src/test-fixtures/flap-lifetime.js';

import { reconciledFlapTarget } from './lifetime-head-cycle.js';
import { proveFlapLifetimeContinuity } from './lifetime-continuity.js';

function head(): FlapLifetimeHead {
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
    targetBlock: 103,
    targetHash: snapshot.blockHash,
    resultHash: hashPayload(result),
    result,
    snapshotHash: hashPayload(snapshot),
    terminalEvidenceId: result.terminalEvidenceId,
    createdAt: '2026-08-10T00:02:00.000Z',
  };
}

function sourceAnchor(source: string, block: number, role: 'HEAD' | 'COMPARISON') {
  const snapshot = flapLifetimeSnapshot(block);
  return {
    id: `anchor_${hashPayload({ source, block, role }).slice(0, 24)}`,
    role,
    evidenceId: `ev_${hashPayload({ source, block, role }).slice(0, 24)}`,
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

function reconciliation(block: number) {
  const sourceIds = ['bsc-rpc-a@test.example', 'bsc-rpc-b@test.example'];
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
      const anchor = sourceAnchor(source, block, 'COMPARISON');
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
      evidenceIds: sourceIds.map((source) => sourceAnchor(source, block, 'COMPARISON').evidenceId),
    },
  });
}

function reader(sourceId: string, hash = flapLifetimeSnapshot(103).blockHash): ChainAnchorReader {
  return {
    sourceId,
    ledger: 'EVM',
    chainId: 'eip155:56',
    readHead: vi.fn(),
    readAt: vi.fn(async (position) => {
      const base = flapLifetimeSnapshot(Number(position));
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
  return { evidence, repository, anchors, alerts, writes };
}

describe('Evidence-backed Flap lifetime continuity', () => {
  it('proves a direct finalized extension without historical reads', async () => {
    const state = stores();
    const readers = [reader('bsc-rpc-a@test.example'), reader('bsc-rpc-b@test.example')];
    const agreed = reconciliation(104);
    const proof = await proveFlapLifetimeContinuity({
      predecessor: head(),
      target: reconciledFlapTarget(agreed),
      reconciliation: agreed,
      readers,
      evidence: state.evidence,
      repository: state.repository,
    });
    expect(proof).toMatchObject({
      status: 'DIRECT_EXTENSION',
      continuous: { state: 'known', value: true },
    });
    expect(readers.every((item) => vi.mocked(item.readAt).mock.calls.length === 0)).toBe(true);
    expect(state.writes).toHaveLength(1);
    expect(state.anchors).toHaveLength(0);
  });

  it('proves a multi-block historical match with persisted per-source checks', async () => {
    const state = stores();
    const readers = [reader('bsc-rpc-a@test.example'), reader('bsc-rpc-b@test.example')];
    const agreed = reconciliation(105);
    const proof = await proveFlapLifetimeContinuity({
      predecessor: head(),
      target: reconciledFlapTarget(agreed),
      reconciliation: agreed,
      readers,
      evidence: state.evidence,
      repository: state.repository,
    });
    expect(proof).toMatchObject({
      status: 'HISTORICAL_MATCH',
      continuous: { state: 'known', value: true },
    });
    expect(readers.every((item) => vi.mocked(item.readAt).mock.calls[0]?.[0] === '103')).toBe(true);
    expect(state.anchors).toHaveLength(2);
    expect(state.writes).toHaveLength(3);
    expect(proof.evidenceIds).toContain(proof.terminalEvidenceId);
  });

  it('raises a critical alert and refuses a conflicting finalized predecessor', async () => {
    const state = stores();
    const agreed = reconciliation(105);
    await expect(
      proveFlapLifetimeContinuity({
        predecessor: head(),
        target: reconciledFlapTarget(agreed),
        reconciliation: agreed,
        readers: [
          reader('bsc-rpc-a@test.example'),
          reader('bsc-rpc-b@test.example', `0x${'9'.repeat(64)}`),
        ],
        evidence: state.evidence,
        repository: state.repository,
        nowImplementation: () => new Date('2026-08-10T00:02:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'LIFETIME_FINALIZED_REORG', retryable: false });
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]).toMatchObject({ kind: 'REORG_DETECTED', severity: 'CRITICAL' });
  });
});
