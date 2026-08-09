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
