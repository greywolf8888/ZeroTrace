import { z } from 'zod';
export * from './part-05.js';
import type {
  Evidence,
} from './part-05.js';
import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  ConfidenceSchema,
  EvidenceSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  LabelIntelligenceReportSchema,
  LedgerSchema,
  SubjectTypeSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
  knownValue,
  unavailableValue,
  unknownValue,
} from './part-05.js';

export type LabelIntelligenceReport = z.infer<typeof LabelIntelligenceReportSchema>;

export const GlobalIntelligenceSearchRecordTypeSchema = z.enum([
  'LABEL_OBSERVATION',
  'LABEL_INTELLIGENCE',
  'EVM_CLAIM_REPORT',
  'EVM_CONTROL_SURFACE',
  'SOLANA_CONTROL_SURFACE',
  'SOLANA_TRANSACTION',
  'EVM_PENSION_CANDIDATE',
  'FLAP_PENSION_ENTRY',
  'ENTITY_RELATIONSHIP',
  'ENTITY_RELATIONSHIP_TIMELINE',
  'ENTITY_INVESTIGATION_GRAPH',
  'ENTITY_INVESTIGATION_GRAPH_TIMELINE',
]);
export type GlobalIntelligenceSearchRecordType = z.infer<
  typeof GlobalIntelligenceSearchRecordTypeSchema
>;

export const GlobalIntelligenceSearchLabelSchema = z
  .object({
    id: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    label: z.string().trim().min(1).max(512),
    category: z.string().trim().min(1).max(256),
    source: z.string().trim().min(1).max(512),
    sourceClass: z.enum(['DETERMINISTIC', 'CURATED', 'COMMERCIAL', 'COMMUNITY', 'INFERENCE']),
    actorCandidate: knowledgeValueSchema(z.string().trim().min(1).max(512)),
    sourceConfidence: ConfidenceSchema,
    evidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    observedAt: IsoDateTimeSchema,
    deterministic: z.boolean(),
    licensePolicy: z.string().trim().min(1).max(512),
  })
  .strict();
export type GlobalIntelligenceSearchLabel = z.infer<typeof GlobalIntelligenceSearchLabelSchema>;

export const GlobalIntelligenceSearchEntityCandidateSchema = z
  .object({
    entityId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
    classification: z.string().trim().min(1).max(256),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    membershipClass: z.string().trim().min(1).max(256),
    membershipProbability: knowledgeValueSchema(ConfidenceSchema),
    evidenceIds: z
      .array(z.string().regex(/^ev_[0-9a-f]{24}$/))
      .min(1)
      .max(1_000),
    modelVersion: z.string().trim().min(1).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.evidenceIds.length !== new Set(value.evidenceIds).size ||
      value.evidenceIds.some(
        (evidenceId, index) => evidenceId !== [...value.evidenceIds].sort()[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Search Entity candidates require canonical unique Evidence IDs.',
      });
    }
  });
export type GlobalIntelligenceSearchEntityCandidate = z.infer<
  typeof GlobalIntelligenceSearchEntityCandidateSchema
>;

export const GlobalIntelligenceSearchSnapshotSchema = z
  .object({
    position: UnsignedQuantityStringSchema,
    hash: z.string().trim().min(1).max(256),
  })
  .strict();
export type GlobalIntelligenceSearchSnapshot = z.infer<
  typeof GlobalIntelligenceSearchSnapshotSchema
>;

