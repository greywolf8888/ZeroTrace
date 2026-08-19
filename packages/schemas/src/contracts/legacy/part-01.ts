import { z } from 'zod';


export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const Hash256Schema = z.string().regex(/^[a-fA-F0-9]{64}$/);
export const ConfidenceSchema = z.number().min(0).max(1);
export const CoverageRatioSchema = z.number().min(0).max(1);
export const QuantityStringSchema = z.string().regex(/^-?\d+$/);
export const UnsignedQuantityStringSchema = z.string().regex(/^(?:0|[1-9]\d*)$/);
export const DecimalStringSchema = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const EvmCanonicalAddressSchema = z.string().regex(/^0x[0-9a-f]{40}$/);
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
  'STORAGE_UNCONFIGURED',
  'STORAGE_DOWN',
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

/**
 * A protocol deployment is only decoder-addressable after its provenance has
 * been pinned to an official source and a replayable Evidence set.  Keeping
 * this contract in the shared schemas package prevents adapters from
 * silently inventing deployment addresses or treating a current deployment
 * as the historical truth for every version.
 */
export const ProtocolDeploymentVersionSchema = z.object({
  platform: z.string().min(1),
  ledger: LedgerSchema,
  chain: z.string().min(1),
  deploymentId: z.string().min(1),
  validFrom: knowledgeValueSchema(z.string().min(1)),
  validTo: knowledgeValueSchema(z.string().min(1)),
  programOrContract: z.string().min(1),
  factories: z.array(z.string().min(1)),
  abiOrIdlHash: Hash256Schema,
  sourceCommit: z.string().min(1).optional(),
  officialSourceUris: z.array(z.url()).min(1),
  evidenceIds: z.array(z.string().min(1)),
});
export type ProtocolDeploymentVersion = z.infer<typeof ProtocolDeploymentVersionSchema>;

export const LaunchpadProvenanceStatusSchema = z.enum([
  'PINNED',
  'PROVENANCE_PENDING',
  'LICENSE_REVIEW_REQUIRED',
  'NOT_APPLICABLE',
]);
export type LaunchpadProvenanceStatus = z.infer<typeof LaunchpadProvenanceStatusSchema>;

export const LaunchpadDecoderStatusSchema = z.enum([
  'READY_READ_ONLY',
  'PARTIAL_READ_ONLY',
  'NOT_AVAILABLE',
  'HEURISTIC_ONLY',
]);
export type LaunchpadDecoderStatus = z.infer<typeof LaunchpadDecoderStatusSchema>;

export const LaunchpadRegistryEntrySchema = z.object({
  platform: z.string().min(1),
  name: z.string().min(1),
  ledgers: z.array(LedgerSchema).min(1),
  provenanceStatus: LaunchpadProvenanceStatusSchema,
  decoderStatus: LaunchpadDecoderStatusSchema,
  officialSourceUris: z.array(z.url()),
  versions: z.array(ProtocolDeploymentVersionSchema),
  integrationBoundary: z.string().min(1),
});
export type LaunchpadRegistryEntry = z.infer<typeof LaunchpadRegistryEntrySchema>;

export const GenericLaunchObservationSchema = z.object({
  ledger: LedgerSchema,
  chainId: z.string().min(1),
  factoryOrProgram: z.string().min(1).optional(),
  quoteReserve: z.string().min(1).optional(),
  virtualReserve: z.string().min(1).optional(),
  buySellEvents: z.number().int().nonnegative(),
  migrationEvents: z.number().int().nonnegative(),
  liquidityEvents: z.number().int().nonnegative(),
  feeTransferEvents: z.number().int().nonnegative(),
  evidenceIds: z.array(z.string().min(1)),
});
export type GenericLaunchObservation = z.infer<typeof GenericLaunchObservationSchema>;

export const GenericLaunchDetectionSchema = z.object({
  platform: z.literal('UNKNOWN_LAUNCHPAD'),
  mechanismConfidence: ConfidenceSchema,
  mechanism: knowledgeValueSchema(z.literal('BONDING_CURVE_LIKE')),
  evidenceIds: z.array(z.string().min(1)),
  reasons: z.array(z.string().min(1)),
});
export type GenericLaunchDetection = z.infer<typeof GenericLaunchDetectionSchema>;

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
  'OFFICIAL_DOCUMENT',
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

export const SnapshotBaseSchema = z.object({
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

export const EvmHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);
export const BitcoinHashSchema = Hash256Schema;
export const SolanaHashSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/);

export const ChainAnchorCommonShape = {
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

export const PersistedAnchorShape = {
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
