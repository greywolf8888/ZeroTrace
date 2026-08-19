import { z } from 'zod';
export * from './part-04.js';
import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  ConfidenceSchema,
  CoverageRatioSchema,
  DecimalStringSchema,
  EvidenceSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  LedgerSchema,
  SubjectTypeSchema,
  knowledgeValueSchema,
} from './part-04.js';

export const DiscrepancyClassSchema = z.enum([
  'EXACT_IDENTITY_STATE',
  'CONSERVATION',
  'DETERMINISTIC_DERIVED',
  'INDEPENDENT_MARKET_QUOTE_RV',
  'HOLDER_ENTITY_AGGREGATE',
  'FRESHNESS',
  'API_UI_PARITY',
]);
export type DiscrepancyClass = z.infer<typeof DiscrepancyClassSchema>;

export const DiscrepancyDispositionSchema = z.enum(['PASS', 'WARNING', 'FAIL', 'INCONCLUSIVE']);
export type DiscrepancyDisposition = z.infer<typeof DiscrepancyDispositionSchema>;

export const DiscrepancyAuditStatusSchema = z.enum([
  'PASS',
  'PASS_WITH_WARNINGS',
  'FAIL',
  'INCONCLUSIVE',
]);
export type DiscrepancyAuditStatus = z.infer<typeof DiscrepancyAuditStatusSchema>;

export const DiscrepancySeveritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type DiscrepancySeverity = z.infer<typeof DiscrepancySeveritySchema>;

export const ComparableValueSchema = z.union([z.string(), z.boolean()]);
export type ComparableValue = z.infer<typeof ComparableValueSchema>;

export const ComparisonObservationSchema = z.object({
  value: knowledgeValueSchema(ComparableValueSchema),
  snapshot: AnalysisSnapshotSchema.nullable(),
  evidenceIds: z.array(z.string().min(1)),
  sourceSet: z.array(z.string().min(1)),
  modelVersion: z.string().min(1),
});
export type ComparisonObservation = z.infer<typeof ComparisonObservationSchema>;

export const DiscrepancyCheckInputSchema = z.object({
  fieldPath: z.string().min(1),
  comparisonClass: DiscrepancyClassSchema,
  actual: ComparisonObservationSchema,
  reference: ComparisonObservationSchema,
  sourceIndependence: knowledgeValueSchema(z.boolean()).optional(),
  sourceIndependenceEvidenceIds: z.array(z.string().min(1)).optional(),
  coverage: CoverageRatioSchema.optional(),
  requiredCoverage: CoverageRatioSchema.optional(),
  explanationEvidenceIds: z.array(z.string().min(1)).optional(),
});
export type DiscrepancyCheckInput = z.infer<typeof DiscrepancyCheckInputSchema>;

export const DiscrepancyCheckResultSchema = z.object({
  id: z.string().regex(/^dq_[0-9a-f]{24}$/),
  fieldPath: z.string().min(1),
  comparisonClass: DiscrepancyClassSchema,
  disposition: DiscrepancyDispositionSchema,
  severity: DiscrepancySeveritySchema,
  actual: knowledgeValueSchema(ComparableValueSchema),
  reference: knowledgeValueSchema(ComparableValueSchema),
  absoluteError: knowledgeValueSchema(DecimalStringSchema),
  relativeErrorPct: knowledgeValueSchema(DecimalStringSchema),
  passThresholdPct: knowledgeValueSchema(DecimalStringSchema),
  warningThresholdPct: knowledgeValueSchema(DecimalStringSchema),
  coverage: CoverageRatioSchema,
  requiredCoverage: CoverageRatioSchema,
  sourceIndependence: knowledgeValueSchema(z.boolean()),
  sourceIndependenceEvidenceIds: z.array(z.string().min(1)),
  numericDenominatorIncluded: z.boolean(),
  sourceSet: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().min(1)),
  explanationEvidenceIds: z.array(z.string().min(1)),
  message: z.string().min(1),
});
export type DiscrepancyCheckResult = z.infer<typeof DiscrepancyCheckResultSchema>;

