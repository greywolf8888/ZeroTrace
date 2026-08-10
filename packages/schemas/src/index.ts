import { z } from 'zod';

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const Hash256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/);
export const ConfidenceSchema = z.number().min(0).max(1);
export const CoverageRatioSchema = z.number().min(0).max(1);
export const QuantityStringSchema = z.string().regex(/^-?\d+$/);
export const UnsignedQuantityStringSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);
export const DecimalStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const JsonValueSchema = z.json();
export type JsonValue = z.infer<typeof JsonValueSchema>;

export const LedgerSchema = z.enum(['EVM', 'BITCOIN', 'SOLANA']);
export type Ledger = z.infer<typeof LedgerSchema>;

export const SubjectTypeSchema = z.enum([
  'ADDRESS',
  'ACCOUNT',
  'WALLET',
  'CONTRACT',
  'PROGRAM',
  'TRANSACTION',
  'BLOCK',
  'OUTPOINT',
  'TOKEN',
  'POOL',
  'CLUSTER',
  'ENTITY',
  'UNKNOWN',
]);
export type SubjectType = z.infer<typeof SubjectTypeSchema>;

export const KnowledgeReasonSchema = z.enum([
  'NOT_QUERIED',
  'NOT_APPLICABLE',
  'INSUFFICIENT_DATA',
  'UNSUPPORTED',
  'NOT_IMPLEMENTED',
  'PROVIDER_UNCONFIGURED',
  'PROVIDER_DOWN',
  'RATE_LIMITED',
  'STALE',
  'CONFLICTING_SOURCES',
  'INVALID_INPUT',
  'EXECUTION_BLOCKED',
  'PRECISION_UNSAFE',
]);
export type KnowledgeReason = z.infer<typeof KnowledgeReasonSchema>;

export const unknownValue = (reason: KnowledgeReason, detail?: string) => ({
  state: 'unknown' as const,
  reason,
  ...(detail === undefined ? {} : { detail }),
});

export const unavailableValue = (reason: KnowledgeReason, detail?: string) => ({
  state: 'unavailable' as const,
  reason,
  ...(detail === undefined ? {} : { detail }),
});

export const knownValue = <T>(value: T) => ({ state: 'known' as const, value });

export const knowledgeValueSchema = <T extends z.ZodType>(value: T) =>
  z.discriminatedUnion('state', [
    z.object({ state: z.literal('known'), value }),
    z.object({
      state: z.literal('unknown'),
      reason: KnowledgeReasonSchema,
      detail: z.string().optional(),
    }),
    z.object({
      state: z.literal('unavailable'),
      reason: KnowledgeReasonSchema,
      detail: z.string().optional(),
    }),
  ]);
export type KnowledgeValue<T> =
  | { state: 'known'; value: T }
  | { state: 'unknown'; reason: KnowledgeReason; detail?: string }
  | { state: 'unavailable'; reason: KnowledgeReason; detail?: string };

