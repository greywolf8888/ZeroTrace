import { describe, expect, it } from 'vitest';

import {
  EntityInvestigationGraphTimelineCoreSchema,
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type EntityRelationshipTimelineObservation,
} from '@zerotrace/schemas';

import { buildEntityInvestigationGraph } from './investigation-graph.js';
import { buildEntityInvestigationGraphTimeline } from './investigation-graph-timeline.js';
import { buildEntityRelationshipTimeline } from './timeline.js';

function blockHash(position: number, suffix = ''): string {
  return `0x${`${position.toString(16)}${suffix}`.padStart(64, '0').slice(-64)}`;
}

function relationshipSource(
  code: string,
  position: number,
  classification: EntityRelationshipTimelineObservation['classification'],
  probabilities: {
    same: EntityRelationshipTimelineObservation['sameControllerProbability'];
    coordination: EntityRelationshipTimelineObservation['coordinationProbability'];
    independence: EntityRelationshipTimelineObservation['independenceProbability'];
  },
  latest: boolean,
) {
  const observedPosition = latest ? position : position - 1;
  const idPart = `${code}${latest ? '1' : '0'}`.padEnd(24, '0').slice(0, 24);
  const capturedAt = `2026-08-11T00:${String(observedPosition % 60).padStart(2, '0')}:00.000Z`;
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: String(observedPosition),
    blockHash: blockHash(observedPosition),
    parentBlockHash: blockHash(observedPosition - 1),
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
      resultHash: idPart.padEnd(64, '0'),
      snapshot,
      classification,
      sameControllerProbability: probabilities.same,
      coordinationProbability: probabilities.coordination,
      independenceProbability: probabilities.independence,
      serviceSuppressionApplied: false,
      terminalEvidenceId,
      capturedAt,
    },
    metadata,
  };
}

function relationshipTimeline(
  code: string,
  position: number,
  subjectA: string,
  subjectB: string,
  classification: EntityRelationshipTimelineObservation['classification'],
  probabilities: {
    same: EntityRelationshipTimelineObservation['sameControllerProbability'];
    coordination: EntityRelationshipTimelineObservation['coordinationProbability'];
    independence: EntityRelationshipTimelineObservation['independenceProbability'];
  } = {
    same: knownValue(0.94),
    coordination: knownValue(0.7),
    independence: knownValue(0.05),
  },
) {
  const timeline = buildEntityRelationshipTimeline({
    ledger: 'EVM',
    chainId: 'eip155:56',
    subjectA,
    subjectB,
    reports: [
      relationshipSource(
        code,
        position,
        'UNKNOWN',
        {
          same: unknownValue('INSUFFICIENT_DATA'),
          coordination: unknownValue('INSUFFICIENT_DATA'),
          independence: unknownValue('INSUFFICIENT_DATA'),
        },
        false,
      ),
      relationshipSource(code, position, classification, probabilities, true),
    ],
  });
  const idPart = code.padEnd(24, '0').slice(0, 24);
  return {
    timelineId: `ert_${idPart}`,
    resultHash: code.padEnd(64, '0').slice(0, 64),
    terminalEvidenceId: `ev_${`${code}f`.padEnd(24, '0').slice(0, 24)}`,
    timeline,
  };
}

function graphSource(
  code: string,
  position: number,
  pairs: Array<{
    code: string;
    subjectA: string;
    subjectB: string;
    classification: EntityRelationshipTimelineObservation['classification'];
    probabilities?: {
      same: EntityRelationshipTimelineObservation['sameControllerProbability'];
      coordination: EntityRelationshipTimelineObservation['coordinationProbability'];
      independence: EntityRelationshipTimelineObservation['independenceProbability'];
    };
  }>,
) {
  const graph = buildEntityInvestigationGraph({
    sources: pairs.map((pair) =>
      relationshipTimeline(
        pair.code,
        position,
        pair.subjectA,
        pair.subjectB,
        pair.classification,
        pair.probabilities,
      ),
    ),
  });
  const idPart = code.padEnd(24, '0').slice(0, 24);
  return {
    graphId: `eig_${idPart}`,
    resultHash: code.padEnd(64, '0').slice(0, 64),
    terminalEvidenceId: `ev_${`${code}e`.padEnd(24, '0').slice(0, 24)}`,
    graph,
  };
}

