import {
  EntityRelationshipTimelineCoreSchema,
  EntityRelationshipTimelineObservationSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type EntityRelationshipTimelineCore,
  type EntityRelationshipTimelineObservation,
  type Ledger,
} from '@zerotrace/schemas';

export const ENTITY_RELATIONSHIP_TIMELINE_MODEL_VERSION = 'entity-timeline-v0.1.0' as const;

export interface EntityRelationshipTimelineSource {
  observation: EntityRelationshipTimelineObservation;
  metadata: AnalysisMetadata;
}

export interface BuildEntityRelationshipTimelineInput {
  ledger: Ledger;
  chainId: string;
  subjectA: string;
  subjectB: string;
  reports: readonly EntityRelationshipTimelineSource[];
}

function position(observation: EntityRelationshipTimelineObservation): string {
  const snapshot = observation.snapshot;
  return snapshot.ledger === 'EVM'
    ? snapshot.blockNumber
    : snapshot.ledger === 'BITCOIN'
      ? snapshot.height
      : snapshot.slot;
}

type ProbabilityKnowledge = EntityRelationshipTimelineObservation['sameControllerProbability'];

function delta(
  before: ProbabilityKnowledge,
  after: ProbabilityKnowledge,
  metric: string,
): ProbabilityKnowledge {
  if (before.state === 'known' && after.state === 'known') {
    return knownValue(Number((after.value - before.value).toFixed(6)));
  }
  const unavailable =
    before.state === 'unavailable' ? before : after.state === 'unavailable' ? after : undefined;
  if (unavailable !== undefined) {
    return unavailableValue(
      unavailable.reason,
      `${metric} delta is unavailable because at least one endpoint is unavailable.`,
    );
  }
  const unknown =
    before.state === 'unknown' ? before : after.state === 'unknown' ? after : undefined;
  return unknownValue(
    unknown?.reason ?? 'INSUFFICIENT_DATA',
    `${metric} delta is unknown because both endpoint probabilities are not known.`,
  );
}

function minimum(values: readonly number[]): number {
  return Math.min(...values);
}

export function buildEntityRelationshipTimeline(
  input: BuildEntityRelationshipTimelineInput,
): EntityRelationshipTimelineCore {
  const subjects = [input.subjectA.trim(), input.subjectB.trim()].sort();
  if (
    input.chainId.trim().length === 0 ||
    subjects[0] === undefined ||
    subjects[1] === undefined ||
    subjects[0].length === 0 ||
    subjects[1].length === 0 ||
    subjects[0] === subjects[1]
  ) {
    throw new Error('Entity relationship timeline identity is invalid.');
  }
  if (input.reports.length < 2 || input.reports.length > 1_000) {
    throw new Error('Entity relationship timelines require between 2 and 1,000 reports.');
  }

  const reports = input.reports
    .map((item) => ({
      observation: EntityRelationshipTimelineObservationSchema.parse(item.observation),
      metadata: item.metadata,
    }))
    .sort((left, right) => {
      const positionOrder =
        BigInt(position(left.observation)) - BigInt(position(right.observation));
      if (positionOrder !== 0n) return positionOrder < 0n ? -1 : 1;
      const capturedOrder = left.observation.capturedAt.localeCompare(right.observation.capturedAt);
      if (capturedOrder !== 0) return capturedOrder;
      return left.observation.reportId.localeCompare(right.observation.reportId);
    });
  const observations = reports.map((item) => item.observation);
  if (
    observations.some(
      (observation) =>
        observation.snapshot.ledger !== input.ledger ||
        observation.snapshot.chainId !== input.chainId.trim(),
    )
  ) {
    throw new Error('Entity relationship timeline reports must use one ledger and chain.');
  }
  if (new Set(observations.map((item) => item.reportId)).size !== observations.length) {
    throw new Error('Entity relationship timeline reports require unique report identities.');
  }

  const transitions = observations.slice(1).map((after, index) => {
    const before = observations[index] as EntityRelationshipTimelineObservation;
    const beforePosition = BigInt(position(before));
    const afterPosition = BigInt(position(after));
    return {
      fromReportId: before.reportId,
      toReportId: after.reportId,
      fromPosition: beforePosition.toString(),
      toPosition: afterPosition.toString(),
      kind:
        beforePosition === afterPosition ? ('REVISION' as const) : ('POSITION_ADVANCE' as const),
      unobservedPositionCount:
        beforePosition === afterPosition ? '0' : (afterPosition - beforePosition - 1n).toString(),
      classificationBefore: before.classification,
      classificationAfter: after.classification,
      classificationChanged: before.classification !== after.classification,
      serviceSuppressionBefore: before.serviceSuppressionApplied,
      serviceSuppressionAfter: after.serviceSuppressionApplied,
      serviceSuppressionChanged:
        before.serviceSuppressionApplied !== after.serviceSuppressionApplied,
      sameControllerDelta: delta(
        before.sameControllerProbability,
        after.sameControllerProbability,
        'Same-controller probability',
      ),
      coordinationDelta: delta(
        before.coordinationProbability,
        after.coordinationProbability,
        'Coordination probability',
      ),
      independenceDelta: delta(
        before.independenceProbability,
        after.independenceProbability,
        'Independence probability',
      ),
      evidenceIds: [before.terminalEvidenceId, after.terminalEvidenceId].sort() as [string, string],
    };
  });
  const latest = observations.at(-1) as EntityRelationshipTimelineObservation;
  const sourceSet = [...new Set(reports.flatMap((item) => item.metadata.sourceSet))].sort();
  const evidenceIds = observations.map((item) => item.terminalEvidenceId).sort();

  return EntityRelationshipTimelineCoreSchema.parse({
    request: {
      ledger: input.ledger,
      chainId: input.chainId.trim(),
      subjectA: subjects[0],
      subjectB: subjects[1],
      fromPosition: position(observations[0] as EntityRelationshipTimelineObservation),
      toPosition: position(latest),
    },
    observations,
    transitions,
    summary: {
      observationCount: observations.length,
      transitionCount: transitions.length,
      classificationChangeCount: transitions.filter((item) => item.classificationChanged).length,
      serviceSuppressionChangeCount: transitions.filter((item) => item.serviceSuppressionChanged)
        .length,
      currentClassification: latest.classification,
      currentSameControllerProbability: latest.sameControllerProbability,
      currentCoordinationProbability: latest.coordinationProbability,
      currentIndependenceProbability: latest.independenceProbability,
      completePersistedReportSet: true,
      chainObservationContinuity: unknownValue(
        'INSUFFICIENT_DATA',
        'The projection is complete for persisted reports in this range; it does not assert observation at every chain position.',
      ),
    },
    metadata: {
      snapshot: latest.snapshot,
      dataCoverage: minimum(reports.map((item) => item.metadata.dataCoverage)),
      sourceCoverage: minimum(reports.map((item) => item.metadata.sourceCoverage)),
      historyCoverage: minimum(reports.map((item) => item.metadata.historyCoverage)),
      simulationCoverage: minimum(reports.map((item) => item.metadata.simulationCoverage)),
      freshness: reports.at(-1)?.metadata.freshness ?? null,
      sourceSet,
      modelVersion: ENTITY_RELATIONSHIP_TIMELINE_MODEL_VERSION,
      confidence: minimum(reports.map((item) => item.metadata.confidence)),
      evidenceIds,
    },
  });
}