export const EvidenceKindSchema = z.enum([
  'RAW_RPC_RESPONSE',
  'BLOCK',
  'TRANSACTION',
  'RECEIPT',
  'LOG',
  'TRACE',
  'INSTRUCTION',
  'ACCOUNT_STATE',
  'UTXO',
  'MEMPOOL',
  'CONTRACT_STATE',
  'PROGRAM_STATE',
  'PROVIDER_OBSERVATION',
  'DERIVED_FEATURE',
  'NEGATIVE_EVIDENCE',
  'ANALYST_OBSERVATION',
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceSchema = z.object({
  id: z.string().min(1),
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  kind: EvidenceKindSchema,
  source: z.string().min(1),
  locator: z.string().min(1),
  sourceUri: z.url().optional(),
  payloadHash: Hash256Schema,
  observedAt: IsoDateTimeSchema,
  blockOrSlot: QuantityStringSchema.optional(),
  finality: z.string().optional(),
  summary: z.string().min(1),
  rawArtifactRef: z.string().optional(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const RawArtifactEnvelopeSchema = z.object({
  schema: z.literal('zerotrace-raw-artifact-v1'),
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  blockOrSlot: z.string().regex(/^\d+$/),
  provider: z.string().min(1),
  capturedAt: IsoDateTimeSchema,
  payload: JsonValueSchema,
});
export type RawArtifactEnvelope = z.infer<typeof RawArtifactEnvelopeSchema>;

export const RawChainFactSchema = z.object({
  id: Hash256Schema,
  schemaVersion: z.literal('zerotrace-raw-fact-v1'),
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  blockOrSlot: z.string().regex(/^\d+$/),
  blockHash: z.string().min(1),
  factType: z.string().min(1),
  subject: z.string().min(1),
  provider: z.string().min(1),
  finality: z.string().min(1),
  payload: JsonValueSchema,
  payloadHash: Hash256Schema,
  evidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  rawArtifactRef: z.string().regex(/^s3:\/\/[a-z0-9][a-z0-9.-]+\/.+#sha256=[0-9a-f]{64}$/),
  observedAt: IsoDateTimeSchema,
});
export type RawChainFact = z.infer<typeof RawChainFactSchema>;

const SnapshotBaseSchema = z.object({
  capturedAt: IsoDateTimeSchema,
  providerVersions: z.record(z.string(), z.string()),
  adapterVersions: z.record(z.string(), z.string()),
  configHash: Hash256Schema,
  entityModelVersion: z.string().min(1),
  labelSnapshot: z.string().min(1),
});

export const EvmSnapshotSchema = SnapshotBaseSchema.extend({
  ledger: z.literal('EVM'),
  chainId: z.string().min(1),
  blockNumber: QuantityStringSchema,
  blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  parentBlockHash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  finality: z.enum(['latest', 'safe', 'finalized']),
  blockTimestamp: IsoDateTimeSchema.optional(),
});

export const BitcoinSnapshotSchema = SnapshotBaseSchema.extend({
  ledger: z.literal('BITCOIN'),
  chainId: z.literal('bitcoin-mainnet'),
  height: QuantityStringSchema,
  blockHash: Hash256Schema,
  previousBlockHash: Hash256Schema.optional(),
  finality: z.literal('best-chain'),
  mempoolSnapshot: z.string().min(1).optional(),
});

export const SolanaSnapshotSchema = SnapshotBaseSchema.extend({
  ledger: z.literal('SOLANA'),
  chainId: z.literal('solana-mainnet'),
  slot: QuantityStringSchema,
  blockhash: z.string().min(32),
  parentSlot: UnsignedQuantityStringSchema.optional(),
  previousBlockhash: z.string().min(32).optional(),
  commitment: z.enum(['processed', 'confirmed', 'finalized']),
  blockTimestamp: IsoDateTimeSchema.optional(),
});

export const AnalysisSnapshotSchema = z.discriminatedUnion('ledger', [
  EvmSnapshotSchema,
  BitcoinSnapshotSchema,
  SolanaSnapshotSchema,
]);
export type AnalysisSnapshot = z.infer<typeof AnalysisSnapshotSchema>;

const EvmHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
const BitcoinHashSchema = Hash256Schema;
const SolanaHashSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/);

const ChainAnchorCommonShape = {
  position: UnsignedQuantityStringSchema,
  source: z.string().min(1),
  observedAt: IsoDateTimeSchema,
};

export const EvmChainAnchorSchema = z.object({
  ...ChainAnchorCommonShape,
  ledger: z.literal('EVM'),
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  hash: EvmHashSchema,
  parentPosition: UnsignedQuantityStringSchema.optional(),
  parentHash: EvmHashSchema.optional(),
  finality: z.enum(['latest', 'safe', 'finalized']),
});

export const BitcoinChainAnchorSchema = z.object({
  ...ChainAnchorCommonShape,
  ledger: z.literal('BITCOIN'),
  chainId: z.literal('bitcoin-mainnet'),
  hash: BitcoinHashSchema,
  parentPosition: UnsignedQuantityStringSchema.optional(),
  parentHash: BitcoinHashSchema.optional(),
  finality: z.literal('best-chain'),
});

export const SolanaChainAnchorSchema = z.object({
  ...ChainAnchorCommonShape,
  ledger: z.literal('SOLANA'),
  chainId: z.literal('solana-mainnet'),
  hash: SolanaHashSchema,
  parentPosition: UnsignedQuantityStringSchema,
  parentHash: SolanaHashSchema,
  finality: z.enum(['processed', 'confirmed', 'finalized']),
});

export const ChainAnchorSchema = z.discriminatedUnion('ledger', [
  EvmChainAnchorSchema,
  BitcoinChainAnchorSchema,
  SolanaChainAnchorSchema,
]);
export type ChainAnchor = z.infer<typeof ChainAnchorSchema>;

export const ReconciledChainAnchorSchema = z.discriminatedUnion('ledger', [
  EvmChainAnchorSchema.omit({ source: true, observedAt: true }),
  BitcoinChainAnchorSchema.omit({ source: true, observedAt: true }),
  SolanaChainAnchorSchema.omit({ source: true, observedAt: true }),
]);
export type ReconciledChainAnchor = z.infer<typeof ReconciledChainAnchorSchema>;

export const ChainAnchorReadSchema = z
  .object({
    anchor: ChainAnchorSchema,
    snapshot: AnalysisSnapshotSchema,
    payload: JsonValueSchema,
  })
  .superRefine((value, context) => {
    const snapshot = value.snapshot;
    const position =
      snapshot.ledger === 'EVM'
        ? snapshot.blockNumber
        : snapshot.ledger === 'BITCOIN'
          ? snapshot.height
          : snapshot.slot;
    const hash = snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
    const finality =
      snapshot.ledger === 'EVM'
        ? snapshot.finality
        : snapshot.ledger === 'BITCOIN'
          ? snapshot.finality
          : snapshot.commitment;
    if (
      snapshot.ledger !== value.anchor.ledger ||
      snapshot.chainId !== value.anchor.chainId ||
      position !== value.anchor.position ||
      hash !== value.anchor.hash ||
      finality !== value.anchor.finality
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Chain anchor and Snapshot identities must match.',
      });
    }
    if (value.anchor.ledger === 'EVM') {
      const isGenesis = value.anchor.position === '0';
      const parentPosition = value.anchor.parentPosition;
      const parentHash = value.anchor.parentHash;
      const snapshotParentHash = snapshot.ledger === 'EVM' ? snapshot.parentBlockHash : undefined;
      if (
        isGenesis
          ? parentPosition !== undefined ||
            parentHash !== undefined ||
            snapshotParentHash !== undefined
          : parentPosition !== (BigInt(value.anchor.position) - 1n).toString() ||
            parentHash === undefined ||
            snapshotParentHash !== parentHash
      ) {
        context.addIssue({
          code: 'custom',
          path: ['anchor', 'parentHash'],
          message: 'EVM anchor parent identity must match its replay Snapshot.',
        });
      }
    } else if (value.anchor.ledger === 'BITCOIN') {
      const isGenesis = value.anchor.position === '0';
      const parentPosition = value.anchor.parentPosition;
      const parentHash = value.anchor.parentHash;
      const snapshotParentHash =
        snapshot.ledger === 'BITCOIN' ? snapshot.previousBlockHash : undefined;
      if (
        isGenesis
          ? parentPosition !== undefined ||
            parentHash !== undefined ||
            snapshotParentHash !== undefined
          : parentPosition !== (BigInt(value.anchor.position) - 1n).toString() ||
            parentHash === undefined ||
            snapshotParentHash !== parentHash
      ) {
        context.addIssue({
          code: 'custom',
          path: ['anchor', 'parentHash'],
          message: 'Bitcoin anchor parent identity must match its replay Snapshot.',
        });
      }
    } else if (
      snapshot.ledger !== 'SOLANA' ||
      snapshot.parentSlot !== value.anchor.parentPosition ||
      snapshot.previousBlockhash !== value.anchor.parentHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['anchor', 'parentHash'],
        message: 'Solana anchor parent identity must match its replay Snapshot.',
      });
    }
    const anchorSources = value.anchor.source.split('|');
    if (
      anchorSources.length === 0 ||
      anchorSources.some((source) => !Object.hasOwn(snapshot.providerVersions, source))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['anchor', 'source'],
        message: 'Chain anchor source must be represented in Snapshot provider versions.',
      });
    }
  });
export type ChainAnchorRead = z.infer<typeof ChainAnchorReadSchema>;

export const ChainAnchorObservationRoleSchema = z.enum(['HEAD', 'COMPARISON', 'CONTINUITY_CHECK']);
export type ChainAnchorObservationRole = z.infer<typeof ChainAnchorObservationRoleSchema>;

