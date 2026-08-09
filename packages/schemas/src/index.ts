import { z } from 'zod';

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const Hash256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/);
export const ConfidenceSchema = z.number().min(0).max(1);
export const CoverageRatioSchema = z.number().min(0).max(1);
export const QuantityStringSchema = z.string().regex(/^-?\d+$/);
export const DecimalStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);

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
  blockTimestamp: IsoDateTimeSchema.optional(),
});

export const BitcoinSnapshotSchema = SnapshotBaseSchema.extend({
  ledger: z.literal('BITCOIN'),
  chainId: z.literal('bitcoin-mainnet'),
  height: QuantityStringSchema,
  blockHash: Hash256Schema,
  mempoolSnapshot: z.string().min(1).optional(),
});

export const SolanaSnapshotSchema = SnapshotBaseSchema.extend({
  ledger: z.literal('SOLANA'),
  chainId: z.literal('solana-mainnet'),
  slot: QuantityStringSchema,
  blockhash: z.string().min(32),
  commitment: z.enum(['processed', 'confirmed', 'finalized']),
  blockTimestamp: IsoDateTimeSchema.optional(),
});

export const AnalysisSnapshotSchema = z.discriminatedUnion('ledger', [
  EvmSnapshotSchema,
  BitcoinSnapshotSchema,
  SolanaSnapshotSchema,
]);
export type AnalysisSnapshot = z.infer<typeof AnalysisSnapshotSchema>;

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

export const LaunchMechanismSnapshotSchema = z.object({
  platform: z.string().min(1),
  platformVersion: OptionalStringKnowledgeSchema,
  deploymentId: OptionalStringKnowledgeSchema,
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  creator: OptionalStringKnowledgeSchema,
  lifecycle: LaunchLifecycleSchema,
  quoteAsset: OptionalStringKnowledgeSchema,
  curveType: OptionalStringKnowledgeSchema,
  realBaseReserve: OptionalDecimalKnowledgeSchema,
  realQuoteReserve: OptionalDecimalKnowledgeSchema,
  virtualBaseReserve: OptionalDecimalKnowledgeSchema,
  virtualQuoteReserve: OptionalDecimalKnowledgeSchema,
  totalSupply: OptionalDecimalKnowledgeSchema,
  remainingSupply: OptionalDecimalKnowledgeSchema,
  progress: OptionalDecimalKnowledgeSchema,
  graduationCondition: OptionalStringKnowledgeSchema,
  buyFeeBps: OptionalDecimalKnowledgeSchema,
  sellFeeBps: OptionalDecimalKnowledgeSchema,
  taxModel: OptionalStringKnowledgeSchema,
  migrationTarget: OptionalStringKnowledgeSchema,
  migrationPool: OptionalStringKnowledgeSchema,
  lpOwner: OptionalStringKnowledgeSchema,
  lpLocked: knowledgeValueSchema(z.boolean()),
  lpBurned: knowledgeValueSchema(z.boolean()),
  rawConfigHash: Hash256Schema,
  sourceBlockOrSlot: z.string().min(1),
  sourceVersion: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1),
});
export type LaunchMechanismSnapshot = z.infer<typeof LaunchMechanismSnapshotSchema>;

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
