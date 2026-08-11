import { hashPayload } from '@zerotrace/evidence';
import {
  LabelIntelligenceCoreSchema,
  LabelIntelligenceRequestSchema,
  LabelIntelligenceSubjectSchema,
  LabelObservationSchema,
  knownValue,
  unknownValue,
  type LabelConflict,
  type LabelIntelligenceCore,
  type LabelIntelligenceRequest,
  type LabelIntelligenceSubject,
  type LabelObservation,
  type LabelObservationProjection,
  type LabelSourceClass,
  type LabelTemporalStatus,
} from '@zerotrace/schemas';

export const LABEL_INTELLIGENCE_MODEL_VERSION = 'label-intelligence-v0.1.0' as const;

const SOURCE_PRIORITY: Readonly<Record<LabelSourceClass, number>> = Object.freeze({
  DETERMINISTIC: 5,
  CURATED: 4,
  COMMERCIAL: 3,
  COMMUNITY: 2,
  INFERENCE: 1,
});

const SERVICE_HUB_CATEGORIES = new Set([
  'BOT_INFRASTRUCTURE',
  'BRIDGE',
  'CENTRALIZED_EXCHANGE',
  'CEX',
  'CUSTODIAN',
  'MEV_BUILDER',
  'MIXER',
  'SERVICE_HUB',
]);

const RISK_CATEGORIES = new Set([
  'ABUSE',
  'EXPLOIT',
  'MALWARE',
  'PHISHING',
  'RISK',
  'SANCTION',
  'SCAM',
]);

function canonicalText(value: string): string {
  return value.trim().toLocaleLowerCase('en-US');
}