const PersistedAnchorShape = {
  id: z.string().regex(/^anchor_[0-9a-f]{24}$/),
  role: ChainAnchorObservationRoleSchema,
  evidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
};

export const PersistedChainAnchorObservationSchema = z.discriminatedUnion('ledger', [
  EvmChainAnchorSchema.extend(PersistedAnchorShape),
  BitcoinChainAnchorSchema.extend(PersistedAnchorShape),
  SolanaChainAnchorSchema.extend(PersistedAnchorShape),
]);
export type PersistedChainAnchorObservation = z.infer<typeof PersistedChainAnchorObservationSchema>;

export const AnchorContinuityStatusSchema = z.enum([
  'FIRST_OBSERVATION',
  'UNCHANGED',
  'DIRECT_EXTENSION',
  'HISTORICAL_MATCH',
  'REORG_DETECTED',
  'SOURCE_REGRESSION',
  'CHECK_UNAVAILABLE',
]);
export type AnchorContinuityStatus = z.infer<typeof AnchorContinuityStatusSchema>;

export const AnchorContinuityAssessmentSchema = z.object({
  source: z.string().min(1),
  status: AnchorContinuityStatusSchema,
  continuous: knowledgeValueSchema(z.boolean()),
  previousAnchorId: z
    .string()
    .regex(/^anchor_[0-9a-f]{24}$/)
    .optional(),
  currentAnchorId: z.string().regex(/^anchor_[0-9a-f]{24}$/),
  checkAnchorId: z
    .string()
    .regex(/^anchor_[0-9a-f]{24}$/)
    .optional(),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
  alertIds: z.array(z.string().regex(/^dqa_[0-9a-f]{24}$/)),
});
export type AnchorContinuityAssessment = z.infer<typeof AnchorContinuityAssessmentSchema>;

export const DataQualityAlertKindSchema = z.enum([
  'CROSS_SOURCE_DISAGREEMENT',
  'REORG_DETECTED',
  'SOURCE_REGRESSION',
]);
export const DataQualityAlertSeveritySchema = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export const DataQualityAlertSchema = z.object({
  id: z.string().regex(/^dqa_[0-9a-f]{24}$/),
  kind: DataQualityAlertKindSchema,
  severity: DataQualityAlertSeveritySchema,
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  position: UnsignedQuantityStringSchema.optional(),
  summary: z.string().min(1),
  details: JsonValueSchema,
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  observedAt: IsoDateTimeSchema,
  modelVersion: z.string().min(1),
});
export type DataQualityAlert = z.infer<typeof DataQualityAlertSchema>;

export const AnchorSourceAssessmentSchema = z.object({
  source: z.string().min(1),
  head: knowledgeValueSchema(PersistedChainAnchorObservationSchema),
  comparison: knowledgeValueSchema(PersistedChainAnchorObservationSchema),
  continuity: AnchorContinuityAssessmentSchema.optional(),
});
export type AnchorSourceAssessment = z.infer<typeof AnchorSourceAssessmentSchema>;

export const AnchorReconciliationStatusSchema = z.enum([
  'AGREEMENT',
  'DISAGREEMENT',
  'INSUFFICIENT_SOURCES',
  'UNAVAILABLE',
]);
export type AnchorReconciliationStatus = z.infer<typeof AnchorReconciliationStatusSchema>;

export const AnchorReconciliationResultSchema = z.object({
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  status: AnchorReconciliationStatusSchema,
  requiredSources: z.number().int().min(2),
  configuredSources: z.number().int().nonnegative(),
  observedSources: z.number().int().nonnegative(),
  comparisonPosition: knowledgeValueSchema(UnsignedQuantityStringSchema),
  canonicalAnchor: knowledgeValueSchema(ReconciledChainAnchorSchema),
  sourceIndependence: knowledgeValueSchema(z.boolean()),
  snapshotSet: z.array(AnalysisSnapshotSchema),
  sources: z.array(AnchorSourceAssessmentSchema),
  alerts: z.array(DataQualityAlertSchema),
  metadata: z.lazy(() => AnalysisMetadataSchema),
});
export type AnchorReconciliationResult = z.infer<typeof AnchorReconciliationResultSchema>;

export const AnalysisMetadataSchema = z.object({
  snapshot: AnalysisSnapshotSchema.nullable(),
  dataCoverage: CoverageRatioSchema,
  sourceCoverage: CoverageRatioSchema,
  historyCoverage: CoverageRatioSchema,
  simulationCoverage: CoverageRatioSchema,
  freshness: IsoDateTimeSchema.nullable(),
  sourceSet: z.array(z.string()),
  modelVersion: z.string().min(1),
  confidence: ConfidenceSchema,
  evidenceIds: z.array(z.string()),
});
export type AnalysisMetadata = z.infer<typeof AnalysisMetadataSchema>;

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

export const LabelObservationSchema = z.object({
  id: z.string().min(1),
  subjectId: z.string().min(1),
  chainId: z.string().min(1),
  source: z.string().min(1),
  sourceClass: z.enum(['DETERMINISTIC', 'CURATED', 'COMMERCIAL', 'COMMUNITY', 'INFERENCE']),
  label: z.string().min(1),
  category: z.string().min(1),
  sourceConfidence: ConfidenceSchema,
  evidenceIds: z.array(z.string()).min(1),
  observedAt: IsoDateTimeSchema,
  deterministic: z.boolean(),
  licensePolicy: z.string().min(1),
  rawPayloadHash: Hash256Schema,
});
export type LabelObservation = z.infer<typeof LabelObservationSchema>;

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

export const ControlRightSchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  controller: z.string().min(1),
  rightType: z.string().min(1),
  scope: z.string().min(1),
  threshold: knowledgeValueSchema(DecimalStringSchema),
  constraints: z.array(z.string()),
  evidenceIds: z.array(z.string()).min(1),
  activeFrom: IsoDateTimeSchema.optional(),
  activeTo: IsoDateTimeSchema.optional(),
});
export type ControlRight = z.infer<typeof ControlRightSchema>;

export const LaunchLifecycleSchema = z.enum([
  'DISCOVERED',
  'CREATED',
  'PRE_LAUNCH',
  'PRIMARY_MARKET',
  'GRADUATION_READY',
  'MIGRATING',
  'MIGRATED',
  'DEX_TRADING',
  'DORMANT',
  'KILLED',
  'REDEEMED',
  'UNKNOWN',
]);