export const DiscrepancyAuditResultSchema = z.object({
  status: DiscrepancyAuditStatusSchema,
  checks: z.array(DiscrepancyCheckResultSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    inconclusive: z.number().int().nonnegative(),
    numericDenominator: z.number().int().nonnegative(),
    coverageGaps: z.number().int().nonnegative(),
  }),
  metadata: AnalysisMetadataSchema,
});
export type DiscrepancyAuditResult = z.infer<typeof DiscrepancyAuditResultSchema>;

export const ProviderCapabilitySchema = z.enum([
  'CURRENT_STATE',
  'BALANCE',
  'BLOCK',
  'TRANSACTION',
  'RECEIPT',
  'LOG',
  'TRACE',
  'STATE_DIFF',
  'ARCHIVE',
  'MEMPOOL',
  'CONTRACT_SOURCE',
  'ABI',
  'TOKEN_HOLDERS',
  'SIMULATION',
  'LABEL',
  'PRICE',
  'POOL',
  'UTXO',
  'INSTRUCTION',
]);
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;

export const ProviderStatusSchema = z.enum([
  'UP',
  'DEGRADED',
  'DOWN',
  'UNCONFIGURED',
  'RATE_LIMITED',
]);
export const ProviderCircuitStateSchema = z.enum(['CLOSED', 'OPEN', 'HALF_OPEN']);
export const TransportDiagnosticsSchema = z.object({
  endpointId: z.string().min(1),
  activeEndpointId: z.string().min(1).optional(),
  circuitState: ProviderCircuitStateSchema,
  circuitOpenUntil: IsoDateTimeSchema.nullable(),
  logicalRequests: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  successes: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  rateLimitDelays: z.number().int().nonnegative(),
  cacheHits: z.number().int().nonnegative(),
  cacheMisses: z.number().int().nonnegative(),
  cacheBypasses: z.number().int().nonnegative(),
  failovers: z.number().int().nonnegative(),
  lastAttemptAt: IsoDateTimeSchema.nullable(),
  lastSuccessAt: IsoDateTimeSchema.nullable(),
  lastFailureAt: IsoDateTimeSchema.nullable(),
});
export type TransportDiagnostics = z.infer<typeof TransportDiagnosticsSchema>;
export const ProviderHealthSchema = z.object({
  id: z.string().min(1),
  ledger: LedgerSchema,
  status: ProviderStatusSchema,
  capabilities: z.array(ProviderCapabilitySchema),
  checkedAt: IsoDateTimeSchema,
  latencyMs: z.number().nonnegative().nullable(),
  lastSuccessAt: IsoDateTimeSchema.nullable(),
  head: knowledgeValueSchema(z.string()),
  lag: knowledgeValueSchema(z.number().nonnegative()),
  errorCode: z.string().optional(),
  errorDetail: z.string().optional(),
  transport: TransportDiagnosticsSchema.optional(),
});
export type ProviderHealth = z.infer<typeof ProviderHealthSchema>;

export const SubjectReferenceSchema = z.object({
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  type: SubjectTypeSchema,
  id: z.string().min(1),
  normalizedId: z.string().min(1),
  validation: z.enum(['CHECKSUM_VALID', 'STRUCTURALLY_VALID', 'AMBIGUOUS']),
  confidence: ConfidenceSchema,
});
export type SubjectReference = z.infer<typeof SubjectReferenceSchema>;

export const LabelSourceClassSchema = z.enum([
  'DETERMINISTIC',
  'CURATED',
  'COMMERCIAL',
  'COMMUNITY',
  'INFERENCE',
]);
export type LabelSourceClass = z.infer<typeof LabelSourceClassSchema>;