export const GlobalIntelligenceSearchMatchSchema = z
  .object({
    documentId: z.string().regex(/^isr_[0-9a-f]{24}$/),
    ledger: LedgerSchema,
    chainId: z.string().trim().min(1).max(128),
    normalizedIdentifier: z.string().trim().min(1).max(512),
    subjectType: knowledgeValueSchema(SubjectTypeSchema),
    matchedBy: z.enum(['IDENTIFIER', 'LABEL', 'LABEL_CATEGORY']),
    recordType: GlobalIntelligenceSearchRecordTypeSchema,
    recordId: z.string().trim().min(1).max(512),
    role: z.string().trim().min(1).max(128),
    snapshot: knowledgeValueSchema(GlobalIntelligenceSearchSnapshotSchema),
    analysisConfidence: knowledgeValueSchema(ConfidenceSchema),
    freshness: knowledgeValueSchema(IsoDateTimeSchema),
    labels: knowledgeValueSchema(z.array(GlobalIntelligenceSearchLabelSchema).max(1_000)),
    entities: knowledgeValueSchema(
      z.array(GlobalIntelligenceSearchEntityCandidateSchema).max(1_000),
    ),
    terminalEvidence: EvidenceSchema,
    sourceSet: z.array(z.string().trim().min(1).max(512)).min(1).max(1_000),
    modelVersion: z.string().trim().min(1).max(256),
  })
  .strict()
  .superRefine((value, context) => {
    const invalidSubjectType =
      value.subjectType.state === 'known' && value.subjectType.value === 'UNKNOWN';
    const invalidSourceSet =
      value.sourceSet.length !== new Set(value.sourceSet).size ||
      value.sourceSet.some((source, index) => source !== [...value.sourceSet].sort()[index]);
    const labelMatchWithoutLabel =
      value.matchedBy !== 'IDENTIFIER' &&
      (value.labels.state !== 'known' || value.labels.value.length === 0);
    if (
      invalidSubjectType ||
      invalidSourceSet ||
      labelMatchWithoutLabel ||
      value.terminalEvidence.ledger !== value.ledger ||
      value.terminalEvidence.chainId !== value.chainId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['recordType'],
        message:
          'Search matches require canonical provenance, explicit unknown subject types, and ledger-consistent terminal Evidence.',
      });
    }
  });
export type GlobalIntelligenceSearchMatch = z.infer<typeof GlobalIntelligenceSearchMatchSchema>;

export const GlobalIntelligenceSearchProjectionSchema = z
  .object({
    query: z.string().trim().min(1).max(512),
    coverageScope: z.literal('IMMUTABLE_REPORTS_AND_REGISTERED_LABELS_V1'),
    matches: z.array(GlobalIntelligenceSearchMatchSchema).max(100),
    matchCount: z.number().int().nonnegative().max(100),
    truncated: z.boolean(),
    indexedRecordTypes: z.array(GlobalIntelligenceSearchRecordTypeSchema),
    terminalEvidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedRecordTypes = [...GlobalIntelligenceSearchRecordTypeSchema.options].sort();
    const expectedEvidenceIds = [
      ...new Set(value.matches.map((match) => match.terminalEvidence.id)),
    ].sort();
    if (
      value.matchCount !== value.matches.length ||
      value.matches.length !== new Set(value.matches.map((match) => match.documentId)).size ||
      value.indexedRecordTypes.length !== expectedRecordTypes.length ||
      value.indexedRecordTypes.some(
        (recordType, index) => recordType !== expectedRecordTypes[index],
      ) ||
      value.terminalEvidenceIds.length !== expectedEvidenceIds.length ||
      value.terminalEvidenceIds.some(
        (evidenceId, index) => evidenceId !== expectedEvidenceIds[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['matches'],
        message:
          'Search projections require unique matches, exact counts, complete index scope, and canonical terminal Evidence IDs.',
      });
    }
  });
export type GlobalIntelligenceSearchProjection = z.infer<
  typeof GlobalIntelligenceSearchProjectionSchema
>;

export const EntityResolutionClassSchema = z.enum([
  'CONFIRMED_SAME_CONTROLLER',
  'HIGHLY_PROBABLE_SAME_CONTROLLER',
  'PROBABLE_SAME_CONTROLLER',
  'COORDINATED_BUT_INDEPENDENT',
  'LIKELY_INDEPENDENT',
  'SERVICE_INFRASTRUCTURE',
  'BOT_MM_ARBITRAGE',
  'UNKNOWN',
]);
export const EntityFeatureKindSchema = z.enum([
  'SHARED_ONCHAIN_AUTHORITY',
  'COMMON_FUNDER',
  'SHARED_FEE_PAYER',
  'SETTLEMENT_CONVERGENCE',
  'TRANSACTION_GRAMMAR',
  'TIMING_SYNCHRONY',
  'EARLY_BUYER_COHORT',
  'TOKEN_DISTRIBUTION',
  'INDEPENDENT_HISTORY',
  'DISTINCT_FUNDING',
  'DISTINCT_SETTLEMENT',
  'CEX_PATH_BREAK',
  'SERVICE_HUB',
  'COINJOIN',
  'BOT_COMMON_INFRASTRUCTURE',
  'FIRST_FUNDING_COMMON_SOURCE',
  'REPEATED_GAS_TOPUP_SOURCE',
  'FUNDING_TIMING_SYNCHRONY',
  'FUNDING_AMOUNT_SIGNATURE',
  'TOKEN_FAN_OUT',
  'TOKEN_FAN_IN',
  'POST_DISTRIBUTION_ACTION_SYNC',
  'ROUTER_METHOD_SIMILARITY',
  'FINAL_SWEEP',
  'QUOTE_ASSET_CONVERGENCE',
  'NATIVE_ASSET_CONVERGENCE',
]);
export type EntityFeatureKind = z.infer<typeof EntityFeatureKindSchema>;

