import {
  knownValue,
  unknownValue,
  type EntityFeature as SchemaEntityFeature,
  type EntityFeatureKind as SchemaEntityFeatureKind,
  type EntityRelationshipInput,
  type EntityResolution,
} from '@zerotrace/schemas';

export * from './evaluation.js';

export const ENTITY_RELATIONSHIP_MODEL_VERSION = 'entity-v0.1.0' as const;
export type EntityFeatureKind = SchemaEntityFeatureKind;
export type EntityFeature = SchemaEntityFeature;

interface FeatureWeights {
  sameController: number;
  coordination: number;
  independence: number;
}

const WEIGHTS: Record<EntityFeatureKind, FeatureWeights> = {
  SHARED_ONCHAIN_AUTHORITY: { sameController: 7, coordination: 1, independence: -6 },
  COMMON_FUNDER: { sameController: 1.6, coordination: 0.7, independence: -0.8 },
  SHARED_FEE_PAYER: { sameController: 2, coordination: 1, independence: -1 },
  SETTLEMENT_CONVERGENCE: { sameController: 2.4, coordination: 1.4, independence: -1.5 },
  TRANSACTION_GRAMMAR: { sameController: 1.1, coordination: 1.2, independence: -0.5 },
  TIMING_SYNCHRONY: { sameController: 0.7, coordination: 1.8, independence: -0.4 },
  EARLY_BUYER_COHORT: { sameController: 0.2, coordination: 0.9, independence: 0 },
  TOKEN_DISTRIBUTION: { sameController: 1.5, coordination: 0.8, independence: -0.8 },
  INDEPENDENT_HISTORY: { sameController: -3, coordination: -0.5, independence: 3 },
  DISTINCT_FUNDING: { sameController: -1.8, coordination: -0.1, independence: 1.6 },
  DISTINCT_SETTLEMENT: { sameController: -2, coordination: -0.4, independence: 1.8 },
  CEX_PATH_BREAK: { sameController: -2.5, coordination: -0.7, independence: 1 },
  SERVICE_HUB: { sameController: -8, coordination: -4, independence: 0 },
  COINJOIN: { sameController: -10, coordination: -4, independence: 0 },
  BOT_COMMON_INFRASTRUCTURE: { sameController: -4, coordination: -2, independence: 0.4 },
};

const NEGATIVE_FEATURES = new Set<EntityFeatureKind>([
  'INDEPENDENT_HISTORY',
  'DISTINCT_FUNDING',
  'DISTINCT_SETTLEMENT',
  'CEX_PATH_BREAK',
  'SERVICE_HUB',
  'COINJOIN',
  'BOT_COMMON_INFRASTRUCTURE',
]);

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function roundedProbability(value: number): number {
  return Number(Math.min(1, Math.max(0, value)).toFixed(6));
}

export type ResolveEntityInput = EntityRelationshipInput;

function featureIdentity(feature: EntityFeature): string {
  return [feature.kind, feature.evidenceId, feature.strength, feature.reliability].join(':');
}

export function canonicalizeEntityRelationshipInput(input: ResolveEntityInput): ResolveEntityInput {
  const subjectsInOrder = input.subjectA < input.subjectB;
  const features = [...input.features]
    .sort((left, right) => featureIdentity(left).localeCompare(featureIdentity(right)))
    .filter(
      (feature, index, items) =>
        index === 0 ||
        feature.kind !== items[index - 1]?.kind ||
        feature.evidenceId !== items[index - 1]?.evidenceId,
    );
  const evidenceIds = [
    ...new Set([...input.metadata.evidenceIds, ...features.map((feature) => feature.evidenceId)]),
  ].sort();
  return {
    subjectA: subjectsInOrder ? input.subjectA : input.subjectB,
    subjectB: subjectsInOrder ? input.subjectB : input.subjectA,
    features,
    metadata: {
      ...input.metadata,
      sourceSet: [...new Set(input.metadata.sourceSet)].sort(),
      evidenceIds,
    },
    ...(subjectsInOrder
      ? {
          ...(input.subjectAIsService === undefined
            ? {}
            : { subjectAIsService: input.subjectAIsService }),
          ...(input.subjectBIsService === undefined
            ? {}
            : { subjectBIsService: input.subjectBIsService }),
        }
      : {
          ...(input.subjectBIsService === undefined
            ? {}
            : { subjectAIsService: input.subjectBIsService }),
          ...(input.subjectAIsService === undefined
            ? {}
            : { subjectBIsService: input.subjectAIsService }),
        }),
  };
}