export const LabelObservationSchema = z
  .object({
    id: z.string().uuid(),
    subjectId: z.string().uuid(),
    ledger: LedgerSchema,
    chainId: z.string().trim().min(1).max(128),
    subjectType: SubjectTypeSchema,
    normalizedIdentifier: z.string().trim().min(1).max(512),
    source: z.string().trim().min(1).max(512),
    sourceClass: LabelSourceClassSchema,
    label: z.string().trim().min(1).max(512),
    category: z.string().trim().min(1).max(256),
    actorCandidate: knowledgeValueSchema(z.string().trim().min(1).max(512)),
    sourceConfidence: ConfidenceSchema,
    evidenceIds: z
      .array(z.string().regex(/^ev_[0-9a-f]{24}$/))
      .min(1)
      .max(100),
    observedAt: IsoDateTimeSchema,
    validFrom: knowledgeValueSchema(IsoDateTimeSchema),
    validTo: knowledgeValueSchema(IsoDateTimeSchema),
    deterministic: z.boolean(),
    licensePolicy: z.string().trim().min(1).max(512),
    rawPayloadHash: Hash256Schema,
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
        message: 'Label observations require canonical unique Evidence IDs.',
      });
    }
    if (value.deterministic !== (value.sourceClass === 'DETERMINISTIC')) {
      context.addIssue({
        code: 'custom',
        path: ['deterministic'],
        message: 'Only deterministic-source observations may be marked deterministic.',
      });
    }
    if (
      value.validFrom.state === 'known' &&
      value.validTo.state === 'known' &&
      new Date(value.validFrom.value).getTime() > new Date(value.validTo.value).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['validTo'],
        message: 'Label observation validity cannot end before it begins.',
      });
    }
  });
export type LabelObservation = z.infer<typeof LabelObservationSchema>;

export const LabelTemporalStatusSchema = z.enum(['FUTURE', 'ACTIVE', 'STALE', 'EXPIRED']);
export type LabelTemporalStatus = z.infer<typeof LabelTemporalStatusSchema>;

export const LabelIntelligenceSubjectSchema = z
  .object({
    id: z.string().uuid(),
    ledger: LedgerSchema,
    chainId: z.string().trim().min(1).max(128),
    subjectType: SubjectTypeSchema,
    normalizedIdentifier: z.string().trim().min(1).max(512),
  })
  .strict();
export type LabelIntelligenceSubject = z.infer<typeof LabelIntelligenceSubjectSchema>;

export const LabelIntelligenceRequestSchema = z
  .object({
    ledger: LedgerSchema,
    chainId: z.string().trim().min(1).max(128),
    subjectType: SubjectTypeSchema,
    normalizedIdentifier: z.string().trim().min(1).max(512),
    asOf: IsoDateTimeSchema,
    staleAfterSeconds: z.number().int().min(60).max(315_576_000),
  })
  .strict();
export type LabelIntelligenceRequest = z.infer<typeof LabelIntelligenceRequestSchema>;

export const LabelObservationSetSnapshotSchema = z
  .object({
    id: z.string().regex(/^lss_[0-9a-f]{24}$/),
    asOf: IsoDateTimeSchema,
    observationIds: z.array(z.string().uuid()).min(1).max(5_000),
    observationSetHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.observationIds.length !== new Set(value.observationIds).size ||
      value.observationIds.some(
        (observationId, index) => observationId !== [...value.observationIds].sort()[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationIds'],
        message: 'Label Snapshot observation IDs must be unique and canonical.',
      });
    }
  });
export type LabelObservationSetSnapshot = z.infer<typeof LabelObservationSetSnapshotSchema>;

export const LabelObservationProjectionSchema = z
  .object({
    observation: LabelObservationSchema,
    temporalStatus: LabelTemporalStatusSchema,
    sourcePriority: z.number().int().min(1).max(5),
    serviceHubCandidate: z.boolean(),
    riskLabel: z.boolean(),
    inferenceLabel: z.boolean(),
  })
  .strict();
export type LabelObservationProjection = z.infer<typeof LabelObservationProjectionSchema>;

export const LabelConflictSchema = z
  .object({
    id: z.string().regex(/^lcf_[0-9a-f]{24}$/),
    dimension: z.enum(['LABEL_VALUE', 'ACTOR_CANDIDATE', 'DETERMINISM']),
    key: z.string().trim().min(1).max(512),
    values: z.array(z.string().trim().min(1).max(512)).min(2).max(1_000),
    observationIds: z.array(z.string().uuid()).min(2).max(5_000),
    highestPriorityObservationIds: z.array(z.string().uuid()).min(1).max(5_000),
    disposition: z.literal('PRESERVED'),
  })
  .strict()
  .superRefine((value, context) => {
    const canonical = (items: readonly string[]) => [...new Set(items)].sort();
    if (
      value.values.some((item, index) => item !== canonical(value.values)[index]) ||
      value.observationIds.some((item, index) => item !== canonical(value.observationIds)[index]) ||
      value.highestPriorityObservationIds.some(
        (item, index) => item !== canonical(value.highestPriorityObservationIds)[index],
      ) ||
      value.highestPriorityObservationIds.some(
        (observationId) => !value.observationIds.includes(observationId),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['observationIds'],
        message: 'Label conflicts require canonical values and observation identities.',
      });
    }
  });