export const EntityFeatureSchema = z
  .object({
    kind: EntityFeatureKindSchema,
    strength: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    evidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  })
  .strict();
export type EntityFeature = z.infer<typeof EntityFeatureSchema>;

export const EntityRelationshipInputSchema = z
  .object({
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    features: z.array(EntityFeatureSchema).max(1_000),
    metadata: AnalysisMetadataSchema,
    subjectAIsService: z.boolean().optional(),
    subjectBIsService: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subjectA === value.subjectB) {
      context.addIssue({
        code: 'custom',
        path: ['subjectB'],
        message: 'Entity relationship subjects must be distinct.',
      });
    }
    const featureIdentities = value.features.map(
      (feature) => `${feature.kind}:${feature.evidenceId}`,
    );
    if (new Set(featureIdentities).size !== featureIdentities.length) {
      context.addIssue({
        code: 'custom',
        path: ['features'],
        message: 'Entity features may not repeat one kind/Evidence identity.',
      });
    }
    if (
      (value.subjectAIsService === true || value.subjectBIsService === true) &&
      !value.features.some((feature) => feature.kind === 'SERVICE_HUB')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['features'],
        message: 'Service status requires a SERVICE_HUB feature with Evidence.',
      });
    }
  });
export type EntityRelationshipInput = z.infer<typeof EntityRelationshipInputSchema>;

export const EntityResolutionSchema = z.object({
  subjectA: z.string().min(1),
  subjectB: z.string().min(1),
  classification: EntityResolutionClassSchema,
  sameControllerProbability: knowledgeValueSchema(ConfidenceSchema),
  coordinationProbability: knowledgeValueSchema(ConfidenceSchema),
  independenceProbability: knowledgeValueSchema(ConfidenceSchema),
  positiveEvidenceIds: z.array(z.string()),
  negativeEvidenceIds: z.array(z.string()),
  serviceSuppressionApplied: z.boolean(),
  metadata: AnalysisMetadataSchema,
});
export type EntityResolution = z.infer<typeof EntityResolutionSchema>;

