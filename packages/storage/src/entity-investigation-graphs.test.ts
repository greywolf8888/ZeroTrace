import { describe, expect, it, vi } from 'vitest';

import {
  buildEntityInvestigationGraph,
  buildEntityRelationshipTimeline,
} from '@zerotrace/entity-engine';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  EntityInvestigationGraphReportSchema,
  knownValue,
  unknownValue,
  type EntityRelationshipTimelineObservation,
} from '@zerotrace/schemas';

import {
  PostgresEntityInvestigationGraphRepository,
  type StoredEntityInvestigationGraph,
} from './entity-investigation-graphs.js';

describe('PostgreSQL Entity investigation graph repository', () => {
  it('rejects invalid reports and identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresEntityInvestigationGraphRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.put({} as EntityInvestigationGraphReport)).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_INVALID',
    });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_INVALID',
    });
    await expect(
      repository.latest({ ledger: 'EVM', chainId: '', subjectId: 'subject' }),
    ).rejects.toMatchObject({ code: 'ENTITY_INVESTIGATION_GRAPH_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks both the immutable graph table and migration marker', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ table_name: 'entity_investigation_graph_reports', migration_applied: true }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresEntityInvestigationGraphRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'ENTITY_INVESTIGATION_GRAPH_NOT_INITIALIZED',
    });
  });
});

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '101',
  blockHash: `0x${'b'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-14T00:00:00.000Z',
  providerVersions: { rpc: 'test' },
  adapterVersions: { evm: 'test' },
  configHash: 'c'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-empty-v1',
};

function observation(
  position: string,
  reportId: string,
  evidenceId: string,
  classification: EntityRelationshipTimelineObservation['classification'],
) {
  const currentSnapshot = { ...snapshot, blockNumber: position };
  return {
    observation: {
      reportId,
      resultHash: reportId.replace('erh_', '').padEnd(64, '0'),
      snapshot: currentSnapshot,
      classification,
      sameControllerProbability:
        classification === 'UNKNOWN' ? unknownValue('INSUFFICIENT_DATA') : knownValue(0.9),
      coordinationProbability:
        classification === 'UNKNOWN' ? unknownValue('INSUFFICIENT_DATA') : knownValue(0.2),
      independenceProbability:
        classification === 'UNKNOWN' ? unknownValue('INSUFFICIENT_DATA') : knownValue(0.1),
      serviceSuppressionApplied: false,
      terminalEvidenceId: evidenceId,
      capturedAt: snapshot.capturedAt,
    },
    metadata: {
      snapshot: currentSnapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: snapshot.capturedAt,
      sourceSet: ['test-rpc'],
      modelVersion: 'entity-v0.1.0',
      confidence: 0.9,
      evidenceIds: [evidenceId],
    },
  };
}

function storedGraph(): StoredEntityInvestigationGraph {
  const first = observation('100', `erh_${'1'.repeat(24)}`, `ev_${'1'.repeat(24)}`, 'UNKNOWN');
  const latest = observation(
    '101',
    `erh_${'2'.repeat(24)}`,
    `ev_${'2'.repeat(24)}`,
    'PROBABLE_SAME_CONTROLLER',
  );
  const timeline = buildEntityRelationshipTimeline({
    ledger: 'EVM',
    chainId: 'eip155:56',
    subjectA: 'wallet-a',
    subjectB: 'wallet-b',
    reports: [first, latest],
  });
  const timelineEvidence = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:entity-v0.1.0',
    locator: 'entity-relationship:wallet-a:wallet-b:101',
    payload: { observation: latest.observation },
    blockOrSlot: '101',
    finality: 'finalized',
    observedAt: snapshot.capturedAt,
    summary: 'Timeline terminal Evidence.',
  });
  const timelineId = `ert_${'3'.repeat(24)}`;
  const graph = buildEntityInvestigationGraph({
    sources: [
      {
        timelineId,
        resultHash: '4'.repeat(64),
        terminalEvidenceId: timelineEvidence.id,
        timeline,
      },
    ],
  });
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:entity-investigation-graph-v0.1.0',
    locator: `entity-investigation-graph:EVM:eip155:56:101:${graph.request.timelineSetHash}`,
    payload: { graph },
    blockOrSlot: '101',
    finality: 'finalized',
    observedAt: snapshot.capturedAt,
    summary: 'Investigation graph terminal Evidence.',
    sourceEvidenceIds: [timelineEvidence.id],
  });
  const graphReport = EntityInvestigationGraphReportSchema.parse({
    schemaVersion: 'entity-investigation-graph-report-v1',
    sourceOfTruth: 'DURABLE_ENTITY_RELATIONSHIP_TIMELINES',
    automaticOwnershipMergeAllowed: false,
    graph,
    terminalEvidenceId: terminal.id,
    evidence: [timelineEvidence, terminal].sort((left, right) => left.id.localeCompare(right.id)),
  });
  const resultHash = hashPayload(graphReport);
  return {
    id: `eig_${hashPayload({ schema: 'zerotrace-entity-investigation-graph-report-v1', resultHash }).slice(0, 24)}`,
    ledger: 'EVM',
    chainId: 'eip155:56',
    asOfPosition: '101',
    asOfHash: snapshot.blockHash,
    timelineSetHash: graph.request.timelineSetHash,
    resultHash,
    report: graphReport,
    terminalEvidenceId: terminal.id,
    timelineIds: graph.request.timelineIds,
    subjectIds: graph.nodes.map((node) => node.subjectId).sort(),
    edgeIds: graph.edges.map((edge) => edge.id).sort(),
    evidenceIds: graphReport.evidence.map((item) => item.id).sort(),
    sourceSet: graph.metadata.sourceSet,
    modelVersion: 'entity-investigation-graph-v0.1.0',
    capturedAt: snapshot.capturedAt,
    createdAt: snapshot.capturedAt,
  };
}

function graphRow(stored: StoredEntityInvestigationGraph) {
  return {
    id: stored.id,
    ledger: stored.ledger,
    chain_id: stored.chainId,
    as_of_position: stored.asOfPosition,
    as_of_hash: stored.asOfHash,
    timeline_set_hash: stored.timelineSetHash,
    result_hash: stored.resultHash,
    report: stored.report,
    terminal_evidence_id: stored.terminalEvidenceId,
    timeline_ids: stored.timelineIds,
    subject_ids: stored.subjectIds,
    edge_ids: stored.edgeIds,
    evidence_ids: stored.evidenceIds,
    source_set: stored.sourceSet,
    model_version: stored.modelVersion,
    captured_at: new Date(stored.capturedAt),
    created_at: stored.createdAt,
  };
}

describe('PostgreSQL entity investigation graph writes', () => {
  it('writes, replays, and lists the latest graph without inventing missing rows', async () => {
    const stored = storedGraph();
    let reads = 0;
    const query = vi.fn(async (text: string) => {
      if (text.includes('INSERT INTO entity_investigation_graph_reports')) {
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM entity_investigation_graph_reports')) {
        reads += 1;
        if (text.includes('WHERE id =') && reads === 1) return { rows: [], rowCount: 0 };
        return { rows: [graphRow(stored)], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresEntityInvestigationGraphRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });
    await expect(repository.put(stored.report)).resolves.toMatchObject({ id: stored.id });
    await expect(repository.put(stored.report)).resolves.toMatchObject({ id: stored.id });
    await expect(repository.get(stored.id)).resolves.toMatchObject({
      resultHash: stored.resultHash,
    });
    await expect(
      repository.latest({ ledger: 'EVM', chainId: 'eip155:56', subjectId: stored.subjectIds[0] }),
    ).resolves.toMatchObject({ id: stored.id });
    await repository.close();
  });

  it('keeps missing graphs undefined and maps unavailable storage honestly', async () => {
    const stored = storedGraph();
    const empty = PostgresEntityInvestigationGraphRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(empty.get(stored.id)).resolves.toBeUndefined();
    await expect(empty.latest({ ledger: 'EVM', chainId: 'eip155:56' })).resolves.toBeUndefined();

    const down = PostgresEntityInvestigationGraphRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      end: vi.fn(),
    });
    await expect(down.put(stored.report)).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
    });
    await expect(down.get(stored.id)).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
    });
    await expect(down.latest({ ledger: 'EVM', chainId: 'eip155:56' })).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
    });
    await expect(down.health()).resolves.toMatchObject({
      errorCode: 'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
    });
  });
});
