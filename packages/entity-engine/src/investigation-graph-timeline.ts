import { hashPayload } from '@zerotrace/evidence';
import {
  EntityInvestigationGraphCoreSchema,
  EntityInvestigationGraphTimelineCoreSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type EntityInvestigationGraphCore,
  type EntityInvestigationGraphTimelineCore,
  type EntityInvestigationGraphTimelineObservation,
  type EntityInvestigationGraphTimelinePairChange,
  type EntityInvestigationGraphTimelinePairChangeKind,
  type EntityInvestigationGraphTimelinePairObservation,
  type EntityInvestigationGraphTimelinePairState,
  type KnowledgeValue,
} from '@zerotrace/schemas';

export const ENTITY_INVESTIGATION_GRAPH_TIMELINE_MODEL_VERSION =
  'entity-investigation-graph-timeline-v0.1.0' as const;

export interface EntityInvestigationGraphTimelineReportSource {
  graphId: string;
  resultHash: string;
  terminalEvidenceId: string;
  graph: EntityInvestigationGraphCore;
}

export interface BuildEntityInvestigationGraphTimelineInput {
  sources: readonly EntityInvestigationGraphTimelineReportSource[];
}

function position(graph: EntityInvestigationGraphCore): string {
  const snapshot = graph.metadata.snapshot;
  return snapshot.ledger === 'EVM'
    ? snapshot.blockNumber
    : snapshot.ledger === 'BITCOIN'
      ? snapshot.height
      : snapshot.slot;
}

function pairKey(subjectA: string, subjectB: string): string {
  return `${subjectA}\u0000${subjectB}`;
}

function pairState(
  graph: EntityInvestigationGraphCore,
  timelineId: string,
): EntityInvestigationGraphTimelinePairState {
  const observation = graph.observations.find((item) => item.timelineId === timelineId);
  if (observation === undefined) throw new Error('Investigation graph observation is missing.');
  const edge = graph.edges.find((item) => item.timelineId === timelineId);
  return {
    timelineId,
    classification: observation.classification,
    sameControllerProbability: observation.sameControllerProbability,
    coordinationProbability: observation.coordinationProbability,
    independenceProbability: observation.independenceProbability,
    serviceSuppressionApplied: observation.serviceSuppressionApplied,
    projectionState: observation.projectionState,
    relation: knownValue(edge?.relation ?? null),
    terminalEvidenceId: observation.terminalEvidenceId,
    automaticOwnershipPropagationAllowed: false,
  };
}

function observation(
  source: EntityInvestigationGraphTimelineReportSource,
): EntityInvestigationGraphTimelineObservation {
  const graph = source.graph;
  const pairs = graph.observations
    .map((item): EntityInvestigationGraphTimelinePairObservation => ({
      subjectA: item.subjectA,
      subjectB: item.subjectB,
      state: pairState(graph, item.timelineId),
    }))
    .sort((left, right) =>
      pairKey(left.subjectA, left.subjectB).localeCompare(pairKey(right.subjectA, right.subjectB)),
    );
  return {
    graphId: source.graphId,
    resultHash: source.resultHash,
    timelineSetHash: graph.request.timelineSetHash,
    subjectIds: graph.nodes.map((item) => item.subjectId).sort(),
    pairs,
    terminalEvidenceId: source.terminalEvidenceId,
    metadata: graph.metadata,
  };
}