export const EntityRelationshipReportSchema = z
  .object({
    schemaVersion: z.literal('entity-relationship-report-v1'),
    automaticOwnershipMergeAllowed: z.literal(false),
    input: EntityRelationshipInputSchema.safeExtend({
      features: z.array(EntityFeatureSchema).min(1).max(1_000),
      metadata: AnalysisMetadataSchema.extend({
        snapshot: AnalysisSnapshotSchema,
      }),
    }),
    result: EntityResolutionSchema.extend({
      metadata: AnalysisMetadataSchema.extend({
        snapshot: AnalysisSnapshotSchema,
        modelVersion: z.literal('entity-v0.1.0'),
      }),
    }),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidence: z.array(EvidenceSchema).min(2),
  })
  .strict()
  .superRefine((value, context) => {
    const snapshot = value.input.metadata.snapshot;
    const position =
      snapshot.ledger === 'EVM'
        ? { value: snapshot.blockNumber, finality: snapshot.finality }
        : snapshot.ledger === 'BITCOIN'
          ? { value: snapshot.height, finality: snapshot.finality }
          : { value: snapshot.slot, finality: snapshot.commitment };
    const featureOrder = [...value.input.features].sort((left, right) =>
      [left.kind, left.evidenceId, left.strength, left.reliability]
        .join(':')
        .localeCompare([right.kind, right.evidenceId, right.strength, right.reliability].join(':')),
    );
    const evidenceIds = value.evidence.map((item) => item.id);
    const expectedSourceIds = [
      ...new Set([
        ...value.input.metadata.evidenceIds,
        ...value.input.features.map((feature) => feature.evidenceId),
      ]),
    ].sort();
    const expectedResultEvidenceIds = [...expectedSourceIds, value.terminalEvidenceId].sort();
    const expectedSourceSet = [...new Set(value.input.metadata.sourceSet)].sort();
    const positiveEvidenceIds = [...value.result.positiveEvidenceIds].sort();
    const negativeEvidenceIds = [...value.result.negativeEvidenceIds].sort();
    const expectedSuppression =
      value.input.features.some((feature) => ['SERVICE_HUB', 'COINJOIN'].includes(feature.kind)) &&
      !value.input.features.some(
        (feature) =>
          feature.kind === 'SHARED_ONCHAIN_AUTHORITY' &&
          feature.strength >= 0.95 &&
          feature.reliability >= 0.98,
      );
    const terminal = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    const expectedLocator = `entity-relationship:${value.input.subjectA}:${value.input.subjectB}`;
    const issues =
      value.input.subjectA >= value.input.subjectB ||
      value.input.features.some((item, index) => item !== featureOrder[index]) ||
      value.result.subjectA !== value.input.subjectA ||
      value.result.subjectB !== value.input.subjectB ||
      JSON.stringify(value.result.metadata.snapshot) !== JSON.stringify(snapshot) ||
      value.result.metadata.dataCoverage !== value.input.metadata.dataCoverage ||
      value.result.metadata.sourceCoverage !== value.input.metadata.sourceCoverage ||
      value.result.metadata.historyCoverage !== value.input.metadata.historyCoverage ||
      value.result.metadata.simulationCoverage !== value.input.metadata.simulationCoverage ||
      value.result.metadata.freshness !== value.input.metadata.freshness ||
      value.result.metadata.confidence !== value.input.metadata.confidence ||
      value.input.metadata.sourceSet.length !== expectedSourceSet.length ||
      value.input.metadata.sourceSet.some((item, index) => item !== expectedSourceSet[index]) ||
      value.result.metadata.sourceSet.length !== expectedSourceSet.length ||
      value.result.metadata.sourceSet.some((item, index) => item !== expectedSourceSet[index]) ||
      value.input.metadata.evidenceIds.length !== expectedSourceIds.length ||
      value.input.metadata.evidenceIds.some((item, index) => item !== expectedSourceIds[index]) ||
      value.result.metadata.evidenceIds.length !== expectedResultEvidenceIds.length ||
      value.result.metadata.evidenceIds.some(
        (item, index) => item !== expectedResultEvidenceIds[index],
      ) ||
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((item, index) => item !== [...evidenceIds].sort()[index]) ||
      evidenceIds.length !== expectedResultEvidenceIds.length ||
      evidenceIds.some((item, index) => item !== expectedResultEvidenceIds[index]) ||
      value.result.positiveEvidenceIds.length !== new Set(positiveEvidenceIds).size ||
      value.result.positiveEvidenceIds.some(
        (item, index) => item !== positiveEvidenceIds[index] || !expectedSourceIds.includes(item),
      ) ||
      value.result.negativeEvidenceIds.length !== new Set(negativeEvidenceIds).size ||
      value.result.negativeEvidenceIds.some(
        (item, index) => item !== negativeEvidenceIds[index] || !expectedSourceIds.includes(item),
      ) ||
      value.result.serviceSuppressionApplied !== expectedSuppression ||
      terminal?.kind !== 'DERIVED_FEATURE' ||
      terminal.source !== 'zerotrace:entity-v0.1.0' ||
      terminal.locator !== expectedLocator ||
      value.evidence.some(
        (item) =>
          item.ledger !== snapshot.ledger ||
          item.chainId !== snapshot.chainId ||
          item.blockOrSlot !== position.value ||
          item.finality !== position.finality,
      );
    if (issues) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message:
          'Entity relationship reports require a canonical distinct pair, ordered unique features, one Snapshot, complete direct Evidence, and a valid terminal derivation.',
      });
    }
  });
export type EntityRelationshipReport = z.infer<typeof EntityRelationshipReportSchema>;