const OptionalDecimalKnowledgeSchema = knowledgeValueSchema(DecimalStringSchema);
const OptionalStringKnowledgeSchema = knowledgeValueSchema(z.string());
const OptionalJsonKnowledgeSchema = knowledgeValueSchema(JsonValueSchema);

export const LaunchMechanismSnapshotSchema = z.object({
  platform: z.string().min(1),
  platformVersion: OptionalStringKnowledgeSchema,
  deploymentId: OptionalStringKnowledgeSchema,
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  factoryOrProgram: OptionalStringKnowledgeSchema,
  creator: OptionalStringKnowledgeSchema,
  lifecycle: LaunchLifecycleSchema,
  quoteAsset: OptionalStringKnowledgeSchema,
  curveType: OptionalStringKnowledgeSchema,
  realBaseReserve: OptionalDecimalKnowledgeSchema,
  realQuoteReserve: OptionalDecimalKnowledgeSchema,
  virtualBaseReserve: OptionalDecimalKnowledgeSchema,
  virtualQuoteReserve: OptionalDecimalKnowledgeSchema,
  totalSupply: OptionalDecimalKnowledgeSchema,
  curveSupply: OptionalDecimalKnowledgeSchema,
  circulatingSupply: OptionalDecimalKnowledgeSchema,
  remainingSupply: OptionalDecimalKnowledgeSchema,
  progress: OptionalDecimalKnowledgeSchema,
  graduationCondition: OptionalStringKnowledgeSchema,
  graduationThreshold: OptionalDecimalKnowledgeSchema,
  currentSellCapacity: OptionalDecimalKnowledgeSchema,
  buyFeeBps: OptionalDecimalKnowledgeSchema,
  sellFeeBps: OptionalDecimalKnowledgeSchema,
  creatorFeeBps: OptionalDecimalKnowledgeSchema,
  protocolFeeBps: OptionalDecimalKnowledgeSchema,
  taxModel: OptionalStringKnowledgeSchema,
  buyTaxBps: OptionalDecimalKnowledgeSchema,
  sellTaxBps: OptionalDecimalKnowledgeSchema,
  taxAllocations: OptionalJsonKnowledgeSchema,
  fundRecipient: OptionalStringKnowledgeSchema,
  taxProcessor: OptionalStringKnowledgeSchema,
  dividendContract: OptionalStringKnowledgeSchema,
  vault: OptionalStringKnowledgeSchema,
  migrationTarget: OptionalStringKnowledgeSchema,
  migrationPool: OptionalStringKnowledgeSchema,
  lpOwner: OptionalStringKnowledgeSchema,
  lpLocked: knowledgeValueSchema(z.boolean()),
  lpBurned: knowledgeValueSchema(z.boolean()),
  lpClaimRight: OptionalStringKnowledgeSchema,
  antiSniperOrFarmerSettings: OptionalJsonKnowledgeSchema,
  rawConfigHash: Hash256Schema,
  sourceBlockOrSlot: z.string().min(1),
  sourceVersion: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1),
});
export type LaunchMechanismSnapshot = z.infer<typeof LaunchMechanismSnapshotSchema>;

export const EvmEventPositionSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  blockNumber: UnsignedQuantityStringSchema,
  blockHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  transactionIndex: UnsignedQuantityStringSchema,
  logIndex: UnsignedQuantityStringSchema,
});
export type EvmEventPosition = z.infer<typeof EvmEventPositionSchema>;

export const LaunchConfigurationSourceSchema = z.enum([
  'EVENT',
  'OFFICIAL_DEFAULT',
  'NOT_APPLICABLE',
]);

