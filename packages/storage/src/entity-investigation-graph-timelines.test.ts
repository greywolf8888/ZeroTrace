import { describe, expect, it, vi } from 'vitest';

import {
  buildEntityInvestigationGraph,
  buildEntityInvestigationGraphTimeline,
  buildEntityRelationshipTimeline,
} from '@zerotrace/entity-engine';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import {
  EntityInvestigationGraphReportSchema,
  EntityInvestigationGraphTimelineReportSchema,
  knownValue,
  unknownValue,
  type EntityInvestigationGraphTimelineReport,
  type EntityRelationshipTimelineObservation,
} from '@zerotrace/schemas';

import { PostgresEntityInvestigationGraphTimelineRepository } from './entity-investigation-graph-timelines.js';
import type { StoredEntityInvestigationGraph } from './entity-investigation-graphs.js';

describe('PostgreSQL Entity investigation graph timeline repository', () => {
  it('rejects invalid reports and identities before storage access', async () => {
    const query = vi.fn();
    const repository = PostgresEntityInvestigationGraphTimelineRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(
      repository.put({} as EntityInvestigationGraphTimelineReport),
    ).rejects.toMatchObject({ code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID' });
    await expect(repository.get('invalid')).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID',
    });
    await expect(
      repository.latest({ ledger: 'EVM', chainId: '', subjectId: 'subject' }),
    ).rejects.toMatchObject({ code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID' });
    expect(query).not.toHaveBeenCalled();
  });

  it('checks both the immutable timeline table and migration marker', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            table_name: 'entity_investigation_graph_timeline_reports',
            migration_applied: true,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      });
    const repository = PostgresEntityInvestigationGraphTimelineRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(repository.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await expect(repository.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_NOT_INITIALIZED',
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

function storedGraph(asOf: string, seed: string): StoredEntityInvestigationGraph {
  const prev = String(BigInt(asOf) - 1n);
  const first = observation(
    prev,
    `erh_${`${seed}1`.padEnd(24, '0')}`,
    `ev_${`${seed}1`.padEnd(24, '0')}`,
    'UNKNOWN',
  );
  const latest = observation(
    asOf,
    `erh_${`${seed}2`.padEnd(24, '0')}`,
    `ev_${`${seed}2`.padEnd(24, '0')}`,
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
    locator: `entity-relationship:wallet-a:wallet-b:${asOf}:${seed}`,
    payload: { observation: latest.observation, seed },
    blockOrSlot: asOf,
    finality: 'finalized',
    observedAt: snapshot.capturedAt,
    summary: 'Timeline terminal Evidence.',
  });
  const timelineId = `ert_${seed.padEnd(24, '0')}`;
  const graph = buildEntityInvestigationGraph({
    sources: [
      {
        timelineId,
        resultHash: seed.padEnd(64, '0'),
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
    locator: `entity-investigation-graph:EVM:eip155:56:${asOf}:${graph.request.timelineSetHash}`,
    payload: { graph },
    blockOrSlot: asOf,
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
    asOfPosition: asOf,
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

function storedTimelineReport() {
  const first = storedGraph('101', 'a');
  const second = storedGraph('201', 'b');
  const timeline = buildEntityInvestigationGraphTimeline({
    sources: [first, second].map((item) => ({
      graphId: item.id,
      resultHash: item.resultHash,
      terminalEvidenceId: item.terminalEvidenceId,
      graph: item.report.graph,
    })),
  });
  const graphTerminals = [first, second].map((item) =>
    item.report.evidence.find((evidence) => evidence.id === item.terminalEvidenceId)!,
  );
  const terminal = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:56',
    kind: 'DERIVED_FEATURE',
    source: 'zerotrace:entity-investigation-graph-timeline-v0.1.0',
    locator:
      `entity-investigation-graph-timeline:EVM:eip155:56:` +
      `${timeline.request.fromPosition}-${timeline.request.toPosition}:` +
      timeline.request.graphSetHash,
    payload: { timeline },
    blockOrSlot: timeline.request.toPosition,
    finality: 'finalized',
    observedAt: snapshot.capturedAt,
    summary: 'Investigation graph timeline terminal Evidence.',
    sourceEvidenceIds: timeline.metadata.evidenceIds,
  });
  const report = EntityInvestigationGraphTimelineReportSchema.parse({
    schemaVersion: 'entity-investigation-graph-timeline-report-v1',
    sourceOfTruth: 'DURABLE_ENTITY_INVESTIGATION_GRAPHS',
    automaticOwnershipMergeAllowed: false,
    automaticEntityMembershipMutationAllowed: false,
    relationshipTerminationInferenceAllowed: false,
    timeline,
    terminalEvidenceId: terminal.id,
    evidence: [...graphTerminals, terminal].sort((left, right) => left.id.localeCompare(right.id)),
  });
  return { report, subjectId: first.subjectIds[0]! };
}

function timelineRow(values: readonly unknown[]) {
  return {
    id: values[0],
    ledger: values[1],
    chain_id: values[2],
    from_position: values[3],
    to_position: values[4],
    graph_set_hash: values[5],
    result_hash: values[6],
    report: values[7],
    terminal_evidence_id: values[8],
    graph_ids: values[9],
    subject_ids: values[10],
    evidence_ids: values[11],
    source_set: values[12],
    model_version: values[13],
    captured_at: values[14],
    created_at: values[14],
  };
}

describe('PostgreSQL entity investigation graph timeline writes', () => {
  it('writes, replays, and lists the latest timeline without inventing missing rows', async () => {
    const { report, subjectId } = storedTimelineReport();
    let row: Record<string, unknown> | undefined;
    const query = vi.fn(async (text: string, values: readonly unknown[] = []) => {
      if (text.includes('INSERT INTO entity_investigation_graph_timeline_reports')) {
        row ??= timelineRow(values);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('FROM entity_investigation_graph_timeline_reports')) {
        return { rows: row === undefined ? [] : [row], rowCount: row === undefined ? 0 : 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresEntityInvestigationGraphTimelineRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });
    const first = await repository.put(report);
    await expect(repository.put(report)).resolves.toMatchObject({ id: first.id });
    await expect(repository.get(first.id)).resolves.toMatchObject({ id: first.id });
    await expect(
      repository.latest({ ledger: 'EVM', chainId: 'eip155:56', subjectId }),
    ).resolves.toMatchObject({ id: first.id });
    await repository.close();
  });

  it('keeps missing timelines undefined and maps unavailable storage honestly', async () => {
    const { report } = storedTimelineReport();
    const empty = PostgresEntityInvestigationGraphTimelineRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(empty.get(`eit_${'a'.repeat(24)}`)).resolves.toBeUndefined();
    await expect(empty.latest({ ledger: 'EVM', chainId: 'eip155:56' })).resolves.toBeUndefined();

    const down = PostgresEntityInvestigationGraphTimelineRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      end: vi.fn(),
    });
    await expect(down.put(report)).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
    });
    await expect(down.get(`eit_${'a'.repeat(24)}`)).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
    });
    await expect(down.latest({ ledger: 'EVM', chainId: 'eip155:56' })).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
    });
    await expect(down.health()).resolves.toMatchObject({
      errorCode: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
    });
  });

  it('rejects a write that is not visible after insert', async () => {
    const { report } = storedTimelineReport();
    const query = vi.fn(async (text: string) => {
      if (text.includes('INSERT INTO')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const repository = PostgresEntityInvestigationGraphTimelineRepository.fromPool({
      query,
      end: vi.fn(),
    });
    await expect(repository.put(report)).rejects.toMatchObject({
      code: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_CONFLICT',
    });
  });
});