export const EntityRelationshipTimelineObservationSchema = z
  .object({
    reportId: z.string().regex(/^erh_[0-9a-f]{24}$/),
    resultHash: Hash256Schema,
    snapshot: AnalysisSnapshotSchema,
    classification: EntityResolutionClassSchema,
    sameControllerProbability: knowledgeValueSchema(ConfidenceSchema),
    coordinationProbability: knowledgeValueSchema(ConfidenceSchema),
    independenceProbability: knowledgeValueSchema(ConfidenceSchema),
    serviceSuppressionApplied: z.boolean(),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    capturedAt: IsoDateTimeSchema,
  })
  .strict();
export type EntityRelationshipTimelineObservation = z.infer<
  typeof EntityRelationshipTimelineObservationSchema
>;

export const EntityRelationshipTimelineTransitionSchema = z
  .object({
    fromReportId: z.string().regex(/^erh_[0-9a-f]{24}$/),
    toReportId: z.string().regex(/^erh_[0-9a-f]{24}$/),
    fromPosition: UnsignedQuantityStringSchema,
    toPosition: UnsignedQuantityStringSchema,
    kind: z.enum(['REVISION', 'POSITION_ADVANCE']),
    unobservedPositionCount: UnsignedQuantityStringSchema,
    classificationBefore: EntityResolutionClassSchema,
    classificationAfter: EntityResolutionClassSchema,
    classificationChanged: z.boolean(),
    serviceSuppressionBefore: z.boolean(),
    serviceSuppressionAfter: z.boolean(),
    serviceSuppressionChanged: z.boolean(),
    sameControllerDelta: knowledgeValueSchema(z.number().min(-1).max(1)),
    coordinationDelta: knowledgeValueSchema(z.number().min(-1).max(1)),
    independenceDelta: knowledgeValueSchema(z.number().min(-1).max(1)),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).length(2),
  })
  .strict();
export type EntityRelationshipTimelineTransition = z.infer<
  typeof EntityRelationshipTimelineTransitionSchema
>;

export const EntityRelationshipTimelineRequestSchema = z
  .object({
    ledger: LedgerSchema,
    chainId: z.string().trim().min(1).max(128),
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    fromPosition: UnsignedQuantityStringSchema,
    toPosition: UnsignedQuantityStringSchema,
  })
  .strict();
export type EntityRelationshipTimelineRequest = z.infer<
  typeof EntityRelationshipTimelineRequestSchema
>;