export function resolveEntityRelationship(input: ResolveEntityInput): EntityResolution {
  const canonicalInput = canonicalizeEntityRelationshipInput(input);
  const groundedFeatures = canonicalInput.features.filter(
    (feature) =>
      feature.evidenceId.length > 0 &&
      Number.isFinite(feature.strength) &&
      feature.strength >= 0 &&
      feature.strength <= 1 &&
      Number.isFinite(feature.reliability) &&
      feature.reliability >= 0 &&
      feature.reliability <= 1,
  );
  const evidenceIds = [
    ...new Set([
      ...canonicalInput.metadata.evidenceIds,
      ...groundedFeatures.map((feature) => feature.evidenceId),
    ]),
  ].sort();
  const positiveEvidenceIds = groundedFeatures
    .filter((feature) => !NEGATIVE_FEATURES.has(feature.kind))
    .map((feature) => feature.evidenceId)
    .filter((id, index, items) => items.indexOf(id) === index)
    .sort();
  const negativeEvidenceIds = groundedFeatures
    .filter((feature) => NEGATIVE_FEATURES.has(feature.kind))
    .map((feature) => feature.evidenceId)
    .filter((id, index, items) => items.indexOf(id) === index)
    .sort();
  const serviceSuppression = groundedFeatures.some((feature) => feature.kind === 'SERVICE_HUB');
  const coinjoinSuppression = groundedFeatures.some((feature) => feature.kind === 'COINJOIN');
  const botInfrastructure = groundedFeatures.some(
    (feature) => feature.kind === 'BOT_COMMON_INFRASTRUCTURE',
  );
  const deterministicControl = groundedFeatures.some(
    (feature) =>
      feature.kind === 'SHARED_ONCHAIN_AUTHORITY' &&
      feature.strength >= 0.95 &&
      feature.reliability >= 0.98,
  );

  const metadata = {
    ...canonicalInput.metadata,
    modelVersion: ENTITY_RELATIONSHIP_MODEL_VERSION,
    evidenceIds,
  };

  if (groundedFeatures.length === 0) {
    return {
      subjectA: canonicalInput.subjectA,
      subjectB: canonicalInput.subjectB,
      classification: 'UNKNOWN',
      sameControllerProbability: unknownValue('INSUFFICIENT_DATA'),
      coordinationProbability: unknownValue('INSUFFICIENT_DATA'),
      independenceProbability: unknownValue('INSUFFICIENT_DATA'),
      positiveEvidenceIds: [],
      negativeEvidenceIds: [],
      serviceSuppressionApplied: false,
      metadata,
    };
  }

  let sameScore = -3.7;
  let coordinationScore = -3.2;
  let independenceScore = -2.3;
  for (const feature of groundedFeatures) {
    const effectiveStrength = feature.strength * feature.reliability;
    const weights = WEIGHTS[feature.kind];
    sameScore += weights.sameController * effectiveStrength;
    coordinationScore += weights.coordination * effectiveStrength;
    independenceScore += weights.independence * effectiveStrength;
  }

  let same = roundedProbability(sigmoid(sameScore));
  let coordination = roundedProbability(sigmoid(coordinationScore));
  const independence = roundedProbability(sigmoid(independenceScore));

  if (serviceSuppression && !deterministicControl) {
    same = Math.min(same, 0.01);
    coordination = Math.min(coordination, 0.05);
  }
  if (coinjoinSuppression && !deterministicControl) {
    same = Math.min(same, 0.001);
    coordination = Math.min(coordination, 0.02);
  }

  let classification: EntityResolution['classification'] = 'UNKNOWN';
  if (deterministicControl) classification = 'CONFIRMED_SAME_CONTROLLER';
  else if (serviceSuppression) classification = 'SERVICE_INFRASTRUCTURE';
  else if (botInfrastructure) classification = 'BOT_MM_ARBITRAGE';
  else if (same >= 0.98 && groundedFeatures.length >= 3)
    classification = 'HIGHLY_PROBABLE_SAME_CONTROLLER';
  else if (same >= 0.9 && groundedFeatures.length >= 2) classification = 'PROBABLE_SAME_CONTROLLER';
  else if (coordination >= 0.95 && same < 0.75) classification = 'COORDINATED_BUT_INDEPENDENT';
  else if (independence >= 0.9 && same < 0.2) classification = 'LIKELY_INDEPENDENT';

  return {
    subjectA: canonicalInput.subjectA,
    subjectB: canonicalInput.subjectB,
    classification,
    sameControllerProbability: knownValue(same),
    coordinationProbability: knownValue(coordination),
    independenceProbability: knownValue(independence),
    positiveEvidenceIds,
    negativeEvidenceIds,
    serviceSuppressionApplied: (serviceSuppression || coinjoinSuppression) && !deterministicControl,
    metadata,
  };
}