function pairChangeKind(
  before: EntityInvestigationGraphTimelinePairState | undefined,
  after: EntityInvestigationGraphTimelinePairState | undefined,
): EntityInvestigationGraphTimelinePairChangeKind | undefined {
  if (before === undefined && after !== undefined) return 'ADDED_TO_REQUESTED_GRAPH';
  if (before !== undefined && after === undefined) return 'OMITTED_FROM_REQUESTED_GRAPH';
  if (before === undefined || after === undefined) return undefined;
  if (before.projectionState !== after.projectionState) return 'PROJECTION_CHANGED';
  if (JSON.stringify(before.relation) !== JSON.stringify(after.relation)) return 'RELATION_CHANGED';
  if (before.classification !== after.classification) return 'CLASSIFICATION_CHANGED';
  if (before.serviceSuppressionApplied !== after.serviceSuppressionApplied)
    return 'SERVICE_SUPPRESSION_CHANGED';
  if (
    JSON.stringify(before.sameControllerProbability) !==
      JSON.stringify(after.sameControllerProbability) ||
    JSON.stringify(before.coordinationProbability) !==
      JSON.stringify(after.coordinationProbability) ||
    JSON.stringify(before.independenceProbability) !== JSON.stringify(after.independenceProbability)
  )
    return 'PROBABILITY_CHANGED';
  if (
    before.timelineId !== after.timelineId ||
    before.terminalEvidenceId !== after.terminalEvidenceId
  )
    return 'EVIDENCE_REFRESHED';
  return undefined;
}

function change(
  key: string,
  before: EntityInvestigationGraphTimelinePairState | undefined,
  after: EntityInvestigationGraphTimelinePairState | undefined,
): EntityInvestigationGraphTimelinePairChange | undefined {
  const kind = pairChangeKind(before, after);
  if (kind === undefined) return undefined;
  const separator = key.indexOf('\u0000');
  const subjectA = key.slice(0, separator);
  const subjectB = key.slice(separator + 1);
  const evidenceIds = [before?.terminalEvidenceId, after?.terminalEvidenceId]
    .filter((item): item is string => item !== undefined)
    .filter((item, index, items) => items.indexOf(item) === index)
    .sort();
  return {
    subjectA,
    subjectB,
    kind,
    before:
      before === undefined
        ? unknownValue(
            'NOT_QUERIED',
            'This pair was not included in the earlier requested investigation graph.',
          )
        : knownValue(before),
    after:
      after === undefined
        ? unknownValue(
            'NOT_QUERIED',
            'This pair was not included in the later requested investigation graph.',
          )
        : knownValue(after),
    evidenceIds,
    relationshipStartEstablished: false,
    relationshipEndEstablished: false,
    automaticEntityMembershipMutationAllowed: false,
  };
}

function snapshotContinuity(
  before: EntityInvestigationGraphTimelineObservation,
  after: EntityInvestigationGraphTimelineObservation,
): KnowledgeValue<boolean> {
  const beforePosition = BigInt(
    before.metadata.snapshot.ledger === 'EVM'
      ? before.metadata.snapshot.blockNumber
      : before.metadata.snapshot.ledger === 'BITCOIN'
        ? before.metadata.snapshot.height
        : before.metadata.snapshot.slot,
  );
  const afterPosition = BigInt(
    after.metadata.snapshot.ledger === 'EVM'
      ? after.metadata.snapshot.blockNumber
      : after.metadata.snapshot.ledger === 'BITCOIN'
        ? after.metadata.snapshot.height
        : after.metadata.snapshot.slot,
  );
  const beforeHash =
    before.metadata.snapshot.ledger === 'SOLANA'
      ? before.metadata.snapshot.blockhash
      : before.metadata.snapshot.blockHash;
  const afterHash =
    after.metadata.snapshot.ledger === 'SOLANA'
      ? after.metadata.snapshot.blockhash
      : after.metadata.snapshot.blockHash;
  if (beforePosition === afterPosition) return knownValue(beforeHash === afterHash);
  if (afterPosition !== beforePosition + 1n) {
    return unknownValue(
      'INSUFFICIENT_DATA',
      'Adjacent persisted graphs do not observe every chain position.',
    );
  }
  const beforeSnapshot = before.metadata.snapshot;
  const afterSnapshot = after.metadata.snapshot;
  if (beforeSnapshot.ledger === 'EVM' && afterSnapshot.ledger === 'EVM') {
    return afterSnapshot.parentBlockHash === undefined
      ? unknownValue('INSUFFICIENT_DATA', 'The successor EVM Snapshot has no parent hash.')
      : knownValue(
          afterSnapshot.parentBlockHash.toLowerCase() === beforeSnapshot.blockHash.toLowerCase(),
        );
  }
  if (beforeSnapshot.ledger === 'BITCOIN' && afterSnapshot.ledger === 'BITCOIN') {
    return afterSnapshot.previousBlockHash === undefined
      ? unknownValue('INSUFFICIENT_DATA', 'The successor Bitcoin Snapshot has no previous hash.')
      : knownValue(afterSnapshot.previousBlockHash === beforeSnapshot.blockHash);
  }
  if (beforeSnapshot.ledger === 'SOLANA' && afterSnapshot.ledger === 'SOLANA') {
    return afterSnapshot.parentSlot === undefined || afterSnapshot.previousBlockhash === undefined
      ? unknownValue(
          'INSUFFICIENT_DATA',
          'The successor Solana Snapshot has no complete parent identity.',
        )
      : knownValue(
          afterSnapshot.parentSlot === beforePosition.toString() &&
            afterSnapshot.previousBlockhash === beforeSnapshot.blockhash,
        );
  }
  return unavailableValue('CONFLICTING_SOURCES', 'Snapshot ledgers are inconsistent.');
}