export const EntityRelationshipTimelineCoreSchema = z
  .object({
    request: EntityRelationshipTimelineRequestSchema,
    observations: z.array(EntityRelationshipTimelineObservationSchema).min(2).max(1_000),
    transitions: z.array(EntityRelationshipTimelineTransitionSchema).min(1).max(999),
    summary: z
      .object({
        observationCount: z.number().int().min(2).max(1_000),
        transitionCount: z.number().int().min(1).max(999),
        classificationChangeCount: z.number().int().nonnegative(),
        serviceSuppressionChangeCount: z.number().int().nonnegative(),
        currentClassification: EntityResolutionClassSchema,
        currentSameControllerProbability: knowledgeValueSchema(ConfidenceSchema),
        currentCoordinationProbability: knowledgeValueSchema(ConfidenceSchema),
        currentIndependenceProbability: knowledgeValueSchema(ConfidenceSchema),
        completePersistedReportSet: z.literal(true),
        chainObservationContinuity: knowledgeValueSchema(z.boolean()),
      })
      .strict(),
    metadata: AnalysisMetadataSchema.extend({
      snapshot: AnalysisSnapshotSchema,
      modelVersion: z.literal('entity-timeline-v0.1.0'),
    }),
  })
  .strict()
  .superRefine((value, context) => {
    type TimelineProbability = (typeof value.observations)[number]['sameControllerProbability'];
    const expectedDelta = (
      before: TimelineProbability,
      after: TimelineProbability,
      metric: string,
    ) => {
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
    };
    const positions = value.observations.map((item) =>
      item.snapshot.ledger === 'EVM'
        ? item.snapshot.blockNumber
        : item.snapshot.ledger === 'BITCOIN'
          ? item.snapshot.height
          : item.snapshot.slot,
    );
    const reportIds = value.observations.map((item) => item.reportId);
    const terminalEvidenceIds = value.observations.map((item) => item.terminalEvidenceId).sort();
    const latest = value.observations.at(-1);
    const issues =
      value.request.subjectA >= value.request.subjectB ||
      BigInt(value.request.fromPosition) > BigInt(value.request.toPosition) ||
      reportIds.length !== new Set(reportIds).size ||
      value.observations.some(
        (item, index) =>
          item.snapshot.ledger !== value.request.ledger ||
          item.snapshot.chainId !== value.request.chainId ||
          item.capturedAt !== item.snapshot.capturedAt ||
          (index > 0 &&
            (BigInt(positions[index - 1] ?? '0') > BigInt(positions[index] ?? '0') ||
              (positions[index - 1] === positions[index] &&
                ((value.observations[index - 1]?.capturedAt ?? '') > item.capturedAt ||
                  ((value.observations[index - 1]?.capturedAt ?? '') === item.capturedAt &&
                    (value.observations[index - 1]?.reportId ?? '') >= item.reportId))))),
      ) ||
      positions[0] !== value.request.fromPosition ||
      positions.at(-1) !== value.request.toPosition ||
      value.transitions.length !== value.observations.length - 1 ||
      value.transitions.some((transition, index) => {
        const before = value.observations[index];
        const after = value.observations[index + 1];
        if (before === undefined || after === undefined) return true;
        const beforePosition = BigInt(positions[index] ?? '0');
        const afterPosition = BigInt(positions[index + 1] ?? '0');
        const expectedEvidenceIds = [before.terminalEvidenceId, after.terminalEvidenceId].sort();
        return (
          transition.fromReportId !== before.reportId ||
          transition.toReportId !== after.reportId ||
          transition.fromPosition !== positions[index] ||
          transition.toPosition !== positions[index + 1] ||
          transition.kind !==
            (beforePosition === afterPosition ? 'REVISION' : 'POSITION_ADVANCE') ||
          transition.unobservedPositionCount !==
            (beforePosition === afterPosition
              ? '0'
              : (afterPosition - beforePosition - 1n).toString()) ||
          transition.classificationBefore !== before.classification ||
          transition.classificationAfter !== after.classification ||
          transition.classificationChanged !== (before.classification !== after.classification) ||
          transition.serviceSuppressionBefore !== before.serviceSuppressionApplied ||
          transition.serviceSuppressionAfter !== after.serviceSuppressionApplied ||
          transition.serviceSuppressionChanged !==
            (before.serviceSuppressionApplied !== after.serviceSuppressionApplied) ||
          JSON.stringify(transition.sameControllerDelta) !==
            JSON.stringify(
              expectedDelta(
                before.sameControllerProbability,
                after.sameControllerProbability,
                'Same-controller probability',
              ),
            ) ||
          JSON.stringify(transition.coordinationDelta) !==
            JSON.stringify(
              expectedDelta(
                before.coordinationProbability,
                after.coordinationProbability,
                'Coordination probability',
              ),
            ) ||
          JSON.stringify(transition.independenceDelta) !==
            JSON.stringify(
              expectedDelta(
                before.independenceProbability,
                after.independenceProbability,
                'Independence probability',
              ),
            ) ||
          transition.evidenceIds.length !== expectedEvidenceIds.length ||
          transition.evidenceIds.some(
            (item, evidenceIndex) => item !== expectedEvidenceIds[evidenceIndex],
          )
        );
      }) ||
      value.summary.observationCount !== value.observations.length ||
      value.summary.transitionCount !== value.transitions.length ||
      value.summary.currentClassification !== latest?.classification ||
      JSON.stringify(value.summary.currentSameControllerProbability) !==
        JSON.stringify(latest?.sameControllerProbability) ||
      JSON.stringify(value.summary.currentCoordinationProbability) !==
        JSON.stringify(latest?.coordinationProbability) ||
      JSON.stringify(value.summary.currentIndependenceProbability) !==
        JSON.stringify(latest?.independenceProbability) ||
      JSON.stringify(value.metadata.snapshot) !== JSON.stringify(latest?.snapshot) ||
      value.metadata.evidenceIds.length !== terminalEvidenceIds.length ||
      value.metadata.evidenceIds.some((item, index) => item !== terminalEvidenceIds[index]);
    if (issues) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message:
          'Entity relationship timelines require one canonical pair, strictly increasing Snapshot observations, exact transitions, and complete terminal Evidence references.',
      });
    }
  });