export const LaunchConfigurationFieldSchema = z.object({
  value: OptionalStringKnowledgeSchema,
  source: LaunchConfigurationSourceSchema,
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type LaunchConfigurationField = z.infer<typeof LaunchConfigurationFieldSchema>;

export const FlapCreationEventSchema = z.object({
  timestampUnix: UnsignedQuantityStringSchema,
  creator: z.string().regex(/^0x[0-9a-f]{40}$/),
  nonce: UnsignedQuantityStringSchema,
  token: z.string().regex(/^0x[0-9a-f]{40}$/),
  name: z.string().max(1_024),
  symbol: z.string().max(256),
  metadataUri: z.string().max(4_096),
  position: EvmEventPositionSchema,
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type FlapCreationEvent = z.infer<typeof FlapCreationEventSchema>;

export const FlapStagedEventSchema = z.object({
  timestampUnix: UnsignedQuantityStringSchema,
  creator: z.string().regex(/^0x[0-9a-f]{40}$/),
  token: z.string().regex(/^0x[0-9a-f]{40}$/),
  position: EvmEventPositionSchema,
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type FlapStagedEvent = z.infer<typeof FlapStagedEventSchema>;

export const FlapExtensionConfigurationSchema = z.object({
  extensionId: z.string().regex(/^0x[0-9a-f]{64}$/),
  extensionAddress: z.string().regex(/^0x[0-9a-f]{40}$/),
  version: UnsignedQuantityStringSchema,
  position: EvmEventPositionSchema,
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type FlapExtensionConfiguration = z.infer<typeof FlapExtensionConfigurationSchema>;

export const FlapLaunchConfigurationSchema = z.object({
  curveAddress: LaunchConfigurationFieldSchema,
  curveParameter: LaunchConfigurationFieldSchema,
  virtualQuoteReserve: LaunchConfigurationFieldSchema,
  virtualBaseReserve: LaunchConfigurationFieldSchema,
  virtualLiquiditySquared: LaunchConfigurationFieldSchema,
  dexSupplyThreshold: LaunchConfigurationFieldSchema,
  quoteTokenAddress: LaunchConfigurationFieldSchema,
  migratorType: LaunchConfigurationFieldSchema,
  tokenVersion: LaunchConfigurationFieldSchema,
  buyTaxBps: LaunchConfigurationFieldSchema,
  sellTaxBps: LaunchConfigurationFieldSchema,
  dexId: LaunchConfigurationFieldSchema,
  lpFeeProfile: LaunchConfigurationFieldSchema,
  extensions: z.array(FlapExtensionConfigurationSchema),
  rawConfigHash: Hash256Schema,
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type FlapLaunchConfiguration = z.infer<typeof FlapLaunchConfigurationSchema>;

export const FlapDexLaunchEventSchema = z.object({
  token: z.string().regex(/^0x[0-9a-f]{40}$/),
  pool: z.string().regex(/^0x[0-9a-f]{40}$/),
  tokenAmount: UnsignedQuantityStringSchema,
  quoteAmount: UnsignedQuantityStringSchema,
  position: EvmEventPositionSchema,
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const FlapPoolConfigurationEventSchema = z.object({
  token: z.string().regex(/^0x[0-9a-f]{40}$/),
  pool: z.string().regex(/^0x[0-9a-f]{40}$/),
  fee: UnsignedQuantityStringSchema,
  poolTypeCode: UnsignedQuantityStringSchema,
  position: EvmEventPositionSchema,
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const FlapMigrationEventSchema = z.object({
  launchedToDex: FlapDexLaunchEventSchema.nullable(),
  poolConfiguration: FlapPoolConfigurationEventSchema.nullable(),
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type FlapMigrationEvent = z.infer<typeof FlapMigrationEventSchema>;

export const FlapEventTransactionKindSchema = z.enum([
  'CREATION_CONFIGURATION',
  'STAGED',
  'MIGRATION',
  'MIXED',
  'UNRECOGNIZED',
]);

export const FlapEventTransactionSchema = z.object({
  platform: z.literal('flap'),
  token: z.string().regex(/^0x[0-9a-f]{40}$/),
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  platformMatch: knowledgeValueSchema(z.boolean()),
  transactionKind: FlapEventTransactionKindSchema,
  creation: FlapCreationEventSchema.nullable(),
  staged: FlapStagedEventSchema.nullable(),
  configuration: FlapLaunchConfigurationSchema.nullable(),
  migration: FlapMigrationEventSchema.nullable(),
  decodedEventNames: z.array(z.string().min(1)),
  unrecognizedPortalLogCount: z.number().int().nonnegative(),
  metadata: AnalysisMetadataSchema,
  evidence: z.array(EvidenceSchema).min(1),
});
export type FlapEventTransaction = z.infer<typeof FlapEventTransactionSchema>;

export const FlapEventHistoryRangeSchema = z.object({
  fromBlock: UnsignedQuantityStringSchema,
  toBlock: UnsignedQuantityStringSchema,
  chunkSize: z.number().int().positive(),
  chunkCount: z.number().int().positive(),
});

export const FlapEventChronologyItemSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  blockNumber: UnsignedQuantityStringSchema,
  blockHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  transactionIndex: UnsignedQuantityStringSchema,
  transactionKind: FlapEventTransactionKindSchema,
  decodedEventNames: z.array(z.string().min(1)).min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const FlapEventHistorySchema = z.object({
  platform: z.literal('flap'),
  token: z.string().regex(/^0x[0-9a-f]{40}$/),
  requestedRange: FlapEventHistoryRangeSchema,
  requestedRangeCoverage: CoverageRatioSchema,
  lifetimeCoverage: knowledgeValueSchema(z.boolean()),
  chronology: z.array(FlapEventChronologyItemSchema),
  transactions: z.array(FlapEventTransactionSchema),
  unrecognizedPortalLogCount: z.number().int().nonnegative(),
  metadata: AnalysisMetadataSchema,
  evidence: z.array(EvidenceSchema).min(1),
});
export type FlapEventHistory = z.infer<typeof FlapEventHistorySchema>;

export const FlapHistoryProjectionSegmentSchema = z.object({
  id: z.string().regex(/^fhs_[0-9a-f]{24}$/),
  fromBlock: UnsignedQuantityStringSchema,
  toBlock: UnsignedQuantityStringSchema,
  terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  transactionCount: z.number().int().nonnegative(),
  unrecognizedPortalLogCount: z.number().int().nonnegative(),
});
export type FlapHistoryProjectionSegment = z.infer<typeof FlapHistoryProjectionSegmentSchema>;

export const FlapEventHistoryProjectionSchema = z.object({
  platform: z.literal('flap'),
  token: z.string().regex(/^0x[0-9a-f]{40}$/),
  requestedRange: z.object({
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    segmentSize: z.number().int().positive(),
    segmentCount: z.number().int().positive(),
  }),
  requestedRangeCoverage: CoverageRatioSchema,
  lifetimeCoverage: knowledgeValueSchema(z.boolean()),
  segments: z.array(FlapHistoryProjectionSegmentSchema).min(1).max(5_000),
  transactionCount: z.number().int().nonnegative(),
  unrecognizedPortalLogCount: z.number().int().nonnegative(),
  terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  metadata: AnalysisMetadataSchema,
  evidence: z.array(EvidenceSchema).min(1),
});
export type FlapEventHistoryProjection = z.infer<typeof FlapEventHistoryProjectionSchema>;

export const EvmTracePositionSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  blockNumber: UnsignedQuantityStringSchema,
  blockHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  transactionIndex: UnsignedQuantityStringSchema,
  traceAddress: z.array(z.number().int().nonnegative()).max(64),
});
export type EvmTracePosition = z.infer<typeof EvmTracePositionSchema>;

export const FlapTokenOriginValueSchema = z.object({
  contractCreator: z.string().regex(/^0x[0-9a-f]{40}$/),
  launchCreator: z.string().regex(/^0x[0-9a-f]{40}$/),
  bytecodeFingerprint: Hash256Schema,
  creationTrace: EvmTracePositionSchema,
  tokenCreatedPosition: EvmEventPositionSchema,
  evidenceIds: z.array(z.string().min(1)).min(2),
});
export type FlapTokenOriginValue = z.infer<typeof FlapTokenOriginValueSchema>;

export const FlapTokenOriginSchema = z.object({
  platform: z.literal('flap'),
  token: z.string().regex(/^0x[0-9a-f]{40}$/),
  searchedRange: z.object({
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    chunkSize: z.number().int().positive(),
    chunkCount: z.number().int().positive(),
  }),
  searchedRangeCoverage: CoverageRatioSchema,
  origin: knowledgeValueSchema(FlapTokenOriginValueSchema),
  lifetimeCoverage: knowledgeValueSchema(z.boolean()),
  observedCreationCount: z.number().int().nonnegative(),
  metadata: AnalysisMetadataSchema,
  evidence: z.array(EvidenceSchema).min(2),
});
export type FlapTokenOrigin = z.infer<typeof FlapTokenOriginSchema>;

export const FlapLifetimeHistorySummarySchema = z.object({
  scanId: z.string().uuid(),
  fromBlock: UnsignedQuantityStringSchema,
  toBlock: UnsignedQuantityStringSchema,
  segmentCount: z.number().int().positive().max(5_000),
  transactionCount: z.number().int().nonnegative(),
  unrecognizedPortalLogCount: z.number().int().nonnegative(),
  requestedRangeCoverage: CoverageRatioSchema,
  terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
});
export type FlapLifetimeHistorySummary = z.infer<typeof FlapLifetimeHistorySummarySchema>;

export const FlapLifetimeMaterializationSchema = z
  .object({
    platform: z.literal('flap'),
    token: z.string().regex(/^0x[0-9a-f]{40}$/),
    dataset: z.literal('binance-mainnet'),
    datasetStartBlock: UnsignedQuantityStringSchema,
    targetBlock: UnsignedQuantityStringSchema,
    originScanId: z.string().uuid(),
    originSearchCoverage: CoverageRatioSchema,
    origin: knowledgeValueSchema(FlapTokenOriginValueSchema),
    historyProjection: FlapLifetimeHistorySummarySchema.nullable(),
    lifetimeCoverage: knowledgeValueSchema(z.boolean()),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema,
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    if (
      snapshot !== null &&
      (snapshot.ledger !== 'EVM' ||
        snapshot.chainId !== 'eip155:56' ||
        snapshot.blockNumber !== value.targetBlock ||
        snapshot.finality !== 'finalized')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Flap lifetime metadata must use the exact finalized BSC target Snapshot.',
      });
    }
    if (value.lifetimeCoverage.state !== 'known' || value.lifetimeCoverage.value !== true) return;
    const history = value.historyProjection;
    if (
      value.origin.state !== 'known' ||
      history === null ||
      value.originSearchCoverage !== 1 ||
      history.requestedRangeCoverage !== 1 ||
      history.fromBlock !== value.origin.value.creationTrace.blockNumber ||
      history.toBlock !== value.targetBlock ||
      snapshot === null ||
      value.metadata.dataCoverage !== 1 ||
      value.metadata.historyCoverage !== 1 ||
      !value.metadata.evidenceIds.includes(value.terminalEvidenceId) ||
      !value.metadata.evidenceIds.includes(history.terminalEvidenceId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lifetimeCoverage'],
        message:
          'Known Flap lifetime coverage requires a unique origin and complete origin-to-target history at one finalized Snapshot.',
      });
    }
  });
export type FlapLifetimeMaterialization = z.infer<typeof FlapLifetimeMaterializationSchema>;

export const FlapLifetimeContinuityProofSchema = z.object({
  status: z.enum(['DIRECT_EXTENSION', 'HISTORICAL_MATCH']),
  continuous: knowledgeValueSchema(z.boolean()),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(2),
  terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
});
export type FlapLifetimeContinuityProof = z.infer<typeof FlapLifetimeContinuityProofSchema>;

export const FlapLifetimeExtensionSchema = z
  .object({
    platform: z.literal('flap'),
    token: z.string().regex(/^0x[0-9a-f]{40}$/),
    dataset: z.literal('binance-mainnet'),
    datasetStartBlock: UnsignedQuantityStringSchema,
    targetBlock: UnsignedQuantityStringSchema,
    predecessor: z.object({
      scanId: z.string().uuid(),
      targetBlock: UnsignedQuantityStringSchema,
      targetHash: z.string().regex(/^0x[0-9a-f]{64}$/),
      terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    }),
    originScanId: z.string().uuid(),
    origin: knowledgeValueSchema(FlapTokenOriginValueSchema),
    continuity: FlapLifetimeContinuityProofSchema,
    historyProjection: FlapLifetimeHistorySummarySchema,
    lifetimeCoverage: knowledgeValueSchema(z.boolean()),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema,
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.chainId !== 'eip155:56' ||
      snapshot.blockNumber !== value.targetBlock ||
      snapshot.finality !== 'finalized'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Flap lifetime extension must use the exact finalized BSC target Snapshot.',
      });
    }
    if (value.lifetimeCoverage.state !== 'known' || value.lifetimeCoverage.value !== true) return;
    const predecessorTarget = BigInt(value.predecessor.targetBlock);
    const target = BigInt(value.targetBlock);
    if (
      value.origin.state !== 'known' ||
      target <= predecessorTarget ||
      value.historyProjection.fromBlock !== (predecessorTarget + 1n).toString() ||
      value.historyProjection.toBlock !== value.targetBlock ||
      value.historyProjection.requestedRangeCoverage !== 1 ||
      value.continuity.continuous.state !== 'known' ||
      value.continuity.continuous.value !== true ||
      !value.continuity.evidenceIds.includes(value.continuity.terminalEvidenceId) ||
      value.metadata.dataCoverage !== 1 ||
      value.metadata.historyCoverage !== 1 ||
      !value.metadata.evidenceIds.includes(value.predecessor.terminalEvidenceId) ||
      !value.metadata.evidenceIds.includes(value.continuity.terminalEvidenceId) ||
      !value.metadata.evidenceIds.includes(value.historyProjection.terminalEvidenceId) ||
      !value.metadata.evidenceIds.includes(value.terminalEvidenceId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lifetimeCoverage'],
        message:
          'Known Flap lifetime extension requires a Known predecessor, continuous target chain, and complete predecessor-target delta history.',
      });
    }
  });
export type FlapLifetimeExtension = z.infer<typeof FlapLifetimeExtensionSchema>;

export const FlapLifetimeStateSchema = z.union([
  FlapLifetimeMaterializationSchema,
  FlapLifetimeExtensionSchema,
]);
export type FlapLifetimeState = z.infer<typeof FlapLifetimeStateSchema>;

export const FlapLifetimeHeadReferenceSchema = z.object({
  headId: z.string().regex(/^flh_[0-9a-f]{24}$/),
  scanId: z.string().uuid(),
  targetBlock: UnsignedQuantityStringSchema,
  targetHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
});
export type FlapLifetimeHeadReference = z.infer<typeof FlapLifetimeHeadReferenceSchema>;

export const FlapLifetimeRollbackSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    token: z.string().regex(/^0x[0-9a-f]{40}$/),
    reason: z.literal('FINALIZED_REORG'),
    invalidatedHeads: z.array(FlapLifetimeHeadReferenceSchema).min(1),
    rollbackTo: FlapLifetimeHeadReferenceSchema.nullable(),
    observedTarget: z.object({
      blockNumber: UnsignedQuantityStringSchema,
      blockHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    }),
    lineageCoverage: CoverageRatioSchema,
    alertId: z.string().regex(/^dqa_[0-9a-f]{24}$/),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema,
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.chainId !== value.chainId ||
      snapshot.blockNumber !== value.observedTarget.blockNumber ||
      snapshot.blockHash !== value.observedTarget.blockHash ||
      snapshot.finality !== 'finalized'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Flap lifetime rollback must bind the exact reconciled finalized BSC Snapshot.',
      });
    }
    const invalidatedTargets = value.invalidatedHeads.map((head) => BigInt(head.targetBlock));
    if (
      invalidatedTargets.some(
        (target, index) => index > 0 && target <= (invalidatedTargets[index - 1] ?? -1n),
      ) ||
      (value.rollbackTo !== null &&
        BigInt(value.rollbackTo.targetBlock) >= (invalidatedTargets[0] ?? 0n)) ||
      BigInt(value.observedTarget.blockNumber) <
        (invalidatedTargets[invalidatedTargets.length - 1] ?? 0n) ||
      value.lineageCoverage !== 1 ||
      value.metadata.dataCoverage !== 1 ||
      value.metadata.sourceCoverage !== 1 ||
      value.metadata.historyCoverage !== 1 ||
      value.metadata.simulationCoverage !== 0 ||
      !value.metadata.evidenceIds.includes(value.terminalEvidenceId) ||
      !value.invalidatedHeads.every((head) =>
        value.metadata.evidenceIds.includes(head.terminalEvidenceId),
      ) ||
      (value.rollbackTo !== null &&
        !value.metadata.evidenceIds.includes(value.rollbackTo.terminalEvidenceId)) ||
      !value.evidence.some((evidence) => evidence.id === value.terminalEvidenceId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['lineageCoverage'],
        message:
          'Flap lifetime rollback requires a fully evidenced ordered invalidated suffix and exact surviving predecessor.',
      });
    }
  });
export type FlapLifetimeRollback = z.infer<typeof FlapLifetimeRollbackSchema>;

export const RealizableValuePointSchema = z.object({
  inputQuantity: DecimalStringSchema,
  nominalValue: knowledgeValueSchema(DecimalStringSchema),
  realizableValue: knowledgeValueSchema(DecimalStringSchema),
  averageExitPrice: knowledgeValueSchema(DecimalStringSchema),
  priceImpactBps: knowledgeValueSchema(DecimalStringSchema),
  totalFeeBps: knowledgeValueSchema(DecimalStringSchema),
  route: z.array(z.string()),
  metadata: AnalysisMetadataSchema,
});
export type RealizableValuePoint = z.infer<typeof RealizableValuePointSchema>;

export const ClaimStatusSchema = z.enum([
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'CONTRADICTED',
  'INSUFFICIENT_DATA',
]);
export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;

export const ClaimExpectedActionSchema = z.enum([
  'RECEIVE',
  'DISTRIBUTE',
  'BUYBACK',
  'BURN',
  'ADD_LIQUIDITY',
  'LOCK',
  'PAY_DIVIDEND',
]);
export const ClaimWalletRoleSchema = z.enum([
  'TAX_RECEIVER',
  'COMMUNITY_FUND',
  'BUYBACK_BURN',
  'BUYBACK_LIQUIDITY',
  'PENSION_VAULT',
  'DIVIDEND_DISTRIBUTOR',
  'OTHER',
]);
export const ClaimCustodyKindSchema = z.enum([
  'IRRECOVERABLE_BURN',
  'SAFE_MULTISIG',
  'TIMELOCK',
  'EOA',
  'CONTRACT',
  'LP_POOL',
  'UNKNOWN',
]);
export const ClaimObservedActionTypeSchema = z.enum([
  'BUYBACK',
  'BURN',
  'ADD_LIQUIDITY',
  'LP_LOCK',
  'DIVIDEND',
]);
export const ClaimLiquidityControlSchema = z.enum([
  'LP_IRRECOVERABLE',
  'LP_TIMELOCKED',
  'LP_EXTERNAL',
  'LP_CONTROLLER',
  'UNKNOWN',
]);

const ClaimBpsSchema = UnsignedQuantityStringSchema.refine((value) => BigInt(value) <= 10_000n, {
  message: 'Basis points may not exceed 10000.',
});

export const ClaimWindowSchema = z
  .object({ from: IsoDateTimeSchema, to: IsoDateTimeSchema })
  .refine((value) => Date.parse(value.from) <= Date.parse(value.to), {
    message: 'Claim window must not end before it begins.',
  });
export type ClaimWindow = z.infer<typeof ClaimWindowSchema>;

export const ClaimRuleSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  sourceAddress: z.string().min(1),
  destinationAddress: z.string().min(1),
  role: ClaimWalletRoleSchema,
  expectedAction: ClaimExpectedActionSchema,
  expectedShareBps: ClaimBpsSchema.optional(),
  window: ClaimWindowSchema,
  shareUnit: UnsignedQuantityStringSchema.refine((value) => BigInt(value) > 0n, {
    message: 'Share unit must be positive.',
  }).optional(),
  noExit: z.boolean().optional(),
  cadenceSeconds: UnsignedQuantityStringSchema.refine((value) => BigInt(value) > 0n, {
    message: 'Cadence must be positive.',
  }).optional(),
  claimEvidenceIds: z.array(z.string().min(1)).min(1),
});
export type ClaimRule = z.infer<typeof ClaimRuleSchema>;