describe('entity investigation graph timeline', () => {
  it('tracks relation and request-scope changes without inferring membership or termination', () => {
    const before = graphSource('a1', 101, [
      {
        code: '11',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'PROBABLE_SAME_CONTROLLER',
      },
      {
        code: '12',
        subjectA: 'wallet-b',
        subjectB: 'wallet-c',
        classification: 'LIKELY_INDEPENDENT',
        probabilities: {
          same: knownValue(0.04),
          coordination: knownValue(0.1),
          independence: knownValue(0.96),
        },
      },
    ]);
    const after = graphSource('a2', 102, [
      {
        code: '21',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'COORDINATED_BUT_INDEPENDENT',
        probabilities: {
          same: knownValue(0.2),
          coordination: knownValue(0.97),
          independence: knownValue(0.7),
        },
      },
      {
        code: '22',
        subjectA: 'wallet-c',
        subjectB: 'wallet-d',
        classification: 'PROBABLE_SAME_CONTROLLER',
      },
    ]);

    const timeline = buildEntityInvestigationGraphTimeline({ sources: [after, before] });
    const transition = timeline.transitions[0]!;

    expect(timeline.request.graphIds).toEqual([before.graphId, after.graphId]);
    expect(transition.snapshotContinuity).toEqual({ state: 'known', value: true });
    expect(transition.addedSubjectIds).toEqual(['wallet-d']);
    expect(transition.omittedSubjectIds).toEqual([]);
    expect(transition.pairChanges.map((item) => item.kind)).toEqual([
      'RELATION_CHANGED',
      'OMITTED_FROM_REQUESTED_GRAPH',
      'ADDED_TO_REQUESTED_GRAPH',
    ]);
    expect(transition.pairChanges.every((item) => !item.relationshipEndEstablished)).toBe(true);
    expect(transition.pairChanges.every((item) => !item.relationshipStartEstablished)).toBe(true);
    expect(transition.automaticEntityMembershipMutationAllowed).toBe(false);
    expect(timeline.summary).toMatchObject({
      pairChangeCount: 3,
      automaticEntityMembershipMutationAllowed: false,
      absenceEstablishesRelationshipTermination: false,
      rawTransferEdgesCopied: false,
    });
  });

  it('keeps skipped-position continuity Unknown instead of pretending it is false or zero', () => {
    const before = graphSource('b1', 101, [
      {
        code: '31',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'PROBABLE_SAME_CONTROLLER',
      },
    ]);
    const after = graphSource('b2', 105, [
      {
        code: '32',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'PROBABLE_SAME_CONTROLLER',
      },
    ]);
    const timeline = buildEntityInvestigationGraphTimeline({ sources: [before, after] });

    expect(timeline.transitions[0]).toMatchObject({
      unobservedPositionCount: '3',
      snapshotContinuity: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
    expect(timeline.summary.chainObservationContinuity).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
  });

  it('records a same-position Snapshot conflict as Known false', () => {
    const before = graphSource('c1', 101, [
      {
        code: '41',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'PROBABLE_SAME_CONTROLLER',
      },
    ]);
    const after = graphSource('c2', 101, [
      {
        code: '42',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'PROBABLE_SAME_CONTROLLER',
      },
    ]);
    const afterSnapshot = after.graph.metadata.snapshot;
    if (afterSnapshot.ledger !== 'EVM') throw new Error('Expected an EVM test Snapshot.');
    after.graph.metadata.snapshot = {
      ...afterSnapshot,
      blockHash: blockHash(101, 'f'),
      capturedAt: '2026-08-11T01:41:00.000Z',
    };
    const timeline = buildEntityInvestigationGraphTimeline({ sources: [before, after] });

    expect(timeline.transitions[0]?.kind).toBe('REVISION');
    expect(timeline.transitions[0]?.snapshotContinuity).toEqual({
      state: 'known',
      value: false,
    });
    expect(timeline.summary.chainObservationContinuity).toEqual({
      state: 'known',
      value: false,
    });
  });

  it('is deterministic and rejects duplicate or cross-chain graph identities', () => {
    const before = graphSource('d1', 101, [
      {
        code: '51',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'PROBABLE_SAME_CONTROLLER',
      },
    ]);
    const after = graphSource('d2', 102, [
      {
        code: '52',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'PROBABLE_SAME_CONTROLLER',
      },
    ]);
    expect(buildEntityInvestigationGraphTimeline({ sources: [after, before] })).toEqual(
      buildEntityInvestigationGraphTimeline({ sources: [before, after] }),
    );
    expect(() => buildEntityInvestigationGraphTimeline({ sources: [before, before] })).toThrow(
      'unique graph identities',
    );
    const wrongChain = structuredClone(after);
    wrongChain.graph.request.chainId = 'eip155:1';
    wrongChain.graph.metadata.snapshot.chainId = 'eip155:1';
    expect(() => buildEntityInvestigationGraphTimeline({ sources: [before, wrongChain] })).toThrow(
      'one ledger and chain',
    );
  });

  it('rejects tampered change semantics', () => {
    const before = graphSource('e1', 101, [
      {
        code: '61',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'PROBABLE_SAME_CONTROLLER',
      },
    ]);
    const after = graphSource('e2', 102, [
      {
        code: '62',
        subjectA: 'wallet-a',
        subjectB: 'wallet-b',
        classification: 'COORDINATED_BUT_INDEPENDENT',
        probabilities: {
          same: knownValue(0.2),
          coordination: knownValue(0.97),
          independence: knownValue(0.7),
        },
      },
    ]);
    const timeline = buildEntityInvestigationGraphTimeline({ sources: [before, after] });
    const tampered = structuredClone(timeline) as unknown as {
      transitions: Array<{ pairChanges: Array<{ relationshipEndEstablished: boolean }> }>;
    };
    tampered.transitions[0]!.pairChanges[0]!.relationshipEndEstablished = true;
    expect(EntityInvestigationGraphTimelineCoreSchema.safeParse(tampered).success).toBe(false);

    const tamperedState = structuredClone(timeline) as unknown as {
      transitions: Array<{
        pairChanges: Array<{
          before: { state: string; value: { classification: string } };
        }>;
      }>;
    };
    tamperedState.transitions[0]!.pairChanges[0]!.before.value.classification =
      'COORDINATED_BUT_INDEPENDENT';
    expect(EntityInvestigationGraphTimelineCoreSchema.safeParse(tamperedState).success).toBe(false);
  });
});