function taxonomyKey(value: string): string {
  return value
    .trim()
    .toLocaleUpperCase('en-US')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function temporalStatus(
  observation: LabelObservation,
  request: LabelIntelligenceRequest,
): LabelTemporalStatus {
  const asOf = new Date(request.asOf).getTime();
  const observedAt = new Date(observation.observedAt).getTime();
  if (
    observedAt > asOf ||
    (observation.validFrom.state === 'known' &&
      new Date(observation.validFrom.value).getTime() > asOf)
  ) {
    return 'FUTURE';
  }
  if (
    observation.validTo.state === 'known' &&
    new Date(observation.validTo.value).getTime() < asOf
  ) {
    return 'EXPIRED';
  }
  return asOf - observedAt > request.staleAfterSeconds * 1_000 ? 'STALE' : 'ACTIVE';
}

function projection(
  observation: LabelObservation,
  request: LabelIntelligenceRequest,
): LabelObservationProjection {
  const category = taxonomyKey(observation.category);
  return {
    observation,
    temporalStatus: temporalStatus(observation, request),
    sourcePriority: SOURCE_PRIORITY[observation.sourceClass],
    serviceHubCandidate: SERVICE_HUB_CATEGORIES.has(category),
    riskLabel: RISK_CATEGORIES.has(category),
    inferenceLabel: observation.sourceClass === 'INFERENCE',
  };
}

const TEMPORAL_PRIORITY: Readonly<Record<LabelTemporalStatus, number>> = Object.freeze({
  ACTIVE: 0,
  STALE: 1,
  FUTURE: 2,
  EXPIRED: 3,
});

function compareProjection(
  left: LabelObservationProjection,
  right: LabelObservationProjection,
): number {
  return (
    TEMPORAL_PRIORITY[left.temporalStatus] - TEMPORAL_PRIORITY[right.temporalStatus] ||
    right.sourcePriority - left.sourcePriority ||
    Number(right.observation.deterministic) - Number(left.observation.deterministic) ||
    right.observation.sourceConfidence - left.observation.sourceConfidence ||
    new Date(right.observation.observedAt).getTime() -
      new Date(left.observation.observedAt).getTime() ||
    left.observation.id.localeCompare(right.observation.id)
  );
}

interface ConflictCandidate {
  dimension: LabelConflict['dimension'];
  key: string;
  values: Map<string, LabelObservationProjection[]>;
}

function conflictFrom(candidate: ConflictCandidate): LabelConflict | undefined {
  const values = [...candidate.values.keys()].sort();
  if (values.length < 2) return undefined;
  const observations = [...candidate.values.values()].flat();
  const observationIds = [...new Set(observations.map((item) => item.observation.id))].sort();
  const highestPriority = Math.max(...observations.map((item) => item.sourcePriority));
  const highestPriorityObservationIds = [
    ...new Set(
      observations
        .filter((item) => item.sourcePriority === highestPriority)
        .map((item) => item.observation.id),
    ),
  ].sort();
  return {
    id: `lcf_${hashPayload({
      schema: 'zerotrace-label-conflict-v1',
      dimension: candidate.dimension,
      key: candidate.key,
      values,
      observationIds,
    }).slice(0, 24)}`,
    dimension: candidate.dimension,
    key: candidate.key,
    values,
    observationIds,
    highestPriorityObservationIds,
    disposition: 'PRESERVED',
  };
}

function collectConflicts(projections: readonly LabelObservationProjection[]): LabelConflict[] {
  const eligible = projections.filter((item) => ['ACTIVE', 'STALE'].includes(item.temporalStatus));
  const candidates = new Map<string, ConflictCandidate>();
  const add = (
    dimension: LabelConflict['dimension'],
    key: string,
    value: string,
    item: LabelObservationProjection,
  ) => {
    const candidateKey = `${dimension}:${key}`;
    const candidate = candidates.get(candidateKey) ?? {
      dimension,
      key,
      values: new Map<string, LabelObservationProjection[]>(),
    };
    const items = candidate.values.get(value) ?? [];
    items.push(item);
    candidate.values.set(value, items);
    candidates.set(candidateKey, candidate);
  };

  for (const item of eligible) {
    const category = canonicalText(item.observation.category);
    const label = canonicalText(item.observation.label);
    add('LABEL_VALUE', category, label, item);
    if (item.observation.actorCandidate.state === 'known') {
      add('ACTOR_CANDIDATE', category, canonicalText(item.observation.actorCandidate.value), item);
    }
    add(
      'DETERMINISM',
      `${category}:${label}`,
      item.observation.deterministic ? 'deterministic' : 'non-deterministic',
      item,
    );
  }

  return [...candidates.values()]
    .map(conflictFrom)
    .filter((item): item is LabelConflict => item !== undefined)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function ensureObservationIdentity(
  subject: LabelIntelligenceSubject,
  observations: readonly LabelObservation[],
): void {
  if (
    observations.some(
      (observation) =>
        observation.subjectId !== subject.id ||
        observation.ledger !== subject.ledger ||
        observation.chainId !== subject.chainId ||
        observation.subjectType !== subject.subjectType ||
        observation.normalizedIdentifier !== subject.normalizedIdentifier,
    )
  ) {
    throw new Error('Every Label observation must belong to the requested ledger-scoped Subject.');
  }
}

export interface BuildLabelIntelligenceInput {
  subject: LabelIntelligenceSubject;
  observations: readonly LabelObservation[];
  request: LabelIntelligenceRequest;
}

export function buildLabelIntelligenceCore(
  input: BuildLabelIntelligenceInput,
): LabelIntelligenceCore {
  const subject = LabelIntelligenceSubjectSchema.parse(input.subject);
  const request = LabelIntelligenceRequestSchema.parse(input.request);
  if (
    subject.ledger !== request.ledger ||
    subject.chainId !== request.chainId ||
    subject.subjectType !== request.subjectType ||
    subject.normalizedIdentifier !== request.normalizedIdentifier
  ) {
    throw new Error('Label Intelligence request does not identify the supplied Subject.');
  }
  const observations = input.observations.map((item) => LabelObservationSchema.parse(item));
  if (observations.length === 0 || observations.length > 5_000) {
    throw new Error('Label Intelligence requires between one and 5,000 durable observations.');
  }
  const observationIds = observations.map((item) => item.id);
  if (new Set(observationIds).size !== observationIds.length) {
    throw new Error('Label Intelligence observations must be unique.');
  }
  ensureObservationIdentity(subject, observations);

  const projections = observations.map((item) => projection(item, request));
  const ranked = [...projections].sort(compareProjection);
  const conflicts = collectConflicts(projections);
  const canonicalObservationIds = [...observationIds].sort();
  const observationSetHash = hashPayload({
    schema: 'zerotrace-label-observation-set-v1',
    subject,
    request,
    observations: [...observations].sort((left, right) => left.id.localeCompare(right.id)),
  });
  const snapshot = {
    id: `lss_${hashPayload({ schema: 'zerotrace-label-snapshot-v1', observationSetHash }).slice(
      0,
      24,
    )}`,
    asOf: request.asOf,
    observationIds: canonicalObservationIds,
    observationSetHash,
  };
  const sourceEvidenceIds = [...new Set(observations.flatMap((item) => item.evidenceIds))].sort();
  const sourceSet = [...new Set(observations.map((item) => item.source))].sort();
  const serviceHubItems = projections.filter(
    (item) => item.serviceHubCandidate && !['FUTURE', 'EXPIRED'].includes(item.temporalStatus),
  );
  const serviceHubEvidenceIds = [
    ...new Set(serviceHubItems.flatMap((item) => item.observation.evidenceIds)),
  ].sort();
  const nonFuture = projections.filter((item) => item.temporalStatus !== 'FUTURE');
  const latestObservedAt = nonFuture
    .map((item) => item.observation.observedAt)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
  const active = projections.filter((item) => item.temporalStatus === 'ACTIVE');
  const conclusionConfidence =
    conflicts.length > 0
      ? unknownValue(
          'CONFLICTING_SOURCES',
          'Conflicting Label observations are preserved and no winning label is selected.',
        )
      : active.length === 0
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'No active Label observation exists at the requested Label Snapshot.',
          )
        : knownValue(Math.max(...active.map((item) => item.observation.sourceConfidence)));

  return LabelIntelligenceCoreSchema.parse({
    subject,
    request,
    snapshot,
    observations: [...projections].sort((left, right) =>
      left.observation.id.localeCompare(right.observation.id),
    ),
    rankedObservationIds: ranked.map((item) => item.observation.id),
    conflicts,
    serviceHubSuppression: {
      applied: serviceHubItems.length > 0,
      evidenceIds: serviceHubEvidenceIds,
      reason:
        serviceHubItems.length > 0
          ? knownValue('SERVICE_HUB_OBSERVATION' as const)
          : unknownValue(
              'NOT_QUERIED',
              'The requested observation set contains no current Service Hub observation; absence is not proof of non-service status.',
            ),
    },
    summary: {
      observationCount: projections.length,
      activeCount: active.length,
      staleCount: projections.filter((item) => item.temporalStatus === 'STALE').length,
      expiredCount: projections.filter((item) => item.temporalStatus === 'EXPIRED').length,
      futureCount: projections.filter((item) => item.temporalStatus === 'FUTURE').length,
      deterministicCount: projections.filter((item) => item.observation.deterministic).length,
      inferenceCount: projections.filter((item) => item.inferenceLabel).length,
      conflictCount: conflicts.length,
      sourceClassCount: new Set(projections.map((item) => item.observation.sourceClass)).size,
    },
    metadata: {
      modelVersion: LABEL_INTELLIGENCE_MODEL_VERSION,
      freshness:
        latestObservedAt === undefined
          ? unknownValue('INSUFFICIENT_DATA', 'No observation existed at or before the Snapshot.')
          : knownValue(latestObservedAt),
      conclusionConfidence,
      requestedObservationSetCoverage: knownValue(1 as const),
      globalSourceCoverage: unknownValue(
        'NOT_QUERIED',
        'This report covers the complete requested durable observation set, not every external Label source.',
      ),
      historyCoverage: unknownValue(
        'NOT_QUERIED',
        'Append-only observations do not prove complete historical label coverage.',
      ),
      sourceSet,
      evidenceIds: sourceEvidenceIds,
    },
    automaticEntityMergeAllowed: false,
    riskLabelOwnershipInferenceAllowed: false,
    crossChainSameLabelMergeAllowed: false,
  });
}