function aggregateContinuity(values: readonly KnowledgeValue<boolean>[]): KnowledgeValue<boolean> {
  if (values.some((item) => item.state === 'known' && item.value === false))
    return knownValue(false);
  const unavailable = values.find((item) => item.state === 'unavailable');
  if (unavailable !== undefined) {
    return unavailableValue(
      unavailable.reason,
      'At least one graph transition continuity check is unavailable.',
    );
  }
  const unknown = values.find((item) => item.state === 'unknown');
  if (unknown !== undefined) {
    return unknownValue(
      unknown.reason,
      'At least one graph transition lacks complete chain continuity evidence.',
    );
  }
  return knownValue(true);
}

function minimum(values: readonly number[]): number {
  return Math.min(...values);
}

function conservativeFreshness(
  observations: readonly EntityInvestigationGraphTimelineObservation[],
): string | null {
  const values = observations.map((item) => item.metadata.freshness);
  if (values.some((item) => item === null)) return null;
  return (values as string[]).sort()[0] ?? null;
}

export function buildEntityInvestigationGraphTimeline(
  input: BuildEntityInvestigationGraphTimelineInput,
): EntityInvestigationGraphTimelineCore {
  if (input.sources.length < 2 || input.sources.length > 100) {
    throw new Error('Investigation graph timelines require between 2 and 100 graph reports.');
  }
  const parsedSources = input.sources
    .map((source) => ({ ...source, graph: EntityInvestigationGraphCoreSchema.parse(source.graph) }))
    .sort((left, right) => {
      const positionOrder = BigInt(position(left.graph)) - BigInt(position(right.graph));
      if (positionOrder !== 0n) return positionOrder < 0n ? -1 : 1;
      const capturedOrder = left.graph.metadata.snapshot.capturedAt.localeCompare(
        right.graph.metadata.snapshot.capturedAt,
      );
      return capturedOrder === 0 ? left.graphId.localeCompare(right.graphId) : capturedOrder;
    });
  if (new Set(parsedSources.map((item) => item.graphId)).size !== parsedSources.length) {
    throw new Error('Investigation graph timelines require unique graph identities.');
  }
  const first = parsedSources[0]!;
  if (
    parsedSources.some(
      (item) =>
        item.graph.request.ledger !== first.graph.request.ledger ||
        item.graph.request.chainId !== first.graph.request.chainId,
    )
  ) {
    throw new Error('Investigation graph timelines require one ledger and chain.');
  }
  const observations = parsedSources.map(observation);
  const transitions = observations.slice(1).map((after, index) => {
    const before = observations[index]!;
    const beforePosition = BigInt(position(parsedSources[index]!.graph));
    const afterPosition = BigInt(position(parsedSources[index + 1]!.graph));
    const beforePairs = new Map(
      before.pairs.map((pair) => [pairKey(pair.subjectA, pair.subjectB), pair.state]),
    );
    const afterPairs = new Map(
      after.pairs.map((pair) => [pairKey(pair.subjectA, pair.subjectB), pair.state]),
    );
    const allPairKeys = [...new Set([...beforePairs.keys(), ...afterPairs.keys()])].sort();
    const pairChanges = allPairKeys
      .map((key) => change(key, beforePairs.get(key), afterPairs.get(key)))
      .filter((item): item is EntityInvestigationGraphTimelinePairChange => item !== undefined);
    return {
      fromGraphId: before.graphId,
      toGraphId: after.graphId,
      fromPosition: beforePosition.toString(),
      toPosition: afterPosition.toString(),
      kind:
        beforePosition === afterPosition ? ('REVISION' as const) : ('POSITION_ADVANCE' as const),
      unobservedPositionCount:
        beforePosition === afterPosition ? '0' : (afterPosition - beforePosition - 1n).toString(),
      snapshotContinuity: snapshotContinuity(before, after),
      addedSubjectIds: after.subjectIds.filter((item) => !before.subjectIds.includes(item)),
      omittedSubjectIds: before.subjectIds.filter((item) => !after.subjectIds.includes(item)),
      pairChanges,
      unchangedPairCount: allPairKeys.length - pairChanges.length,
      evidenceIds: [before.terminalEvidenceId, after.terminalEvidenceId].sort() as [string, string],
      omittedSubjectsEstablishExit: false as const,
      omittedPairsEstablishRelationshipEnd: false as const,
      automaticEntityMembershipMutationAllowed: false as const,
    };
  });
  const latest = observations.at(-1)!;
  const graphIds = observations.map((item) => item.graphId);
  const evidenceIds = observations.map((item) => item.terminalEvidenceId).sort();
  const sourceSet = [...new Set(observations.flatMap((item) => item.metadata.sourceSet))].sort();
  return EntityInvestigationGraphTimelineCoreSchema.parse({
    request: {
      ledger: first.graph.request.ledger,
      chainId: first.graph.request.chainId,
      graphIds,
      graphSetHash: hashPayload(graphIds),
      fromPosition: position(parsedSources[0]!.graph),
      toPosition: position(parsedSources.at(-1)!.graph),
    },
    observations,
    transitions,
    summary: {
      observationCount: observations.length,
      transitionCount: transitions.length,
      subjectAdditionCount: transitions.reduce(
        (sum, transition) => sum + transition.addedSubjectIds.length,
        0,
      ),
      subjectOmissionCount: transitions.reduce(
        (sum, transition) => sum + transition.omittedSubjectIds.length,
        0,
      ),
      pairChangeCount: transitions.reduce(
        (sum, transition) => sum + transition.pairChanges.length,
        0,
      ),
      currentGraphId: latest.graphId,
      completeRequestedGraphSet: true,
      rawTransferEdgesCopied: false,
      absenceEstablishesRelationshipTermination: false,
      automaticEntityMembershipMutationAllowed: false,
      chainObservationContinuity: aggregateContinuity(
        transitions.map((item) => item.snapshotContinuity),
      ),
    },
    metadata: {
      snapshot: latest.metadata.snapshot,
      dataCoverage: minimum(observations.map((item) => item.metadata.dataCoverage)),
      sourceCoverage: minimum(observations.map((item) => item.metadata.sourceCoverage)),
      historyCoverage: minimum(observations.map((item) => item.metadata.historyCoverage)),
      simulationCoverage: minimum(observations.map((item) => item.metadata.simulationCoverage)),
      freshness: conservativeFreshness(observations),
      sourceSet,
      modelVersion: ENTITY_INVESTIGATION_GRAPH_TIMELINE_MODEL_VERSION,
      confidence: minimum(observations.map((item) => item.metadata.confidence)),
      evidenceIds,
    },
  });
}