export type LabelConflict = z.infer<typeof LabelConflictSchema>;

export const LabelIntelligenceCoreSchema = z
  .object({
    subject: LabelIntelligenceSubjectSchema,
    request: LabelIntelligenceRequestSchema,
    snapshot: LabelObservationSetSnapshotSchema,
    observations: z.array(LabelObservationProjectionSchema).min(1).max(5_000),
    rankedObservationIds: z.array(z.string().uuid()).min(1).max(5_000),
    conflicts: z.array(LabelConflictSchema).max(5_000),
    serviceHubSuppression: z
      .object({
        applied: z.boolean(),
        evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).max(5_000),
        reason: knowledgeValueSchema(z.literal('SERVICE_HUB_OBSERVATION')),
      })
      .strict(),
    summary: z
      .object({
        observationCount: z.number().int().positive().max(5_000),
        activeCount: z.number().int().nonnegative().max(5_000),
        staleCount: z.number().int().nonnegative().max(5_000),
        expiredCount: z.number().int().nonnegative().max(5_000),
        futureCount: z.number().int().nonnegative().max(5_000),
        deterministicCount: z.number().int().nonnegative().max(5_000),
        inferenceCount: z.number().int().nonnegative().max(5_000),
        conflictCount: z.number().int().nonnegative().max(5_000),
        sourceClassCount: z.number().int().positive().max(5),
      })
      .strict(),
    metadata: z
      .object({
        modelVersion: z.literal('label-intelligence-v0.1.0'),
        freshness: knowledgeValueSchema(IsoDateTimeSchema),
        conclusionConfidence: knowledgeValueSchema(ConfidenceSchema),
        requestedObservationSetCoverage: knowledgeValueSchema(z.literal(1)),
        globalSourceCoverage: knowledgeValueSchema(CoverageRatioSchema),
        historyCoverage: knowledgeValueSchema(CoverageRatioSchema),
        sourceSet: z.array(z.string().trim().min(1).max(512)).min(1).max(5_000),
        evidenceIds: z
          .array(z.string().regex(/^ev_[0-9a-f]{24}$/))
          .min(1)
          .max(5_001),
      })
      .strict(),
    automaticEntityMergeAllowed: z.literal(false),
    riskLabelOwnershipInferenceAllowed: z.literal(false),
    crossChainSameLabelMergeAllowed: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const observationIds = value.observations.map((item) => item.observation.id).sort();
    const sourceEvidenceIds = [
      ...new Set(value.observations.flatMap((item) => item.observation.evidenceIds)),
    ].sort();
    const sourceSet = [
      ...new Set(value.observations.map((item) => item.observation.source)),
    ].sort();
    const serviceHubEvidenceIds = [
      ...new Set(
        value.observations
          .filter(
            (item) =>
              item.serviceHubCandidate && !['FUTURE', 'EXPIRED'].includes(item.temporalStatus),
          )
          .flatMap((item) => item.observation.evidenceIds),
      ),
    ].sort();
    const counts = Object.fromEntries(
      LabelTemporalStatusSchema.options.map((status) => [
        status,
        value.observations.filter((item) => item.temporalStatus === status).length,
      ]),
    );
    if (
      value.subject.ledger !== value.request.ledger ||
      value.subject.chainId !== value.request.chainId ||
      value.subject.subjectType !== value.request.subjectType ||
      value.subject.normalizedIdentifier !== value.request.normalizedIdentifier ||
      value.observations.some(
        (item) =>
          item.observation.subjectId !== value.subject.id ||
          item.observation.ledger !== value.subject.ledger ||
          item.observation.chainId !== value.subject.chainId ||
          item.observation.subjectType !== value.subject.subjectType ||
          item.observation.normalizedIdentifier !== value.subject.normalizedIdentifier,
      ) ||
      value.snapshot.asOf !== value.request.asOf ||
      value.snapshot.observationIds.length !== observationIds.length ||
      value.snapshot.observationIds.some((item, index) => item !== observationIds[index]) ||
      value.rankedObservationIds.length !== observationIds.length ||
      new Set(value.rankedObservationIds).size !== observationIds.length ||
      value.rankedObservationIds.some((item) => !observationIds.includes(item)) ||
      value.metadata.sourceSet.length !== sourceSet.length ||
      value.metadata.sourceSet.some((item, index) => item !== sourceSet[index]) ||
      sourceEvidenceIds.some((item) => !value.metadata.evidenceIds.includes(item)) ||
      value.summary.observationCount !== value.observations.length ||
      value.summary.activeCount !== counts.ACTIVE ||
      value.summary.staleCount !== counts.STALE ||
      value.summary.expiredCount !== counts.EXPIRED ||
      value.summary.futureCount !== counts.FUTURE ||
      value.summary.deterministicCount !==
        value.observations.filter((item) => item.observation.deterministic).length ||
      value.summary.inferenceCount !==
        value.observations.filter((item) => item.inferenceLabel).length ||
      value.summary.conflictCount !== value.conflicts.length ||
      value.summary.sourceClassCount !==
        new Set(value.observations.map((item) => item.observation.sourceClass)).size ||
      value.serviceHubSuppression.applied !==
        value.observations.some(
          (item) =>
            item.serviceHubCandidate && !['FUTURE', 'EXPIRED'].includes(item.temporalStatus),
        ) ||
      value.serviceHubSuppression.evidenceIds.length !== serviceHubEvidenceIds.length ||
      value.serviceHubSuppression.evidenceIds.some(
        (item, index) => item !== serviceHubEvidenceIds[index] || !sourceEvidenceIds.includes(item),
      ) ||
      (value.serviceHubSuppression.applied
        ? value.serviceHubSuppression.reason.state !== 'known' ||
          value.serviceHubSuppression.reason.value !== 'SERVICE_HUB_OBSERVATION'
        : value.serviceHubSuppression.reason.state === 'known')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['summary'],
        message:
          'Label Intelligence identity, counts, provenance, and suppression are inconsistent.',
      });
    }
  });
