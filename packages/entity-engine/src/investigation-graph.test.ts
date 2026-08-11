import { describe, expect, it } from 'vitest';

import {
  EntityInvestigationGraphCoreSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type EntityRelationshipTimelineObservation,
} from '@zerotrace/schemas';

import {
  buildEntityInvestigationGraph,
  traverseEntityInvestigationGraph,
} from './investigation-graph.js';
import { buildEntityRelationshipTimeline } from './timeline.js';

function reportSource(
  pairCode: string,
  position: string,
  classification: EntityRelationshipTimelineObservation['classification'],
  probabilities: {
    same: EntityRelationshipTimelineObservation['sameControllerProbability'];
    coordination: EntityRelationshipTimelineObservation['coordinationProbability'];
    independence: EntityRelationshipTimelineObservation['independenceProbability'];
  },
  latest: boolean,
  serviceSuppressionApplied = false,
) {
  const code = `${pairCode}${latest ? '1' : '0'}`;
  const idPart = code.padEnd(24, '0').slice(0, 24);
  const hashPart = code.padEnd(64, '0').slice(0, 64);
  const capturedAt = latest ? '2026-08-11T00:00:00.000Z' : '2026-08-10T00:00:00.000Z';
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: position,
    blockHash: `0x${latest ? 'f'.repeat(64) : 'e'.repeat(64)}`,
    finality: 'finalized' as const,
    capturedAt,
    providerVersions: { rpc: '1' },
    adapterVersions: { evm: '1' },
    configHash: 'd'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
  const terminalEvidenceId = `ev_${idPart}`;
  const metadata: AnalysisMetadata = {
    snapshot,
    dataCoverage: 0.9,
    sourceCoverage: 0.8,
    historyCoverage: 0.7,
    simulationCoverage: 0,
    freshness: capturedAt,
    sourceSet: ['rpc'],
    modelVersion: 'entity-v0.1.0',
    confidence: 0.8,
    evidenceIds: [terminalEvidenceId],
  };
  return {
    observation: {
      reportId: `erh_${idPart}`,
      resultHash: hashPart,
      snapshot,
      classification,
      sameControllerProbability: probabilities.same,
      coordinationProbability: probabilities.coordination,
      independenceProbability: probabilities.independence,
      serviceSuppressionApplied,
      terminalEvidenceId,
      capturedAt,
    },
    metadata,
  };
}

function timeline(
  timelineCode: string,
  subjectA: string,
  subjectB: string,
  classification: EntityRelationshipTimelineObservation['classification'],
  probabilities = {
    same: knownValue(0.94),
    coordination: knownValue(0.7),
    independence: knownValue(0.05),
  },
  serviceSuppressionApplied = false,
) {
  const core = buildEntityRelationshipTimeline({
    ledger: 'EVM',
    chainId: 'eip155:56',
    subjectA,
    subjectB,
    reports: [
      reportSource(
        timelineCode,
        '100',
        'UNKNOWN',
        {
          same: unknownValue('INSUFFICIENT_DATA'),
          coordination: unknownValue('INSUFFICIENT_DATA'),
          independence: unknownValue('INSUFFICIENT_DATA'),
        },
        false,
      ),
      reportSource(
        timelineCode,
        '101',
        classification,
        probabilities,
        true,
        serviceSuppressionApplied,
      ),
    ],
  });
  return {
    timelineId: `ert_${timelineCode.repeat(24)}`,
    resultHash: timelineCode.repeat(64),
    terminalEvidenceId: `ev_${`${timelineCode}f`.padEnd(24, '0')}`,
    timeline: core,
  };
}

