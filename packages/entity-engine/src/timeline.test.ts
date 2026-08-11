import { describe, expect, it } from 'vitest';

import {
  EntityRelationshipTimelineCoreSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type EntityRelationshipTimelineObservation,
} from '@zerotrace/schemas';

import { buildEntityRelationshipTimeline } from './timeline.js';

function source(
  position: string,
  classification: EntityRelationshipTimelineObservation['classification'],
  probability: EntityRelationshipTimelineObservation['sameControllerProbability'],
  suffix: string,
  serviceSuppressionApplied = false,
) {
  const capturedAt = `2026-08-0${suffix}T00:00:00.000Z`;
  const terminalEvidenceId = `ev_${suffix.repeat(24)}`;
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: position,
    blockHash: `0x${suffix.repeat(64)}`,
    finality: 'finalized' as const,
    capturedAt,
    providerVersions: { rpc: '1' },
    adapterVersions: { evm: '1' },
    configHash: suffix.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };
  const metadata: AnalysisMetadata = {
    snapshot,
    dataCoverage: 0.9,
    sourceCoverage: 0.8,
    historyCoverage: 0.7,
    simulationCoverage: 0,
    freshness: capturedAt,
    sourceSet: ['rpc'],
    modelVersion: 'entity-v0.1.0',
    confidence: 0.75,
    evidenceIds: [terminalEvidenceId],
  };
  return {
    observation: {
      reportId: `erh_${suffix.repeat(24)}`,
      resultHash: suffix.repeat(64),
      snapshot,
      classification,
      sameControllerProbability: probability,
      coordinationProbability: knownValue(Number(`0.${suffix}`)),
      independenceProbability: knownValue(Number(`0.${suffix}`)),
      serviceSuppressionApplied,
      terminalEvidenceId,
      capturedAt,
    },
    metadata,
  };
}

describe('entity relationship timeline', () => {
  it('sorts immutable observations and exposes changes and unobserved positions', () => {
    const timeline = buildEntityRelationshipTimeline({
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectA: 'wallet-z',
      subjectB: 'wallet-a',
      reports: [
        source('105', 'PROBABLE_SAME_CONTROLLER', knownValue(0.91), '2'),
        source('100', 'UNKNOWN', knownValue(0.2), '1'),
      ],
    });

    expect(timeline.request).toEqual({
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectA: 'wallet-a',
      subjectB: 'wallet-z',
      fromPosition: '100',
      toPosition: '105',
    });
    expect(timeline.transitions[0]).toMatchObject({
      unobservedPositionCount: '4',
      classificationChanged: true,
      sameControllerDelta: knownValue(0.71),
    });
    expect(timeline.summary).toMatchObject({
      observationCount: 2,
      classificationChangeCount: 1,
      completePersistedReportSet: true,
      chainObservationContinuity: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
  });

  it('preserves unavailable and unknown probability states in deltas', () => {
    const unavailable = buildEntityRelationshipTimeline({
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectA: 'a',
      subjectB: 'b',
      reports: [
        source('100', 'UNKNOWN', unknownValue('INSUFFICIENT_DATA'), '1'),
        source('101', 'UNKNOWN', unavailableValue('PROVIDER_DOWN'), '2'),
      ],
    });
    expect(unavailable.transitions[0]?.sameControllerDelta).toMatchObject({
      state: 'unavailable',
      reason: 'PROVIDER_DOWN',
    });

    const unknown = buildEntityRelationshipTimeline({
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectA: 'a',
      subjectB: 'b',
      reports: [
        source('100', 'UNKNOWN', unknownValue('INSUFFICIENT_DATA'), '1'),
        source('101', 'UNKNOWN', knownValue(0.2), '2'),
      ],
    });
    expect(unknown.transitions[0]?.sameControllerDelta).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
  });

  it('retains same-position recomputations as deterministic revisions', () => {
    const revision = source('100', 'PROBABLE_SAME_CONTROLLER', knownValue(0.9), '2');
    revision.observation.snapshot.capturedAt = '2026-08-02T00:00:00.000Z';
    revision.observation.capturedAt = '2026-08-02T00:00:00.000Z';
    revision.metadata.snapshot = revision.observation.snapshot;
    const timeline = buildEntityRelationshipTimeline({
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectA: 'a',
      subjectB: 'b',
      reports: [source('100', 'UNKNOWN', knownValue(0.1), '1'), revision],
    });
    expect(timeline.transitions[0]).toMatchObject({
      kind: 'REVISION',
      fromPosition: '100',
      toPosition: '100',
      unobservedPositionCount: '0',
    });
  });

  it('rejects duplicate report identities', () => {
    const duplicate = source('100', 'UNKNOWN', knownValue(0.1), '1');
    expect(() =>
      buildEntityRelationshipTimeline({
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectA: 'a',
        subjectB: 'b',
        reports: [duplicate, duplicate],
      }),
    ).toThrow('unique report identities');
  });

  it('rejects transition provenance that does not bind both endpoint terminals', () => {
    const timeline = buildEntityRelationshipTimeline({
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectA: 'a',
      subjectB: 'b',
      reports: [
        source('100', 'UNKNOWN', knownValue(0.1), '1'),
        source('101', 'UNKNOWN', knownValue(0.2), '2'),
      ],
    });
    const tampered = structuredClone(timeline);
    tampered.transitions[0]!.evidenceIds = [`ev_${'3'.repeat(24)}`, `ev_${'4'.repeat(24)}`];
    expect(EntityRelationshipTimelineCoreSchema.safeParse(tampered).success).toBe(false);
  });
});