export const ClaimTransferObservationSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  amount: UnsignedQuantityStringSchema,
  observedAt: IsoDateTimeSchema,
  transactionId: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type ClaimTransferObservation = z.infer<typeof ClaimTransferObservationSchema>;

export const ClaimActionObservationSchema = z.object({
  id: z.string().min(1),
  type: ClaimObservedActionTypeSchema,
  actor: z.string().min(1),
  amount: UnsignedQuantityStringSchema,
  observedAt: IsoDateTimeSchema,
  transferIds: z.array(z.string().min(1)),
  path: z.array(z.string().min(1)).min(1),
  liquidityControl: ClaimLiquidityControlSchema.optional(),
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type ClaimActionObservation = z.infer<typeof ClaimActionObservationSchema>;

export const ClaimCustodyObservationSchema = z.object({
  address: z.string().min(1),
  kind: ClaimCustodyKindSchema,
  canMoveFunds: knowledgeValueSchema(z.boolean()),
  threshold: z.number().int().positive().optional(),
  ownerCount: z.number().int().positive().optional(),
  executedTransactions: z.number().int().nonnegative().optional(),
  implementationAddress: z.string().min(1).optional(),
  implementationVersion: z.string().min(1).optional(),
  evidenceIds: z.array(z.string().min(1)).min(1),
});
export type ClaimCustodyObservation = z.infer<typeof ClaimCustodyObservationSchema>;

export const ClaimAuditPolicySchema = z
  .object({
    verifiedAmountToleranceBps: ClaimBpsSchema,
    partialAmountToleranceBps: ClaimBpsSchema,
    maximumAttributionHops: z.number().int().min(0).max(8),
  })
  .refine(
    (value) => BigInt(value.verifiedAmountToleranceBps) <= BigInt(value.partialAmountToleranceBps),
    { message: 'Verified tolerance may not exceed partial tolerance.' },
  );
export type ClaimAuditPolicy = z.infer<typeof ClaimAuditPolicySchema>;

export const ClaimAuditFindingCodeSchema = z.enum([
  'ALLOCATION_WITHIN_TOLERANCE',
  'ALLOCATION_DEVIATION',
  'ACTION_OBSERVED',
  'ACTION_NOT_OBSERVED',
  'CLAIMED_BURN_IS_MOVABLE_CUSTODY',
  'LP_REMAINS_CONTROLLER_WITHDRAWABLE',
  'OUTFLOW_OBSERVED',
  'FLOW_RETURNED_TO_CONTROLLER',
  'POLICY_LOCK_NOT_TECHNICAL_LOCK',
  'SHARE_UNIT_DEVIATION',
  'CADENCE_NOT_YET_PROVABLE',
  'COVERAGE_INCOMPLETE',
]);

export const ClaimAuditFindingSchema = z.object({
  code: ClaimAuditFindingCodeSchema,
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  message: z.string().min(1),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const ClaimShareUnitAssessmentSchema = z.object({
  unit: UnsignedQuantityStringSchema,
  observedDeposits: z.number().int().nonnegative(),
  exactMultipleDeposits: z.number().int().nonnegative(),
  nonMultipleDeposits: z.number().int().nonnegative(),
  exactMultipleCoverage: knowledgeValueSchema(CoverageRatioSchema),
});

export const ClaimFlowCounterpartySchema = z.object({
  direction: z.enum(['INFLOW', 'OUTFLOW']),
  address: z.string().min(1),
  observedAmount: UnsignedQuantityStringSchema,
  transferCount: z.number().int().positive(),
  firstObservedAt: IsoDateTimeSchema,
  lastObservedAt: IsoDateTimeSchema,
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const ClaimFlowAggregateSchema = z.object({
  observedAmount: UnsignedQuantityStringSchema,
  actualAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  transferCount: z.number().int().nonnegative(),
  uniqueCounterparties: z.number().int().nonnegative(),
  firstObservedAt: knowledgeValueSchema(IsoDateTimeSchema),
  lastObservedAt: knowledgeValueSchema(IsoDateTimeSchema),
  evidenceIds: z.array(z.string().min(1)),
});

export const ClaimAddressFlowSummarySchema = z.object({
  address: z.string().min(1),
  window: ClaimWindowSchema,
  inflow: ClaimFlowAggregateSchema,
  outflow: ClaimFlowAggregateSchema,
  shareUnitAssessment: ClaimShareUnitAssessmentSchema.nullable(),
  selfTransferCount: z.number().int().nonnegative(),
  selfTransferObservedAmount: UnsignedQuantityStringSchema,
  topCounterparties: z.array(ClaimFlowCounterpartySchema),
  metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot !== null, {
    message: 'Claim flow summary requires a replayable chain Snapshot.',
  }),
});
export type ClaimAddressFlowSummary = z.infer<typeof ClaimAddressFlowSummarySchema>;

export const EvmClaimAddressObservationSchema = z.object({
  tokenAddress: z.string().min(1),
  address: z.string().min(1),
  fromBlock: UnsignedQuantityStringSchema,
  toBlock: UnsignedQuantityStringSchema,
  window: ClaimWindowSchema,
  custody: ClaimCustodyObservationSchema,
  custodyMetadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot !== null, {
    message: 'Claim custody observation requires a replayable chain Snapshot.',
  }),
  flow: ClaimAddressFlowSummarySchema,
  terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot !== null, {
    message: 'EVM claim address observation requires a replayable chain Snapshot.',
  }),
});
export type EvmClaimAddressObservation = z.infer<typeof EvmClaimAddressObservationSchema>;

export const ClaimCadenceAssessmentSchema = z.object({
  expectedSeconds: UnsignedQuantityStringSchema,
  observedActions: z.number().int().nonnegative(),
  observedIntervalsSeconds: z.array(UnsignedQuantityStringSchema),
  status: ClaimStatusSchema,
});

export const ClaimRuleAuditSchema = z.object({
  claim: ClaimRuleSchema,
  status: ClaimStatusSchema,
  expectedAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  observedReceivedAmount: UnsignedQuantityStringSchema,
  actualReceivedAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  observedActionAmount: UnsignedQuantityStringSchema,
  actualActionAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  observedOutflowAmount: UnsignedQuantityStringSchema,
  deviationBps: knowledgeValueSchema(UnsignedQuantityStringSchema),
  verifiedPercent: knowledgeValueSchema(DecimalStringSchema),
  custody: knowledgeValueSchema(ClaimCustodyKindSchema),
  shareUnitAssessment: ClaimShareUnitAssessmentSchema.nullable(),
  cadenceAssessment: ClaimCadenceAssessmentSchema.nullable(),
  findings: z.array(ClaimAuditFindingSchema),
  evidenceIds: z.array(z.string().min(1)).min(1),
});

export const ClaimAuditReportSchema = z.object({
  status: ClaimStatusSchema,
  policy: ClaimAuditPolicySchema,
  items: z.array(ClaimRuleAuditSchema).min(1),
  metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot !== null, {
    message: 'Claim audit report requires a replayable chain Snapshot.',
  }),
});
export type ClaimAuditReport = z.infer<typeof ClaimAuditReportSchema>;

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
    retryable: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