describe('entity investigation graph', () => {
  it('projects control and coordination separately while retaining negative observations', () => {
    const sources = [
      timeline('1', 'wallet-a', 'wallet-b', 'PROBABLE_SAME_CONTROLLER'),
      timeline('2', 'wallet-b', 'wallet-c', 'COORDINATED_BUT_INDEPENDENT', {
        same: knownValue(0.2),
        coordination: knownValue(0.97),
        independence: knownValue(0.75),
      }),
      timeline('3', 'wallet-c', 'wallet-d', 'LIKELY_INDEPENDENT', {
        same: knownValue(0.04),
        coordination: knownValue(0.1),
        independence: knownValue(0.96),
      }),
    ];
    const graph = buildEntityInvestigationGraph({ sources });

    expect(graph.summary).toMatchObject({
      nodeCount: 4,
      observationCount: 3,
      projectedEdgeCount: 2,
      sameControllerEdgeCount: 1,
      coordinationEdgeCount: 1,
      suppressedObservationCount: 1,
      componentCount: 2,
      rawTransferEdgesCopied: false,
    });
    expect(graph.edges.map((edge) => edge.relation).sort()).toEqual([
      'COORDINATED_WITH',
      'SAME_CONTROLLER',
    ]);
    expect(graph.observations.find((item) => item.subjectB === 'wallet-d')).toMatchObject({
      projectionState: 'INDEPENDENCE_RETAINED',
      projectedEdgeId: knownValue(null),
    });
    expect(
      graph.investigationComponents.every((item) => !item.automaticEntityMembershipAllowed),
    ).toBe(true);
    expect(
      graph.investigationComponents.every((item) => item.membershipConclusion.state === 'unknown'),
    ).toBe(true);
  });

  it('suppresses even a confirmed relation when an endpoint is known service infrastructure', () => {
    const source = {
      ...timeline('4', 'exchange', 'wallet', 'CONFIRMED_SAME_CONTROLLER'),
      subjectAIsService: true,
      subjectBIsService: false,
    };
    const graph = buildEntityInvestigationGraph({ sources: [source] });

    expect(graph.edges).toEqual([]);
    expect(graph.observations[0]).toMatchObject({
      classification: 'CONFIRMED_SAME_CONTROLLER',
      projectionState: 'SERVICE_SUPPRESSED',
      projectedEdgeId: knownValue(null),
    });
    expect(
      graph.nodes.find((node) => node.subjectId === 'exchange')?.serviceInfrastructure,
    ).toEqual(knownValue(true));
    expect(graph.investigationComponents).toHaveLength(2);
  });

  it('fails closed when timeline sources conflict on an endpoint service status', () => {
    const graph = buildEntityInvestigationGraph({
      sources: [
        {
          ...timeline('d', 'a', 'hub', 'PROBABLE_SAME_CONTROLLER'),
          subjectBIsService: true,
        },
        {
          ...timeline('e', 'hub', 'z', 'PROBABLE_SAME_CONTROLLER'),
          subjectAIsService: false,
        },
      ],
    });

    expect(
      graph.nodes.find((node) => node.subjectId === 'hub')?.serviceInfrastructure,
    ).toMatchObject({ state: 'unknown', reason: 'CONFLICTING_SOURCES' });
    expect(graph.edges).toEqual([]);
    expect(graph.observations.every((item) => item.projectionState === 'SERVICE_SUPPRESSED')).toBe(
      true,
    );
  });

  it('is deterministic regardless of requested timeline order', () => {
    const first = timeline('5', 'a', 'b', 'PROBABLE_SAME_CONTROLLER');
    const second = timeline('6', 'b', 'c', 'COORDINATED_BUT_INDEPENDENT');
    expect(buildEntityInvestigationGraph({ sources: [first, second] })).toEqual(
      buildEntityInvestigationGraph({ sources: [second, first] }),
    );
  });

  it('rejects a coordination edge whose classification was tampered into Unknown', () => {
    const graph = buildEntityInvestigationGraph({
      sources: [timeline('c', 'a', 'b', 'COORDINATED_BUT_INDEPENDENT')],
    });
    const tampered = structuredClone(graph);
    tampered.edges[0]!.classification = 'UNKNOWN';

    expect(EntityInvestigationGraphCoreSchema.safeParse(tampered).success).toBe(false);
  });

  it('rejects mixed terminal snapshots and duplicate relationship pairs', () => {
    const first = timeline('7', 'a', 'b', 'PROBABLE_SAME_CONTROLLER');
    const mixed = timeline('8', 'b', 'c', 'PROBABLE_SAME_CONTROLLER');
    mixed.timeline.metadata.snapshot.capturedAt = '2026-08-11T00:00:01.000Z';
    expect(() => buildEntityInvestigationGraph({ sources: [first, mixed] })).toThrow(
      'one exact ledger Snapshot',
    );
    expect(() => buildEntityInvestigationGraph({ sources: [first, first] })).toThrow(
      'unique canonical pairs',
    );
  });

  it('runs an undirected bounded traversal without turning connectivity into ownership', () => {
    const graph = buildEntityInvestigationGraph({
      sources: [
        timeline('9', 'a', 'b', 'PROBABLE_SAME_CONTROLLER'),
        timeline('a', 'b', 'c', 'COORDINATED_BUT_INDEPENDENT'),
        timeline('b', 'c', 'd', 'PROBABLE_SAME_CONTROLLER'),
      ],
    });
    const oneHop = traverseEntityInvestigationGraph(graph, {
      seedSubjectId: 'b',
      maxDepth: 1,
      maxNodes: 10,
    });
    expect(oneHop.nodes.map((node) => node.subjectId)).toEqual(['a', 'b', 'c']);
    expect(oneHop.edges).toHaveLength(2);
    expect(oneHop.truncated).toBe(false);

    const bounded = traverseEntityInvestigationGraph(graph, {
      seedSubjectId: 'a',
      maxDepth: 3,
      maxNodes: 2,
    });
    expect(bounded.nodes).toHaveLength(2);
    expect(bounded.truncated).toBe(true);
    expect(graph.edges.every((edge) => !edge.automaticOwnershipPropagationAllowed)).toBe(true);
  });
});