export type LabelIntelligenceCore = z.infer<typeof LabelIntelligenceCoreSchema>;

export const LabelIntelligenceReportSchema = z
  .object({
    schemaVersion: z.literal('label-intelligence-report-v1'),
    result: LabelIntelligenceCoreSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidence: z.array(EvidenceSchema).min(2).max(5_001),
  })
  .strict()
  .superRefine((value, context) => {
    const evidenceIds = value.evidence.map((item) => item.id).sort();
    const resultEvidenceIds = [...value.result.metadata.evidenceIds].sort();
    const terminal = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    const expectedLocator = [
      'label-intelligence',
      value.result.subject.ledger,
      value.result.subject.chainId,
      value.result.subject.id,
      value.result.snapshot.id,
    ].join(':');
    if (
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.length !== resultEvidenceIds.length ||
      evidenceIds.some((item, index) => item !== resultEvidenceIds[index]) ||
      terminal === undefined ||
      value.evidence.some(
        (item) =>
          item.ledger !== value.result.subject.ledger ||
          item.chainId !== value.result.subject.chainId,
      ) ||
      terminal.kind !== 'DERIVED_FEATURE' ||
      terminal.source !== 'zerotrace:label-intelligence-v0.1.0' ||
      terminal.locator !== expectedLocator ||
      terminal.ledger !== value.result.subject.ledger ||
      terminal.chainId !== value.result.subject.chainId ||
      terminal.observedAt !== value.result.request.asOf
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceId'],
        message: 'Label Intelligence report Evidence and terminal identity are inconsistent.',
      });
    }
  });
export type LabelIntelligenceReport = z.infer<typeof LabelIntelligenceReportSchema>;
