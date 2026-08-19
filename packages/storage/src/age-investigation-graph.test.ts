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
  type AnalysisMetadata,
  type EntityRelationshipTimelineObservation,
} from '@zerotrace/schemas';
import type { StoredEntityInvestigationGraph } from './entity-investigation-graphs.js';
import { AgeInvestigationGraphProjectionRepository } from './age-investigation-graph.js';

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
): {
  observation: EntityRelationshipTimelineObservation;
  metadata: AnalysisMetadata;
} {
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

function poolFor(stored: StoredEntityInvestigationGraph, mismatch = false) {
  let registry: Record<string, unknown> | undefined;
  const client = {
    query: vi.fn(async (text: string) => {
      if (text.includes('to_regclass')) {
        return {
          rows: [
            {
              extension_ready: true,
              graph_ready: true,
              registry_table: 'zerotrace_graph_projection_registry',
              migration_applied: true,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('FROM public.zerotrace_graph_projection_registry')) {
        return { rows: registry === undefined ? [] : [registry], rowCount: registry ? 1 : 0 };
      }
      if (text.includes('MATCH (node:Subject')) {
        return { rows: [{ count: mismatch ? '0' : '2' }], rowCount: 1 };
      }
      if (text.includes('MATCH (:Subject)-[edge')) {
        return { rows: [{ count: '1' }], rowCount: 1 };
      }
      if (text.includes('INSERT INTO public.zerotrace_graph_projection_registry')) {
        registry = {
          graph_report_id: stored.id,
          result_hash: stored.resultHash,
          node_count: 2,
          edge_count: 1,
          projected_at: new Date(snapshot.capturedAt),
        };
        return { rows: [registry], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return {
    connect: vi.fn(async () => client),
    end: vi.fn(async () => undefined),
    client,
  };
}

type AgePoolArgument = Parameters<typeof AgeInvestigationGraphProjectionRepository.fromPool>[0];

function agePool(value: unknown): AgePoolArgument {
  return value as AgePoolArgument;
}

describe('Apache AGE investigation graph projection', () => {
  it('projects and replays an immutable graph with exact node and edge counts', async () => {
    const graph = storedGraph();
    const pool = poolFor(graph);
    const repository = AgeInvestigationGraphProjectionRepository.fromPool(agePool(pool));

    await expect(repository.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'APACHE_AGE',
      graphName: 'zerotrace_investigation',
    });
    await expect(repository.project(graph)).resolves.toMatchObject({
      status: 'PROJECTED',
      graphReportId: graph.id,
      nodeCount: 2,
      edgeCount: 1,
    });
    await expect(repository.project(graph)).resolves.toMatchObject({
      status: 'REPLAYED',
      graphReportId: graph.id,
      nodeCount: 2,
      edgeCount: 1,
    });
    await expect(repository.close()).resolves.toBeUndefined();
    expect(pool.client.release).toHaveBeenCalled();
  });

  it('keeps initialization, provider, and projection-count failures explicit', async () => {
    const graph = storedGraph();
    const notInitialized = AgeInvestigationGraphProjectionRepository.fromPool(
      agePool({
        connect: vi.fn(async () => ({
          query: vi.fn(async (text: string) =>
            text.includes('to_regclass')
              ? {
                  rows: [
                    {
                      extension_ready: false,
                      graph_ready: false,
                      registry_table: null,
                      migration_applied: false,
                    },
                  ],
                  rowCount: 1,
                }
              : { rows: [], rowCount: 0 },
          ),
          release: vi.fn(),
        })),
        end: vi.fn(async () => undefined),
      }),
    );
    await expect(notInitialized.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'AGE_PROJECTION_NOT_INITIALIZED',
    });

    const unavailable = AgeInvestigationGraphProjectionRepository.fromPool(
      agePool({
        connect: vi.fn().mockRejectedValue(new Error('age offline')),
        end: vi.fn(async () => undefined),
      }),
    );
    await expect(unavailable.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'AGE_PROJECTION_UNAVAILABLE',
    });
    await expect(unavailable.project(graph)).rejects.toMatchObject({
      code: 'AGE_PROJECTION_UNAVAILABLE',
      retryable: true,
    });

    const conflictPool = poolFor(graph, true);
    const conflictRepository = AgeInvestigationGraphProjectionRepository.fromPool(
      agePool(conflictPool),
    );
    await expect(conflictRepository.project(graph)).rejects.toMatchObject({
      code: 'AGE_PROJECTION_CONFLICT',
    });
    expect(conflictPool.client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
