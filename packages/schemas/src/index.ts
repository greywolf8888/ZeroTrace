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

export const SourceOperatorAttestationSchema = z.object({
  sourceId: z.string().min(1),
  hostname: z.string().min(1),
  operatorId: z.string().min(1),
  operatorName: z.string().min(1),
  officialSource: z.url(),
  registryObservedAt: IsoDateTimeSchema,
  registryRevision: z.string().min(1),
  evidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
});
export type SourceOperatorAttestation = z.infer<typeof SourceOperatorAttestationSchema>;

export const SourceIndependenceAssessmentSchema = z
  .object({
    status: z.enum(['VERIFIED_INDEPENDENT', 'SAME_OPERATOR', 'INCONCLUSIVE']),
    independence: knowledgeValueSchema(z.boolean()),
    requiredOperators: z.number().int().min(2),
    observedSources: z.number().int().nonnegative(),
    operatorCount: z.number().int().nonnegative(),
    unresolvedSources: z.array(z.string().min(1)),
    attestations: z.array(SourceOperatorAttestationSchema),
    registryEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    modelVersion: z.literal('source-operator-registry-v1'),
  })
  .superRefine((value, context) => {
    const sourceIds = value.attestations.map((item) => item.sourceId);
    const operatorIds = new Set(value.attestations.map((item) => item.operatorId));
    const expectedStatus =
      value.independence.state !== 'known'
        ? 'INCONCLUSIVE'
        : value.independence.value
          ? 'VERIFIED_INDEPENDENT'
          : 'SAME_OPERATOR';
    const expectedEvidenceIds = [
      value.registryEvidenceId,
      ...value.attestations.map((item) => item.evidenceId),
      value.terminalEvidenceId,
    ].sort();
    const actualEvidenceIds = [...value.evidenceIds].sort();
    if (
      value.status !== expectedStatus ||
      value.observedSources !== sourceIds.length + value.unresolvedSources.length ||
      value.operatorCount !== operatorIds.size ||
      new Set(sourceIds).size !== sourceIds.length ||
      new Set(value.unresolvedSources).size !== value.unresolvedSources.length ||
      value.unresolvedSources.some((source) => sourceIds.includes(source)) ||
      expectedEvidenceIds.length !== new Set(expectedEvidenceIds).size ||
      expectedEvidenceIds.length !== actualEvidenceIds.length ||
      expectedEvidenceIds.some((id, index) => id !== actualEvidenceIds[index]) ||
      (value.status === 'VERIFIED_INDEPENDENT' &&
        (value.operatorCount < value.requiredOperators || value.unresolvedSources.length > 0)) ||
      (value.status === 'SAME_OPERATOR' &&
        (value.observedSources < 2 ||
          value.operatorCount !== 1 ||
          value.unresolvedSources.length > 0))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Source independence status, operator counts, and Evidence must be consistent.',
      });
    }
  });
export type SourceIndependenceAssessment = z.infer<typeof SourceIndependenceAssessmentSchema>;

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

/**
 * Control Campaign contracts deliberately live next to the canonical Evidence and Snapshot
 * contracts.  They are derived investigation records, not a second raw-fact store and not an
 * assertion about a real-world person or criminal intent.
 */
export const ControlCampaignIdSchema = z.string().regex(/^cc_[0-9a-f]{24}$/);
export const ControlClusterVersionIdSchema = z.string().regex(/^clv_[0-9a-f]{24}$/);
export const ClusterPositionIdSchema = z.string().regex(/^cp_[0-9a-f]{24}$/);
export const BehaviorEventIdSchema = z.string().regex(/^be_[0-9a-f]{24}$/);
export const CampaignEvidenceItemIdSchema = z.string().regex(/^cei_[0-9a-f]{24}$/);
export const CexBoundaryIdSchema = z.string().regex(/^cb_[0-9a-f]{24}$/);
export const CampaignEvidenceIdSchema = z.string().regex(/^ev_[0-9a-f]{24}$/);
export const TokenFlowEdgeIdSchema = z.string().regex(/^tfe_[0-9a-f]{24}$/);
export const EvmAssetTransferObservationIdSchema = z.string().regex(/^eat_[0-9a-f]{24}$/);
export const FundingEdgeIdSchema = z.string().regex(/^fue_[0-9a-f]{24}$/);
export const SettlementEdgeIdSchema = z.string().regex(/^see_[0-9a-f]{24}$/);
export const FundingSettlementSuppressionIdSchema = z.string().regex(/^fss_[0-9a-f]{24}$/);
export const FundingSettlementPatternIdSchema = z.string().regex(/^fsp_[0-9a-f]{24}$/);
export const FundingSettlementReportIdSchema = z.string().regex(/^fsr_[0-9a-f]{24}$/);
export const CandidateWalletIdSchema = z.string().regex(/^cw_[0-9a-f]{24}$/);
export const CandidateDiscoveryIdSchema = z.string().regex(/^cd_[0-9a-f]{24}$/);

const CanonicalStringArraySchema = z.array(z.string().min(1)).superRefine((items, context) => {
  const sorted = [...new Set(items)].sort();
  if (sorted.length !== items.length || sorted.some((item, index) => item !== items[index])) {
    context.addIssue({
      code: 'custom',
      message: 'Values must be unique and sorted.',
    });
  }
});

export const ControlCampaignStageSchema = z.enum([
  'DISCOVERY',
  'ACCUMULATION',
  'DISPERSION',
  'COORDINATED_TRADING',
  'CONSOLIDATION',
  'PRE_EXIT_DISPERSION',
  'SELLING',
  'LIQUIDITY_EXIT',
  'SETTLEMENT',
  'CEX_BOUNDARY',
  'REACCUMULATION',
  'DORMANT',
]);
export type ControlCampaignStage = z.infer<typeof ControlCampaignStageSchema>;

export const ControlCampaignStatusSchema = z.enum(['ACTIVE', 'CLOSED', 'UNKNOWN']);
export type ControlCampaignStatus = z.infer<typeof ControlCampaignStatusSchema>;

export const CampaignWalletRoleSchema = z.enum([
  'CORE',
  'SATELLITE',
  'FUNDER',
  'SETTLEMENT',
  'LP_CONTROLLER',
  'COORDINATED_ONLY',
  'SERVICE_ENDPOINT',
  'CEX_BOUNDARY',
  'UNKNOWN',
]);
export type CampaignWalletRole = z.infer<typeof CampaignWalletRoleSchema>;

export const CampaignEvidenceFamilySchema = z.enum([
  'FUNDING',
  'CONTROL',
  'TOKEN_FLOW',
  'BEHAVIOR',
  'MARKET',
  'SETTLEMENT',
  'ATTRIBUTION',
  'NEGATIVE',
]);
export type CampaignEvidenceFamily = z.infer<typeof CampaignEvidenceFamilySchema>;

export const BehaviorTypeSchema = z.enum([
  'ACCUMULATION',
  'TOKEN_DISPERSION',
  'PRE_EXIT_DISPERSION',
  'TOKEN_CONSOLIDATION',
  'COORDINATED_BUYING',
  'COORDINATED_SELLING',
  'CIRCULAR_FLOW',
  'ROUND_TRIP_TRADING',
  'WASH_TRADING_PATTERN',
  'LIQUIDITY_ADDITION',
  'LIQUIDITY_EXIT',
  'SELL_PRESSURE',
  'SETTLEMENT_CONVERGENCE',
  'CEX_PREPOSITIONING',
  'CEX_BOUNDARY_REACHED',
  'RECONSOLIDATION',
  'CAMPAIGN_DORMANCY',
]);
export type BehaviorType = z.infer<typeof BehaviorTypeSchema>;

export const BehaviorEventStatusSchema = z.enum(['PROVISIONAL', 'FINAL', 'REVOKED']);
export type BehaviorEventStatus = z.infer<typeof BehaviorEventStatusSchema>;

export const BehaviorSuppressionReasonSchema = z.enum([
  'SERVICE_HUB',
  'CEX_PATH_BREAK',
  'DEX_ROUTER_COMMON_INFRA',
  'BRIDGE_PATH_BREAK',
  'MULTISENDER_COMMON_INFRA',
  'COINJOIN',
  'DUST_OR_ADDRESS_POISONING',
  'BOT_COMMON_INFRASTRUCTURE',
]);
export type BehaviorSuppressionReason = z.infer<typeof BehaviorSuppressionReasonSchema>;

export const CampaignCalibrationStatusSchema = z.enum(['UNCALIBRATED', 'CALIBRATED']);
export type CampaignCalibrationStatus = z.infer<typeof CampaignCalibrationStatusSchema>;

export const TokenFlowKindSchema = z.enum([
  'TRANSFER',
  'MINT',
  'BURN',
  'DEX_BUY',
  'DEX_SELL',
  'LIQUIDITY_ADD',
  'LIQUIDITY_REMOVE',
  'DISTRIBUTION',
  'CONSOLIDATION',
  'LP_ADD',
  'LP_REMOVE',
  'MIGRATION',
  'BRIDGE_IN',
  'BRIDGE_OUT',
  'SETTLEMENT',
  'BRIDGE',
  'UNKNOWN',
]);
export type TokenFlowKind = z.infer<typeof TokenFlowKindSchema>;

export const TokenHistoryDiscoveryIdSchema = z.string().regex(/^thd_[0-9a-f]{24}$/);
export const TokenFlowObservationIdSchema = z.string().regex(/^tfo_[0-9a-f]{24}$/);

export const TokenFlowObservationSchema = z
  .object({
    schemaVersion: z.literal('token-flow-observation-v1'),
    id: TokenFlowObservationIdSchema,
    ledger: z.literal('EVM'),
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    blockNumber: UnsignedQuantityStringSchema,
    blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    transactionIndex: UnsignedQuantityStringSchema,
    logIndex: UnsignedQuantityStringSchema,
    from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    amountRaw: UnsignedQuantityStringSchema,
    kind: TokenFlowKindSchema,
    application: z.enum(['SUCCESS', 'FAILED', 'UNKNOWN']),
    finality: z.literal('FINAL'),
    observedAt: IsoDateTimeSchema,
    snapshot: AnalysisSnapshotSchema,
    actionSemanticsIds: CanonicalStringArraySchema,
    evidenceIds: CanonicalStringArraySchema.min(1),
    rawArtifactRef: z.string().min(1).optional(),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== value.ledger ||
      value.snapshot.chainId !== value.chainId ||
      value.snapshot.blockNumber !== value.blockNumber ||
      value.snapshot.blockHash.toLowerCase() !== value.blockHash.toLowerCase()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Token flow observation must use its exact finalized block Snapshot.',
      });
    }
  });
export type TokenFlowObservation = z.infer<typeof TokenFlowObservationSchema>;

export const TokenOriginSchema = z
  .object({
    schemaVersion: z.literal('token-origin-v1'),
    token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    creator: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    deploymentTransactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    deploymentBlockNumber: UnsignedQuantityStringSchema,
    deploymentBlockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    bytecodeHash: Hash256Schema,
    source: z.string().min(1),
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    resultHash: Hash256Schema,
  })
  .strict();
export type TokenOrigin = z.infer<typeof TokenOriginSchema>;

export const TokenHistoryActionBindingSchema = z
  .object({
    transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    status: z.enum(['BOUND', 'UNAVAILABLE', 'UNKNOWN']),
    actionSemanticsResultHash: Hash256Schema.optional(),
    evidenceIds: CanonicalStringArraySchema.min(1),
    reason: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'BOUND' && value.actionSemanticsResultHash === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['actionSemanticsResultHash'],
        message: 'A bound Action Semantics result requires its result hash.',
      });
    }
    if (value.status !== 'BOUND' && value.actionSemanticsResultHash !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['actionSemanticsResultHash'],
        message: 'Unavailable or unknown Action Semantics cannot carry a result hash.',
      });
    }
  });
export type TokenHistoryActionBinding = z.infer<typeof TokenHistoryActionBindingSchema>;

export const TokenHistoryCheckpointSchema = z
  .object({
    runId: z.string().min(1),
    nextBlock: UnsignedQuantityStringSchema,
    status: z.enum(['RUNNING', 'REQUESTED_RANGE_COMPLETE', 'SOURCE_HEAD_REACHED', 'FAILED']),
    lastBlock: UnsignedQuantityStringSchema.nullable(),
    finalizedHead: UnsignedQuantityStringSchema.nullable(),
    queryHash: Hash256Schema,
  })
  .strict();
export type TokenHistoryCheckpoint = z.infer<typeof TokenHistoryCheckpointSchema>;

const TokenHistoryRpcDiagnosticsSchema = z.object({
  endpointId: z.string().min(1),
  activeEndpointId: z.string().min(1).optional(),
  circuitState: z.enum(['CLOSED', 'OPEN', 'HALF_OPEN']),
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

export const TokenHistoryProviderTelemetrySchema = z
  .object({
    requests: z.number().int().nonnegative(),
    retries: z.number().int().nonnegative(),
    rateLimitEvents: z.number().int().nonnegative(),
    rangeAdjustments: z.number().int().nonnegative(),
    lastProviderError: z.string().min(1).optional(),
    rpcDiagnostics: TokenHistoryRpcDiagnosticsSchema.optional(),
  })
  .strict();
export type TokenHistoryProviderTelemetry = z.infer<typeof TokenHistoryProviderTelemetrySchema>;

const TokenHistoryProviderCapabilitySchema = z.enum([
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

export const TokenHistoryProviderCapabilityDeclarationSchema = z
  .object({
    id: z.string().min(1),
    ledger: z.literal('EVM'),
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    capabilities: z.array(TokenHistoryProviderCapabilitySchema).min(1),
    configured: z.boolean(),
    version: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const canonical = [...new Set(value.capabilities)].sort();
    if (
      canonical.length !== value.capabilities.length ||
      canonical.some((capability, index) => capability !== value.capabilities[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['capabilities'],
        message: 'Provider capability declarations must be unique and sorted.',
      });
    }
  });
export type TokenHistoryProviderCapabilityDeclaration = z.infer<
  typeof TokenHistoryProviderCapabilityDeclarationSchema
>;

export const TokenHistoryDiscoveryReportSchema = z
  .object({
    schemaVersion: z.literal('token-history-discovery-v1'),
    id: TokenHistoryDiscoveryIdSchema,
    ledger: z.literal('EVM'),
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    status: z.enum(['COMPLETE', 'SOURCE_HEAD_REACHED']),
    origin: knowledgeValueSchema(TokenOriginSchema),
    observations: z.array(TokenFlowObservationSchema),
    relevantTransactionHashes: CanonicalStringArraySchema,
    actionSemanticsBindings: z.array(TokenHistoryActionBindingSchema),
    sourceHead: knowledgeValueSchema(UnsignedQuantityStringSchema),
    checkpoint: TokenHistoryCheckpointSchema,
    providerTelemetry: TokenHistoryProviderTelemetrySchema,
    providerCapabilityDeclarations: z
      .array(TokenHistoryProviderCapabilityDeclarationSchema)
      .min(1)
      .superRefine((declarations, context) => {
        const ids = declarations.map((declaration) => declaration.id);
        if (new Set(ids).size !== ids.length) {
          context.addIssue({
            code: 'custom',
            path: [],
            message: 'Provider capability declaration IDs must be unique.',
          });
        }
      }),
    snapshot: AnalysisSnapshotSchema,
    rangeEvidenceIds: CanonicalStringArraySchema.min(1),
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('token-history-discovery-v1.0.0'),
    policyVersion: z.literal('token-history-policy-v1.0.0'),
    evidenceIds: CanonicalStringArraySchema.min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedSnapshotBlock =
      value.status === 'COMPLETE' ? value.toBlock : value.checkpoint.lastBlock;
    if (
      value.snapshot.ledger !== value.ledger ||
      value.snapshot.chainId !== value.chainId ||
      expectedSnapshotBlock === null ||
      value.snapshot.blockNumber !== expectedSnapshotBlock
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Token history report Snapshot must anchor the covered range end.',
      });
    }
    const expectedHashes = [
      ...new Set([
        ...value.observations.flatMap((item) => item.evidenceIds),
        ...value.actionSemanticsBindings.flatMap((item) => item.evidenceIds),
        ...(value.origin.state === 'known' ? value.origin.value.evidenceIds : []),
        ...value.rangeEvidenceIds,
      ]),
    ].sort();
    if (
      expectedHashes.length !== value.evidenceIds.length ||
      expectedHashes.some((id, index) => id !== value.evidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Token history report Evidence IDs must be the canonical union of its findings.',
      });
    }
    const expectedTransactions = [
      ...new Set(value.observations.map((item) => item.transactionHash)),
    ].sort();
    if (
      expectedTransactions.length !== value.relevantTransactionHashes.length ||
      expectedTransactions.some((id, index) => id !== value.relevantTransactionHashes[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['relevantTransactionHashes'],
        message: 'Relevant transaction hashes must match observed token-flow transactions.',
      });
    }
  });
export type TokenHistoryDiscoveryReport = z.infer<typeof TokenHistoryDiscoveryReportSchema>;

export const TokenFlowEdgeSchema = z
  .object({
    schemaVersion: z.literal('token-flow-edge-v1'),
    id: TokenFlowEdgeIdSchema,
    ledger: LedgerSchema,
    chainId: z.string().min(1),
    token: z.string().min(1),
    blockNumber: UnsignedQuantityStringSchema,
    blockHash: z.string().min(1),
    transactionHash: z.string().min(1),
    transactionIndex: UnsignedQuantityStringSchema,
    logIndex: UnsignedQuantityStringSchema,
    from: z.string().min(1),
    to: z.string().min(1),
    amountRaw: UnsignedQuantityStringSchema,
    kind: TokenFlowKindSchema,
    execution: z.enum(['SUCCESS', 'FAILED', 'UNKNOWN']),
    finality: z.enum(['PROVISIONAL', 'FINAL']),
    evidenceId: CampaignEvidenceIdSchema,
    observedAt: IsoDateTimeSchema,
    quoteAsset: z.string().min(1).optional(),
    quoteAmountRaw: UnsignedQuantityStringSchema.optional(),
    rawArtifactRef: z.string().min(1).optional(),
    counterparties: CanonicalStringArraySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === 'MINT' && value.from === value.to) {
      context.addIssue({
        code: 'custom',
        path: ['from'],
        message: 'Mint source and destination differ.',
      });
    }
    if (value.kind === 'BURN' && value.from === value.to) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Burn source and destination differ.',
      });
    }
    if (value.quoteAmountRaw !== undefined && value.quoteAsset === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['quoteAsset'],
        message: 'A quote amount requires a quote asset.',
      });
    }
    if (value.execution === 'FAILED' && value.finality === 'FINAL') {
      context.addIssue({
        code: 'custom',
        path: ['finality'],
        message: 'Failed transactions cannot create final successful flow edges.',
      });
    }
  });
export type TokenFlowEdge = z.infer<typeof TokenFlowEdgeSchema>;

export const FundingRelationSchema = z.enum([
  'FIRST_FUNDER',
  'GAS_FUNDER',
  'QUOTE_FUNDER',
  'COMMON_FUNDER',
  'SEQUENTIAL_FUNDER',
]);
export type FundingRelation = z.infer<typeof FundingRelationSchema>;

export const SettlementRelationSchema = z.enum([
  'SELL_PROCEEDS',
  'SWEEP',
  'SETTLEMENT_CONVERGENCE',
  'CEX_DEPOSIT',
  'BRIDGE_EXIT',
  'UNKNOWN',
]);
export type SettlementRelation = z.infer<typeof SettlementRelationSchema>;

export const FundingSettlementSuppressionReasonSchema = z.enum([
  'SERVICE_HUB',
  'CEX_PATH_BREAK',
  'DEX_ROUTER_COMMON_INFRA',
  'BRIDGE_PATH_BREAK',
]);
export type FundingSettlementSuppressionReason = z.infer<
  typeof FundingSettlementSuppressionReasonSchema
>;

export const FundingSettlementPatternKindSchema = z.enum([
  'RADIAL',
  'SEQUENTIAL',
  'SWEEP',
  'SETTLEMENT_CONVERGENCE',
]);
export type FundingSettlementPatternKind = z.infer<typeof FundingSettlementPatternKindSchema>;

export const FundingSettlementCoverageScopeSchema = z.enum([
  'TRANSACTION_LOCAL',
  'BOUNDED_RANGE',
  'RANGE_COMPLETE',
]);
export type FundingSettlementCoverageScope = z.infer<typeof FundingSettlementCoverageScopeSchema>;

const EvmAssetSchema = z.union([z.literal('NATIVE'), EvmCanonicalAddressSchema]);

export const EvmAssetTransferObservationSchema = z
  .object({
    schemaVersion: z.literal('evm-asset-transfer-observation-v1'),
    id: EvmAssetTransferObservationIdSchema,
    ledger: z.literal('EVM'),
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    asset: EvmAssetSchema,
    source: EvmCanonicalAddressSchema,
    destination: EvmCanonicalAddressSchema,
    amountAtomic: UnsignedQuantityStringSchema,
    blockNumber: UnsignedQuantityStringSchema,
    blockHash: z.string().regex(/^0x[a-f0-9]{64}$/),
    transactionHash: z.string().regex(/^0x[a-f0-9]{64}$/),
    transactionIndex: UnsignedQuantityStringSchema,
    eventIndex: UnsignedQuantityStringSchema.optional(),
    observedAt: IsoDateTimeSchema,
    execution: z.enum(['SUCCESS', 'FAILED', 'UNKNOWN']),
    finality: z.enum(['PROVISIONAL', 'FINAL']),
    evidenceIds: CampaignEvidenceIdSchema.array().min(1),
    rawArtifactRef: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source === value.destination) {
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'Asset transfers must have distinct source and destination addresses.',
      });
    }
    if (value.execution === 'FAILED' && value.finality === 'FINAL') {
      context.addIssue({
        code: 'custom',
        path: ['finality'],
        message: 'Failed asset transfers cannot be final successful evidence.',
      });
    }
  });
export type EvmAssetTransferObservation = z.infer<typeof EvmAssetTransferObservationSchema>;

const FundingSettlementResultCommonShape = {
  ledger: z.literal('EVM'),
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  source: EvmCanonicalAddressSchema,
  destination: EvmCanonicalAddressSchema,
  asset: EvmAssetSchema,
  amountAtomic: UnsignedQuantityStringSchema,
  blockNumber: UnsignedQuantityStringSchema,
  blockHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  transactionHash: z.string().regex(/^0x[a-f0-9]{64}$/),
  observedAt: IsoDateTimeSchema,
  path: EvmCanonicalAddressSchema.array().min(2).max(8),
  hopDepth: z.number().int().min(1).max(7),
  evidenceIds: CampaignEvidenceIdSchema.array().min(1),
  rawArtifactRefs: z.array(z.string().min(1)),
  snapshot: AnalysisSnapshotSchema,
  dataCoverage: CoverageRatioSchema,
  sourceCoverage: CoverageRatioSchema,
  historyCoverage: CoverageRatioSchema,
  coverageScope: FundingSettlementCoverageScopeSchema,
  freshness: IsoDateTimeSchema,
  sourceSet: CanonicalStringArraySchema.min(1),
  modelVersion: z.literal('funding-settlement-v1.0.0'),
  policyVersion: z.literal('funding-settlement-policy-v1.0.0'),
  confidence: knowledgeValueSchema(ConfidenceSchema),
};

export const FundingEdgeSchema = z
  .object({
    schemaVersion: z.literal('funding-edge-v1'),
    id: FundingEdgeIdSchema,
    ...FundingSettlementResultCommonShape,
    relation: FundingRelationSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== value.ledger ||
      value.snapshot.chainId !== value.chainId ||
      value.snapshot.finality !== 'finalized'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Funding edges must carry a finalized matching-chain Snapshot.',
      });
    }
    if (value.path[0] !== value.source || value.path.at(-1) !== value.destination) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'Funding edge path endpoints must match source and destination.',
      });
    }
    if (value.hopDepth !== value.path.length - 1) {
      context.addIssue({
        code: 'custom',
        path: ['hopDepth'],
        message: 'Funding edge hop depth must equal path length minus one.',
      });
    }
  });
export type FundingEdge = z.infer<typeof FundingEdgeSchema>;

export const SettlementEdgeSchema = z
  .object({
    schemaVersion: z.literal('settlement-edge-v1'),
    id: SettlementEdgeIdSchema,
    ...FundingSettlementResultCommonShape,
    relation: SettlementRelationSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== value.ledger ||
      value.snapshot.chainId !== value.chainId ||
      value.snapshot.finality !== 'finalized'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Settlement edges must carry a finalized matching-chain Snapshot.',
      });
    }
    if (value.path[0] !== value.source || value.path.at(-1) !== value.destination) {
      context.addIssue({
        code: 'custom',
        path: ['path'],
        message: 'Settlement edge path endpoints must match source and destination.',
      });
    }
    if (value.hopDepth !== value.path.length - 1) {
      context.addIssue({
        code: 'custom',
        path: ['hopDepth'],
        message: 'Settlement edge hop depth must equal path length minus one.',
      });
    }
  });
export type SettlementEdge = z.infer<typeof SettlementEdgeSchema>;

export const FundingSettlementSuppressionSchema = z
  .object({
    schemaVersion: z.literal('funding-settlement-suppression-v1'),
    id: FundingSettlementSuppressionIdSchema,
    ledger: z.literal('EVM'),
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    source: EvmCanonicalAddressSchema,
    destination: EvmCanonicalAddressSchema,
    asset: EvmAssetSchema,
    amountAtomic: UnsignedQuantityStringSchema,
    blockNumber: UnsignedQuantityStringSchema,
    blockHash: z.string().regex(/^0x[a-f0-9]{64}$/),
    transactionHash: z.string().regex(/^0x[a-f0-9]{64}$/),
    observedAt: IsoDateTimeSchema,
    path: EvmCanonicalAddressSchema.array().min(2).max(8),
    reason: FundingSettlementSuppressionReasonSchema,
    evidenceIds: CampaignEvidenceIdSchema.array().min(1),
    rawArtifactRefs: z.array(z.string().min(1)),
    snapshot: AnalysisSnapshotSchema,
  })
  .strict();
export type FundingSettlementSuppression = z.infer<typeof FundingSettlementSuppressionSchema>;

export const FundingSettlementPatternSchema = z
  .object({
    schemaVersion: z.literal('funding-settlement-pattern-v1'),
    id: FundingSettlementPatternIdSchema,
    ledger: z.literal('EVM'),
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    asset: EvmAssetSchema,
    kind: FundingSettlementPatternKindSchema,
    source: EvmCanonicalAddressSchema.optional(),
    destinations: EvmCanonicalAddressSchema.array(),
    edgeIds: z.array(z.union([FundingEdgeIdSchema, SettlementEdgeIdSchema])).min(1),
    transactionHashes: z.array(z.string().regex(/^0x[a-f0-9]{64}$/)).min(1),
    evidenceIds: CampaignEvidenceIdSchema.array().min(1),
    snapshot: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    coverageScope: FundingSettlementCoverageScopeSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('funding-settlement-v1.0.0'),
    policyVersion: z.literal('funding-settlement-policy-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    resultHash: Hash256Schema,
  })
  .strict();
export type FundingSettlementPattern = z.infer<typeof FundingSettlementPatternSchema>;

export const FundingSettlementDrilldownSchema = z
  .object({
    transactionHash: z.string().regex(/^0x[a-f0-9]{64}$/),
    evidenceIds: CampaignEvidenceIdSchema.array().min(1),
    rawArtifactRefs: z.array(z.string().min(1)),
  })
  .strict();
export type FundingSettlementDrilldown = z.infer<typeof FundingSettlementDrilldownSchema>;

export const FundingSettlementReportSchema = z
  .object({
    schemaVersion: z.literal('funding-settlement-report-v1'),
    id: FundingSettlementReportIdSchema,
    ledger: z.literal('EVM'),
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    token: EvmCanonicalAddressSchema,
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    status: z.enum(['COMPLETE', 'PARTIAL', 'UNKNOWN']),
    fundingEdges: FundingEdgeSchema.array(),
    settlementEdges: SettlementEdgeSchema.array(),
    patterns: FundingSettlementPatternSchema.array(),
    suppressedPaths: FundingSettlementSuppressionSchema.array(),
    drilldown: FundingSettlementDrilldownSchema.array(),
    snapshot: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    coverageScope: FundingSettlementCoverageScopeSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('funding-settlement-v1.0.0'),
    policyVersion: z.literal('funding-settlement-policy-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    evidenceIds: CampaignEvidenceIdSchema.array().min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== value.ledger ||
      value.snapshot.chainId !== value.chainId ||
      value.snapshot.blockNumber !== value.toBlock
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Funding and settlement reports must anchor the requested range end.',
      });
    }
    const nestedEvidenceIds = [
      ...value.fundingEdges.flatMap((edge) => edge.evidenceIds),
      ...value.settlementEdges.flatMap((edge) => edge.evidenceIds),
      ...value.patterns.flatMap((pattern) => pattern.evidenceIds),
      ...value.suppressedPaths.flatMap((path) => path.evidenceIds),
      ...value.drilldown.flatMap((item) => item.evidenceIds),
    ];
    const expectedEvidenceIds = [...new Set(nestedEvidenceIds)].sort();
    if (
      expectedEvidenceIds.length !== value.evidenceIds.length ||
      expectedEvidenceIds.some((id, index) => id !== value.evidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Funding and settlement Evidence IDs must be the canonical nested union.',
      });
    }
    if (value.snapshot.ledger !== 'EVM' || value.snapshot.finality !== 'finalized') {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Funding and settlement reports require a finalized EVM Snapshot.',
      });
      return;
    }
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const nestedResults = [
      ...value.fundingEdges.map((nested, index) => ({ nested, path: ['fundingEdges', index] })),
      ...value.settlementEdges.map((nested, index) => ({
        nested,
        path: ['settlementEdges', index],
      })),
      ...value.suppressedPaths.map((nested, index) => ({
        nested,
        path: ['suppressedPaths', index],
      })),
    ];
    for (const { nested, path } of nestedResults) {
      const block = BigInt(nested.blockNumber);
      if (block < fromBlock || block > toBlock) {
        context.addIssue({
          code: 'custom',
          path: [...path, 'blockNumber'],
          message: 'Nested Funding and Settlement observations must stay within the report range.',
        });
      }
      const nestedSnapshot = nested.snapshot;
      if (
        nestedSnapshot.ledger !== 'EVM' ||
        nestedSnapshot.chainId !== value.chainId ||
        nestedSnapshot.finality !== 'finalized' ||
        nestedSnapshot.blockNumber !== value.snapshot.blockNumber ||
        nestedSnapshot.blockHash.toLowerCase() !== value.snapshot.blockHash.toLowerCase()
      ) {
        context.addIssue({
          code: 'custom',
          path: ['snapshot'],
          message: 'Nested Funding and Settlement observations must share the report Snapshot.',
        });
      }
    }
    for (const [index, pattern] of value.patterns.entries()) {
      const patternSnapshot = pattern.snapshot;
      if (
        patternSnapshot.ledger !== 'EVM' ||
        patternSnapshot.chainId !== value.chainId ||
        patternSnapshot.finality !== 'finalized' ||
        patternSnapshot.blockNumber !== value.snapshot.blockNumber ||
        patternSnapshot.blockHash.toLowerCase() !== value.snapshot.blockHash.toLowerCase()
      ) {
        context.addIssue({
          code: 'custom',
          path: ['patterns', index, 'snapshot'],
          message: 'Funding and Settlement patterns must share the report Snapshot.',
        });
      }
    }
  });
export type FundingSettlementReport = z.infer<typeof FundingSettlementReportSchema>;

export const CandidateDiscoveryReasonSchema = z.enum([
  'TOKEN_INFLOW',
  'TOKEN_OUTFLOW',
  'EARLY_TOKEN_ACTIVITY',
  'FAN_OUT_SOURCE',
  'FAN_IN_DESTINATION',
  'DEX_ACTIVITY',
  'SETTLEMENT_COUNTERPARTY',
  'COMMON_FUNDING_SOURCE',
]);
export type CandidateDiscoveryReason = z.infer<typeof CandidateDiscoveryReasonSchema>;

export const CandidateWalletSchema = z
  .object({
    schemaVersion: z.literal('candidate-wallet-v1'),
    id: CandidateWalletIdSchema,
    ledger: LedgerSchema,
    chainId: z.string().min(1),
    token: z.string().min(1),
    walletId: z.string().min(1),
    reasons: z.array(CandidateDiscoveryReasonSchema),
    firstObservedBlock: UnsignedQuantityStringSchema,
    netTokenDeltaRaw: QuantityStringSchema,
    transactionCount: z.number().int().nonnegative(),
    evidenceIds: z.array(CampaignEvidenceIdSchema).min(1),
    serviceSuppressed: z.boolean(),
    automaticEntityMembershipAllowed: z.literal(false),
    resultHash: Hash256Schema,
  })
  .strict();
export type CandidateWallet = z.infer<typeof CandidateWalletSchema>;

export const CandidateDiscoveryResultSchema = z
  .object({
    schemaVersion: z.literal('candidate-discovery-v1'),
    id: CandidateDiscoveryIdSchema,
    ledger: LedgerSchema,
    chainId: z.string().min(1),
    token: z.string().min(1),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    snapshot: AnalysisSnapshotSchema,
    candidates: z.array(CandidateWalletSchema),
    excludedServiceWalletIds: CanonicalStringArraySchema,
    evidenceIds: z.array(CampaignEvidenceIdSchema).min(1),
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('candidate-discovery-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    resultHash: Hash256Schema,
    automaticEntityMembershipAllowed: z.literal(false),
  })
  .strict();
export type CandidateDiscoveryResult = z.infer<typeof CandidateDiscoveryResultSchema>;

export const CampaignMetadataSchema = z
  .object({
    snapshot: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.string().min(1),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    evidenceIds: CanonicalStringArraySchema.min(1),
    calibrationStatus: CampaignCalibrationStatusSchema,
  })
  .strict();
export type CampaignMetadata = z.infer<typeof CampaignMetadataSchema>;

export const ControlClusterVersionSchema = z
  .object({
    schemaVersion: z.literal('control-cluster-version-v1'),
    id: ControlClusterVersionIdSchema,
    ledger: LedgerSchema,
    chainId: z.string().min(1),
    token: z.string().min(1),
    version: UnsignedQuantityStringSchema,
    validFromBlock: UnsignedQuantityStringSchema,
    validToBlock: knowledgeValueSchema(UnsignedQuantityStringSchema),
    memberWalletIds: CanonicalStringArraySchema,
    coreWalletIds: CanonicalStringArraySchema,
    satelliteWalletIds: CanonicalStringArraySchema,
    fundingRootIds: CanonicalStringArraySchema,
    settlementRootIds: CanonicalStringArraySchema,
    membershipEvidenceIds: z.array(CampaignEvidenceIdSchema).min(1),
    modelVersion: z.literal('control-cluster-v1.0.0'),
    snapshot: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    resultHash: Hash256Schema,
    automaticEntityMembershipAllowed: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const memberSet = new Set(value.memberWalletIds);
    if (
      value.coreWalletIds.some((id) => !memberSet.has(id)) ||
      value.satelliteWalletIds.some((id) => !memberSet.has(id)) ||
      value.coreWalletIds.some((id) => value.satelliteWalletIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['memberWalletIds'],
        message: 'Core and satellite wallets must be members and must not overlap.',
      });
    }
    if (
      value.snapshot.ledger !== value.ledger ||
      value.snapshot.chainId !== value.chainId ||
      BigInt(value.validFromBlock) < 0n
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Cluster version ledger, chain and start position must agree.',
      });
    }
  });
export type ControlClusterVersion = z.infer<typeof ControlClusterVersionSchema>;

export const CampaignWalletMembershipSchema = z
  .object({
    schemaVersion: z.literal('campaign-wallet-membership-v1'),
    campaignId: ControlCampaignIdSchema,
    clusterVersionId: ControlClusterVersionIdSchema,
    walletId: z.string().min(1),
    role: CampaignWalletRoleSchema,
    validFromBlock: UnsignedQuantityStringSchema,
    validToBlock: knowledgeValueSchema(UnsignedQuantityStringSchema),
    evidenceIds: z.array(CampaignEvidenceIdSchema),
    resultHash: Hash256Schema,
    automaticEntityMembershipAllowed: z.literal(false),
  })
  .strict();
export type CampaignWalletMembership = z.infer<typeof CampaignWalletMembershipSchema>;

export const ClusterPositionSchema = z
  .object({
    schemaVersion: z.literal('cluster-position-v1'),
    id: ClusterPositionIdSchema,
    campaignId: ControlCampaignIdSchema,
    ledger: LedgerSchema,
    chainId: z.string().min(1),
    token: z.string().min(1),
    clusterVersionId: ControlClusterVersionIdSchema,
    atBlock: UnsignedQuantityStringSchema,
    blockHash: z.string().min(1),
    tokenBalanceRaw: UnsignedQuantityStringSchema,
    controlledSupplyRatio: knowledgeValueSchema(DecimalStringSchema),
    externalTokenInflowRaw: UnsignedQuantityStringSchema,
    externalTokenOutflowRaw: UnsignedQuantityStringSchema,
    mintRaw: UnsignedQuantityStringSchema,
    burnRaw: UnsignedQuantityStringSchema,
    internalTransferRaw: UnsignedQuantityStringSchema,
    dexBuyRaw: UnsignedQuantityStringSchema,
    dexSellRaw: UnsignedQuantityStringSchema,
    quoteAssets: z.record(z.string().min(1), QuantityStringSchema),
    sellReadyTokenRaw: knowledgeValueSchema(UnsignedQuantityStringSchema),
    realizableQuoteValue: knowledgeValueSchema(DecimalStringSchema),
    top1Concentration: knowledgeValueSchema(DecimalStringSchema),
    top3Concentration: knowledgeValueSchema(DecimalStringSchema),
    walletCount: z.number().int().nonnegative(),
    positionEvidenceIds: z.array(CampaignEvidenceIdSchema).min(1),
    membershipEvidenceIds: z.array(CampaignEvidenceIdSchema).min(1),
    snapshot: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('cluster-position-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== value.ledger ||
      value.snapshot.chainId !== value.chainId ||
      (value.snapshot.ledger === 'EVM' && value.snapshot.blockNumber !== value.atBlock) ||
      (value.snapshot.ledger === 'BITCOIN' && value.snapshot.height !== value.atBlock) ||
      (value.snapshot.ledger === 'SOLANA' && value.snapshot.slot !== value.atBlock)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Cluster position must be anchored to its exact position Snapshot.',
      });
    }
  });
export type ClusterPosition = z.infer<typeof ClusterPositionSchema>;

export const BehaviorFeatureObservationSchema = z
  .object({
    featureKind: z.string().min(1),
    family: CampaignEvidenceFamilySchema,
    weight: z.number().finite(),
    strength: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    contribution: z.number().finite(),
    evidenceIds: z.array(CampaignEvidenceIdSchema),
    explanation: z.string().min(1),
  })
  .strict();
export type BehaviorFeatureObservation = z.infer<typeof BehaviorFeatureObservationSchema>;

export const BehaviorEventSchema = z
  .object({
    schemaVersion: z.literal('behavior-event-v1'),
    id: BehaviorEventIdSchema,
    campaignId: ControlCampaignIdSchema,
    ledger: LedgerSchema,
    chainId: z.string().min(1),
    token: z.string().min(1),
    type: BehaviorTypeSchema,
    status: BehaviorEventStatusSchema,
    startBlock: UnsignedQuantityStringSchema,
    endBlock: UnsignedQuantityStringSchema,
    startTime: IsoDateTimeSchema,
    endTime: IsoDateTimeSchema,
    clusterVersionId: ControlClusterVersionIdSchema,
    actors: CanonicalStringArraySchema,
    counterparties: CanonicalStringArraySchema,
    tokenAmountRaw: knowledgeValueSchema(UnsignedQuantityStringSchema),
    supplyRatio: knowledgeValueSchema(DecimalStringSchema),
    quoteValue: knowledgeValueSchema(DecimalStringSchema),
    liquidityConsumption: knowledgeValueSchema(DecimalStringSchema),
    featureVector: z.array(BehaviorFeatureObservationSchema),
    supportingEvidenceIds: z.array(CampaignEvidenceIdSchema),
    contradictingEvidenceIds: z.array(CampaignEvidenceIdSchema),
    evidenceScore: ConfidenceSchema,
    confidence: knowledgeValueSchema(ConfidenceSchema),
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    suppressionReasons: z.array(BehaviorSuppressionReasonSchema),
    attributionStopped: z.boolean(),
    modelVersion: z.literal('behavior-v1.0.0'),
    ruleVersion: z.literal('behavior-v1.0.0'),
    explanation: z.string().min(1),
    snapshot: AnalysisSnapshotSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (BigInt(value.endBlock) < BigInt(value.startBlock)) {
      context.addIssue({ code: 'custom', path: ['endBlock'], message: 'Event range is reversed.' });
    }
    if (value.snapshot.ledger !== value.ledger || value.snapshot.chainId !== value.chainId) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Behavior Event Snapshot must use the same ledger and chain.',
      });
    }
    if (value.supportingEvidenceIds.length === 0 && value.contradictingEvidenceIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['supportingEvidenceIds'],
        message: 'Behavior Events require at least one Evidence ID.',
      });
    }
    if (
      value.status === 'REVOKED' &&
      value.confidence.state === 'known' &&
      value.confidence.value > 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['confidence'],
        message: 'Revoked behavior events cannot retain a positive known confidence.',
      });
    }
  });
export type BehaviorEvent = z.infer<typeof BehaviorEventSchema>;

export const CampaignEvidencePhaseSchema = z.enum([
  'FUNDING',
  'TOKEN_CONTROL',
  'TRADING',
  'SELL',
  'LIQUIDITY',
  'SETTLEMENT',
  'CEX_BOUNDARY',
  'NEGATIVE',
]);
export type CampaignEvidencePhase = z.infer<typeof CampaignEvidencePhaseSchema>;

export const CampaignEvidenceItemSchema = z
  .object({
    schemaVersion: z.literal('campaign-evidence-item-v1'),
    id: CampaignEvidenceItemIdSchema,
    evidenceId: CampaignEvidenceIdSchema,
    campaignId: ControlCampaignIdSchema,
    behaviorEventId: BehaviorEventIdSchema.optional(),
    phase: CampaignEvidencePhaseSchema,
    role: z.enum(['DIRECT', 'DERIVED', 'ATTRIBUTION']),
    polarity: z.enum(['SUPPORT', 'CONTRADICT', 'NEUTRAL']),
    ledger: LedgerSchema,
    chainId: z.string().min(1),
    blockNumber: UnsignedQuantityStringSchema,
    blockHash: z.string().min(1),
    txHash: z.string().min(1).optional(),
    logIndex: UnsignedQuantityStringSchema.optional(),
    tracePath: z.array(UnsignedQuantityStringSchema).optional(),
    subjectA: z.string().min(1).optional(),
    subjectB: z.string().min(1).optional(),
    featureKind: z.string().min(1).optional(),
    strength: z.number().min(0).max(1).optional(),
    reliability: z.number().min(0).max(1).optional(),
    weight: z.number().finite().optional(),
    scoreContribution: z.number().finite().optional(),
    parentEvidenceIds: z.array(CampaignEvidenceIdSchema),
    rawArtifactRef: z.string().min(1).optional(),
    snapshotHash: z.string().min(1),
    parserVersion: z.string().min(1),
    ruleVersion: z.string().min(1),
    sourceLabelVersion: z.string().min(1),
    explanation: z.string().min(1),
    reviewState: z.enum(['UNREVIEWED', 'REVIEWED', 'REJECTED']),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.ledger === 'EVM' && !/^0x[a-fA-F0-9]{64}$/.test(value.blockHash)) {
      context.addIssue({
        code: 'custom',
        path: ['blockHash'],
        message: 'EVM Evidence items require a 32-byte block hash.',
      });
    }
  });
export type CampaignEvidenceItem = z.infer<typeof CampaignEvidenceItemSchema>;

export const ForensicEvidenceLinePhaseSchema = z
  .object({
    phase: CampaignEvidencePhaseSchema,
    itemIds: z.array(CampaignEvidenceItemIdSchema),
    evidenceIds: z.array(CampaignEvidenceIdSchema),
    coverage: CoverageRatioSchema,
    attributionStopped: z.boolean(),
  })
  .strict();
export type ForensicEvidenceLinePhase = z.infer<typeof ForensicEvidenceLinePhaseSchema>;

export const ForensicEvidenceLineSchema = z
  .object({
    schemaVersion: z.literal('forensic-evidence-line-v1'),
    campaignId: ControlCampaignIdSchema,
    phases: z.array(ForensicEvidenceLinePhaseSchema),
    terminalBoundary: z.enum(['NONE_OBSERVED', 'CEX_BOUNDARY', 'UNKNOWN']),
    itemIds: z.array(CampaignEvidenceItemIdSchema),
    evidenceIds: z.array(CampaignEvidenceIdSchema),
    snapshotStart: AnalysisSnapshotSchema,
    snapshotEnd: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('forensic-evidence-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const expectedItems = [...new Set(value.phases.flatMap((phase) => phase.itemIds))].sort();
    const expectedEvidence = [
      ...new Set(value.phases.flatMap((phase) => phase.evidenceIds)),
    ].sort();
    if (
      JSON.stringify(value.itemIds) !== JSON.stringify(expectedItems) ||
      JSON.stringify(value.evidenceIds) !== JSON.stringify(expectedEvidence) ||
      value.snapshotStart.ledger !== value.snapshotEnd.ledger ||
      value.snapshotStart.chainId !== value.snapshotEnd.chainId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['phases'],
        message: 'Forensic Evidence line arrays and Snapshot identity must be canonical.',
      });
    }
  });
export type ForensicEvidenceLine = z.infer<typeof ForensicEvidenceLineSchema>;

export const ForensicCampaignAlertSeveritySchema = z.enum(['INFO', 'WATCH', 'HIGH', 'CRITICAL']);
export type ForensicCampaignAlertSeverity = z.infer<typeof ForensicCampaignAlertSeveritySchema>;

export const ForensicCampaignAlertSchema = z
  .object({
    schemaVersion: z.literal('forensic-campaign-alert-v1'),
    id: z.string().regex(/^fca_[0-9a-f]{24}$/),
    campaignId: ControlCampaignIdSchema,
    behaviorEventId: BehaviorEventIdSchema,
    severity: ForensicCampaignAlertSeveritySchema,
    classification: z.string().trim().min(1).max(160),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    snapshot: AnalysisSnapshotSchema,
    confidence: knowledgeValueSchema(ConfidenceSchema),
    suppressionApplied: z.array(z.string().trim().min(1).max(160)),
    details: JsonValueSchema,
    modelVersion: z.string().trim().min(1).max(160),
    createdAt: IsoDateTimeSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const canonicalEvidenceIds = [...new Set(value.evidenceIds)].sort();
    const canonicalSuppressions = [...new Set(value.suppressionApplied)].sort();
    if (
      JSON.stringify(value.evidenceIds) !== JSON.stringify(canonicalEvidenceIds) ||
      JSON.stringify(value.suppressionApplied) !== JSON.stringify(canonicalSuppressions)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Forensic Campaign Alert Evidence and suppression arrays must be canonical.',
      });
    }
  });
export type ForensicCampaignAlert = z.infer<typeof ForensicCampaignAlertSchema>;

export const CexBoundarySchema = z
  .object({
    schemaVersion: z.literal('cex-boundary-v1'),
    id: CexBoundaryIdSchema,
    campaignId: ControlCampaignIdSchema,
    ledger: LedgerSchema,
    chainId: z.string().min(1),
    boundaryAddress: z.string().min(1),
    providerLabel: knowledgeValueSchema(z.string().min(1)),
    firstObservedBlock: UnsignedQuantityStringSchema,
    evidenceIds: z.array(CampaignEvidenceIdSchema),
    attributionStopped: z.literal(true),
    resultHash: Hash256Schema,
  })
  .strict();
export type CexBoundary = z.infer<typeof CexBoundarySchema>;

export const ControlCampaignSchema = z
  .object({
    schemaVersion: z.literal('control-campaign-v1'),
    id: ControlCampaignIdSchema,
    ledger: LedgerSchema,
    chainId: z.string().min(1),
    token: z.string().min(1),
    originBlock: UnsignedQuantityStringSchema,
    startBlock: UnsignedQuantityStringSchema,
    endBlock: knowledgeValueSchema(UnsignedQuantityStringSchema),
    status: ControlCampaignStatusSchema,
    currentStage: ControlCampaignStageSchema,
    primaryClusterId: ControlClusterVersionIdSchema,
    clusterVersionId: ControlClusterVersionIdSchema,
    coreWalletIds: CanonicalStringArraySchema,
    satelliteWalletIds: CanonicalStringArraySchema,
    fundingRootIds: CanonicalStringArraySchema,
    settlementRootIds: CanonicalStringArraySchema,
    controlledSupply: knowledgeValueSchema(DecimalStringSchema),
    controlConfidence: knowledgeValueSchema(ConfidenceSchema),
    coordinationConfidence: knowledgeValueSchema(ConfidenceSchema),
    campaignConfidence: knowledgeValueSchema(ConfidenceSchema),
    evidenceScore: ConfidenceSchema,
    evidenceCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    dataCoverage: CoverageRatioSchema,
    behaviorEventIds: z.array(BehaviorEventIdSchema),
    cexBoundaryIds: z.array(CexBoundaryIdSchema),
    snapshotStart: AnalysisSnapshotSchema,
    snapshotEnd: AnalysisSnapshotSchema,
    ruleVersion: z.literal('campaign-v1.0.0'),
    entityModelVersion: z.string().min(1),
    metadata: CampaignMetadataSchema,
    automaticOwnershipMergeAllowed: z.literal(false),
    automaticEntityMembershipMutationAllowed: z.literal(false),
    calibrationStatus: CampaignCalibrationStatusSchema,
    evidenceLineItemIds: z.array(CampaignEvidenceItemIdSchema),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.ledger !== value.snapshotStart.ledger ||
      value.chainId !== value.snapshotStart.chainId ||
      value.ledger !== value.snapshotEnd.ledger ||
      value.chainId !== value.snapshotEnd.chainId ||
      value.metadata.snapshot.ledger !== value.ledger ||
      value.metadata.snapshot.chainId !== value.chainId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Campaign metadata and Snapshots must share the campaign ledger and chain.',
      });
    }
    if (BigInt(value.startBlock) < BigInt(value.originBlock)) {
      context.addIssue({
        code: 'custom',
        path: ['startBlock'],
        message: 'Campaign start cannot precede token origin.',
      });
    }
    if (
      value.endBlock.state === 'known' &&
      BigInt(value.endBlock.value) < BigInt(value.startBlock)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['endBlock'],
        message: 'Campaign end cannot precede campaign start.',
      });
    }
  });
export type ControlCampaign = z.infer<typeof ControlCampaignSchema>;

export const ControlCampaignBundleSchema = z
  .object({
    schemaVersion: z.literal('control-campaign-bundle-v1'),
    campaign: ControlCampaignSchema,
    clusterVersion: ControlClusterVersionSchema,
    memberships: z.array(CampaignWalletMembershipSchema),
    positions: z.array(ClusterPositionSchema),
    behaviorEvents: z.array(BehaviorEventSchema),
    evidenceItems: z.array(CampaignEvidenceItemSchema),
    evidenceLine: ForensicEvidenceLineSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const campaignId = value.campaign.id;
    const eventIds = value.behaviorEvents.map((event) => event.id).sort();
    const positionIds = value.positions.map((position) => position.id);
    const itemIds = value.evidenceItems.map((item) => item.id).sort();
    const lineItemIds = [...value.evidenceLine.itemIds].sort();
    const lineEvidenceIds = [...value.evidenceLine.evidenceIds].sort();
    const itemEvidenceIds = [...new Set(value.evidenceItems.map((item) => item.evidenceId))].sort();
    if (
      value.clusterVersion.id !== value.campaign.clusterVersionId ||
      value.clusterVersion.token !== value.campaign.token ||
      value.evidenceLine.campaignId !== campaignId ||
      JSON.stringify(value.campaign.behaviorEventIds) !== JSON.stringify(eventIds) ||
      JSON.stringify(value.campaign.evidenceLineItemIds) !== JSON.stringify(itemIds) ||
      JSON.stringify(lineItemIds) !== JSON.stringify(itemIds) ||
      JSON.stringify(lineEvidenceIds) !== JSON.stringify(itemEvidenceIds) ||
      value.behaviorEvents.some((event) => event.campaignId !== campaignId) ||
      value.positions.some((position) => position.campaignId !== campaignId) ||
      value.positions.some((position) => position.clusterVersionId !== value.clusterVersion.id) ||
      value.memberships.some(
        (membership) =>
          membership.campaignId !== campaignId ||
          membership.clusterVersionId !== value.clusterVersion.id,
      ) ||
      value.evidenceItems.some((item) => item.campaignId !== campaignId) ||
      positionIds.some((id) => !id.startsWith('cp_'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['campaign'],
        message: 'Control Campaign bundle references must be complete and identity-consistent.',
      });
    }
  });
export type ControlCampaignBundle = z.infer<typeof ControlCampaignBundleSchema>;

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
export type EntityRelationshipTimelineCore = z.infer<typeof EntityRelationshipTimelineCoreSchema>;

export const EntityRelationshipTimelineReportSchema = z
  .object({
    schemaVersion: z.literal('entity-relationship-timeline-report-v1'),
    automaticOwnershipMergeAllowed: z.literal(false),
    timeline: EntityRelationshipTimelineCoreSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidence: z.array(EvidenceSchema).min(3).max(1_001),
  })
  .strict()
  .superRefine((value, context) => {
    const latest = value.timeline.observations.at(-1);
    if (latest === undefined) return;
    const position =
      latest.snapshot.ledger === 'EVM'
        ? { value: latest.snapshot.blockNumber, finality: latest.snapshot.finality }
        : latest.snapshot.ledger === 'BITCOIN'
          ? { value: latest.snapshot.height, finality: latest.snapshot.finality }
          : { value: latest.snapshot.slot, finality: latest.snapshot.commitment };
    const expectedEvidenceIds = [
      ...value.timeline.metadata.evidenceIds,
      value.terminalEvidenceId,
    ].sort();
    const evidenceIds = value.evidence.map((item) => item.id);
    const terminal = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    const expectedLocator = `entity-relationship-timeline:${value.timeline.request.subjectA}:${value.timeline.request.subjectB}:${value.timeline.request.fromPosition}:${value.timeline.request.toPosition}`;
    const issues =
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((item, index) => item !== [...evidenceIds].sort()[index]) ||
      evidenceIds.length !== expectedEvidenceIds.length ||
      evidenceIds.some((item, index) => item !== expectedEvidenceIds[index]) ||
      value.evidence.some(
        (item) =>
          item.ledger !== value.timeline.request.ledger ||
          item.chainId !== value.timeline.request.chainId,
      ) ||
      value.timeline.observations.some((observation) => {
        const evidence = value.evidence.find((item) => item.id === observation.terminalEvidenceId);
        const observationPosition =
          observation.snapshot.ledger === 'EVM'
            ? { value: observation.snapshot.blockNumber, finality: observation.snapshot.finality }
            : observation.snapshot.ledger === 'BITCOIN'
              ? { value: observation.snapshot.height, finality: observation.snapshot.finality }
              : { value: observation.snapshot.slot, finality: observation.snapshot.commitment };
        return (
          evidence?.source !== 'zerotrace:entity-v0.1.0' ||
          evidence.blockOrSlot !== observationPosition.value ||
          evidence.finality !== observationPosition.finality
        );
      }) ||
      terminal?.kind !== 'DERIVED_FEATURE' ||
      terminal.source !== 'zerotrace:entity-timeline-v0.1.0' ||
      terminal.locator !== expectedLocator ||
      terminal.blockOrSlot !== position.value ||
      terminal.finality !== position.finality;
    if (issues) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message:
          'Entity relationship timeline reports require complete per-observation terminal Evidence and one latest-Snapshot timeline derivation.',
      });
    }
  });
export type EntityRelationshipTimelineReport = z.infer<
  typeof EntityRelationshipTimelineReportSchema
>;

export const EntityInvestigationGraphRelationSchema = z.enum([
  'SAME_CONTROLLER',
  'COORDINATED_WITH',
]);
export type EntityInvestigationGraphRelation = z.infer<
  typeof EntityInvestigationGraphRelationSchema
>;

export const EntityInvestigationGraphProjectionStateSchema = z.enum([
  'PROJECTED',
  'SERVICE_SUPPRESSED',
  'INDEPENDENCE_RETAINED',
  'INFRASTRUCTURE_RETAINED',
  'UNKNOWN_RETAINED',
]);
export type EntityInvestigationGraphProjectionState = z.infer<
  typeof EntityInvestigationGraphProjectionStateSchema
>;

export const EntityInvestigationGraphNodeSchema = z
  .object({
    id: z.string().regex(/^egn_[0-9a-f]{24}$/),
    subjectId: z.string().trim().min(1).max(512),
    subjectType: knowledgeValueSchema(SubjectTypeSchema),
    serviceInfrastructure: knowledgeValueSchema(z.boolean()),
    terminalEvidenceIds: z
      .array(z.string().regex(/^ev_[0-9a-f]{24}$/))
      .min(1)
      .max(250),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subjectType.state === 'known' && value.subjectType.value === 'UNKNOWN') {
      context.addIssue({
        code: 'custom',
        path: ['subjectType'],
        message: 'An unknown subject type must use explicit KnowledgeValue Unknown.',
      });
    }
    if (
      value.terminalEvidenceIds.length !== new Set(value.terminalEvidenceIds).size ||
      value.terminalEvidenceIds.some(
        (item, index) => item !== [...value.terminalEvidenceIds].sort()[index],
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceIds'],
        message: 'Graph node Evidence identities must be unique and canonical.',
      });
    }
  });
export type EntityInvestigationGraphNode = z.infer<typeof EntityInvestigationGraphNodeSchema>;

export const EntityInvestigationGraphObservationSchema = z
  .object({
    timelineId: z.string().regex(/^ert_[0-9a-f]{24}$/),
    timelineResultHash: Hash256Schema,
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    fromPosition: UnsignedQuantityStringSchema,
    toPosition: UnsignedQuantityStringSchema,
    classification: EntityResolutionClassSchema,
    sameControllerProbability: knowledgeValueSchema(ConfidenceSchema),
    coordinationProbability: knowledgeValueSchema(ConfidenceSchema),
    independenceProbability: knowledgeValueSchema(ConfidenceSchema),
    serviceSuppressionApplied: z.boolean(),
    projectionState: EntityInvestigationGraphProjectionStateSchema,
    projectedEdgeId: knowledgeValueSchema(
      z
        .string()
        .regex(/^ege_[0-9a-f]{24}$/)
        .nullable(),
    ),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  })
  .strict()
  .superRefine((value, context) => {
    const hasEdge = value.projectedEdgeId.state === 'known' && value.projectedEdgeId.value !== null;
    if (
      value.subjectA >= value.subjectB ||
      (value.projectionState === 'PROJECTED') !== hasEdge ||
      BigInt(value.fromPosition) > BigInt(value.toPosition)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['projectionState'],
        message:
          'Graph observations require a canonical pair, ordered positions, and an edge only for projected relationships.',
      });
    }
  });
export type EntityInvestigationGraphObservation = z.infer<
  typeof EntityInvestigationGraphObservationSchema
>;

export const EntityInvestigationGraphEdgeSchema = z
  .object({
    id: z.string().regex(/^ege_[0-9a-f]{24}$/),
    relation: EntityInvestigationGraphRelationSchema,
    sourceNodeId: z.string().regex(/^egn_[0-9a-f]{24}$/),
    targetNodeId: z.string().regex(/^egn_[0-9a-f]{24}$/),
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    classification: EntityResolutionClassSchema,
    sameControllerProbability: knowledgeValueSchema(ConfidenceSchema),
    coordinationProbability: knowledgeValueSchema(ConfidenceSchema),
    independenceProbability: knowledgeValueSchema(ConfidenceSchema),
    validFromPosition: UnsignedQuantityStringSchema,
    validToPosition: UnsignedQuantityStringSchema,
    observationCount: z.number().int().min(2).max(1_000),
    classificationChangeCount: z.number().int().nonnegative(),
    temporalContinuity: knowledgeValueSchema(z.boolean()),
    timelineId: z.string().regex(/^ert_[0-9a-f]{24}$/),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    automaticOwnershipPropagationAllowed: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const sameControllerClasses = new Set([
      'CONFIRMED_SAME_CONTROLLER',
      'HIGHLY_PROBABLE_SAME_CONTROLLER',
      'PROBABLE_SAME_CONTROLLER',
    ]);
    const classificationMatchesRelation =
      value.relation === 'SAME_CONTROLLER'
        ? sameControllerClasses.has(value.classification)
        : value.classification === 'COORDINATED_BUT_INDEPENDENT';
    if (
      value.sourceNodeId === value.targetNodeId ||
      value.subjectA >= value.subjectB ||
      BigInt(value.validFromPosition) > BigInt(value.validToPosition) ||
      !classificationMatchesRelation
    ) {
      context.addIssue({
        code: 'custom',
        path: ['relation'],
        message:
          'Graph edges require distinct canonical endpoints, valid positions, and a classification-compatible relationship.',
      });
    }
  });
export type EntityInvestigationGraphEdge = z.infer<typeof EntityInvestigationGraphEdgeSchema>;

export const EntityInvestigationComponentSchema = z
  .object({
    id: z.string().regex(/^igc_[0-9a-f]{24}$/),
    nodeIds: z
      .array(z.string().regex(/^egn_[0-9a-f]{24}$/))
      .min(1)
      .max(500),
    edgeIds: z.array(z.string().regex(/^ege_[0-9a-f]{24}$/)).max(250),
    automaticEntityMembershipAllowed: z.literal(false),
    membershipConclusion: knowledgeValueSchema(z.enum(['COMMON_CONTROL', 'COORDINATION_GROUP'])),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.membershipConclusion.state === 'known' ||
      value.nodeIds.length !== new Set(value.nodeIds).size ||
      value.edgeIds.length !== new Set(value.edgeIds).size ||
      value.nodeIds.some((item, index) => item !== [...value.nodeIds].sort()[index]) ||
      value.edgeIds.some((item, index) => item !== [...value.edgeIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['membershipConclusion'],
        message:
          'Investigation components are canonical navigation groups and never known Entity membership conclusions.',
      });
    }
  });
export type EntityInvestigationComponent = z.infer<typeof EntityInvestigationComponentSchema>;

export const EntityInvestigationGraphCoreSchema = z
  .object({
    request: z
      .object({
        ledger: LedgerSchema,
        chainId: z.string().trim().min(1).max(128),
        timelineIds: z
          .array(z.string().regex(/^ert_[0-9a-f]{24}$/))
          .min(1)
          .max(250),
        timelineSetHash: Hash256Schema,
      })
      .strict(),
    nodes: z.array(EntityInvestigationGraphNodeSchema).min(2).max(500),
    observations: z.array(EntityInvestigationGraphObservationSchema).min(1).max(250),
    edges: z.array(EntityInvestigationGraphEdgeSchema).max(250),
    investigationComponents: z.array(EntityInvestigationComponentSchema).min(1).max(500),
    summary: z
      .object({
        nodeCount: z.number().int().min(2).max(500),
        observationCount: z.number().int().min(1).max(250),
        projectedEdgeCount: z.number().int().nonnegative().max(250),
        sameControllerEdgeCount: z.number().int().nonnegative().max(250),
        coordinationEdgeCount: z.number().int().nonnegative().max(250),
        suppressedObservationCount: z.number().int().nonnegative().max(250),
        componentCount: z.number().int().positive().max(500),
        completeRequestedTimelineSet: z.literal(true),
        rawTransferEdgesCopied: z.literal(false),
      })
      .strict(),
    metadata: AnalysisMetadataSchema.extend({
      snapshot: AnalysisSnapshotSchema,
      modelVersion: z.literal('entity-investigation-graph-v0.1.0'),
    }),
  })
  .strict()
  .superRefine((value, context) => {
    const timelineIds = value.observations.map((item) => item.timelineId).sort();
    const nodeIds = value.nodes.map((item) => item.id);
    const subjects = value.nodes.map((item) => item.subjectId);
    const edgeIds = value.edges.map((item) => item.id);
    const evidenceIds = value.observations.map((item) => item.terminalEvidenceId).sort();
    const componentNodeIds = value.investigationComponents.flatMap((item) => item.nodeIds).sort();
    const componentEdgeIds = value.investigationComponents.flatMap((item) => item.edgeIds).sort();
    const issues =
      value.request.timelineIds.length !== new Set(value.request.timelineIds).size ||
      value.request.timelineIds.some(
        (item, index) => item !== [...value.request.timelineIds].sort()[index],
      ) ||
      value.request.timelineIds.length !== timelineIds.length ||
      value.request.timelineIds.some((item, index) => item !== timelineIds[index]) ||
      nodeIds.length !== new Set(nodeIds).size ||
      subjects.length !== new Set(subjects).size ||
      value.nodes.some((item, index) => index > 0 && subjects[index - 1]! >= item.subjectId) ||
      edgeIds.length !== new Set(edgeIds).size ||
      value.edges.some((edge) => {
        const sourceNode = value.nodes.find((node) => node.id === edge.sourceNodeId);
        const targetNode = value.nodes.find((node) => node.id === edge.targetNodeId);
        const observation = value.observations.find((item) => item.timelineId === edge.timelineId);
        if (sourceNode === undefined || targetNode === undefined || observation === undefined) {
          return true;
        }
        return (
          sourceNode.subjectId !== edge.subjectA ||
          targetNode.subjectId !== edge.subjectB ||
          (sourceNode.serviceInfrastructure.state === 'known' &&
            sourceNode.serviceInfrastructure.value) ||
          (sourceNode.serviceInfrastructure.state === 'unknown' &&
            sourceNode.serviceInfrastructure.reason === 'CONFLICTING_SOURCES') ||
          (targetNode.serviceInfrastructure.state === 'known' &&
            targetNode.serviceInfrastructure.value) ||
          (targetNode.serviceInfrastructure.state === 'unknown' &&
            targetNode.serviceInfrastructure.reason === 'CONFLICTING_SOURCES') ||
          observation.subjectA !== edge.subjectA ||
          observation.subjectB !== edge.subjectB ||
          observation.classification !== edge.classification ||
          JSON.stringify(observation.sameControllerProbability) !==
            JSON.stringify(edge.sameControllerProbability) ||
          JSON.stringify(observation.coordinationProbability) !==
            JSON.stringify(edge.coordinationProbability) ||
          JSON.stringify(observation.independenceProbability) !==
            JSON.stringify(edge.independenceProbability) ||
          observation.terminalEvidenceId !== edge.terminalEvidenceId ||
          observation.toPosition !== edge.validToPosition ||
          BigInt(edge.validFromPosition) < BigInt(observation.fromPosition)
        );
      }) ||
      value.observations.some((observation) => {
        const edge = value.edges.find((item) => item.timelineId === observation.timelineId);
        return observation.projectionState === 'PROJECTED'
          ? edge?.id !==
              (observation.projectedEdgeId.state === 'known'
                ? observation.projectedEdgeId.value
                : undefined)
          : edge !== undefined;
      }) ||
      componentNodeIds.length !== nodeIds.length ||
      componentNodeIds.some((item, index) => item !== [...nodeIds].sort()[index]) ||
      componentEdgeIds.length !== edgeIds.length ||
      componentEdgeIds.some((item, index) => item !== [...edgeIds].sort()[index]) ||
      value.summary.nodeCount !== value.nodes.length ||
      value.summary.observationCount !== value.observations.length ||
      value.summary.projectedEdgeCount !== value.edges.length ||
      value.summary.sameControllerEdgeCount !==
        value.edges.filter((item) => item.relation === 'SAME_CONTROLLER').length ||
      value.summary.coordinationEdgeCount !==
        value.edges.filter((item) => item.relation === 'COORDINATED_WITH').length ||
      value.summary.suppressedObservationCount !==
        value.observations.filter((item) => item.projectionState !== 'PROJECTED').length ||
      value.summary.componentCount !== value.investigationComponents.length ||
      value.metadata.evidenceIds.length !== evidenceIds.length ||
      value.metadata.evidenceIds.some((item, index) => item !== evidenceIds[index]);
    if (issues) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message:
          'Investigation graphs require an exact requested timeline set, canonical nodes and edges, service-safe projection, complete components, and terminal Evidence references.',
      });
    }
  });
export type EntityInvestigationGraphCore = z.infer<typeof EntityInvestigationGraphCoreSchema>;

export const EntityInvestigationGraphReportSchema = z
  .object({
    schemaVersion: z.literal('entity-investigation-graph-report-v1'),
    sourceOfTruth: z.literal('DURABLE_ENTITY_RELATIONSHIP_TIMELINES'),
    automaticOwnershipMergeAllowed: z.literal(false),
    graph: EntityInvestigationGraphCoreSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidence: z.array(EvidenceSchema).min(2).max(251),
  })
  .strict()
  .superRefine((value, context) => {
    const snapshot = value.graph.metadata.snapshot;
    const position =
      snapshot.ledger === 'EVM'
        ? { value: snapshot.blockNumber, finality: snapshot.finality }
        : snapshot.ledger === 'BITCOIN'
          ? { value: snapshot.height, finality: snapshot.finality }
          : { value: snapshot.slot, finality: snapshot.commitment };
    const expectedEvidenceIds = [
      ...value.graph.metadata.evidenceIds,
      value.terminalEvidenceId,
    ].sort();
    const evidenceIds = value.evidence.map((item) => item.id);
    const terminal = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    const expectedLocator = `entity-investigation-graph:${value.graph.request.ledger}:${value.graph.request.chainId}:${position.value}:${value.graph.request.timelineSetHash}`;
    const issues =
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((item, index) => item !== [...evidenceIds].sort()[index]) ||
      evidenceIds.length !== expectedEvidenceIds.length ||
      evidenceIds.some((item, index) => item !== expectedEvidenceIds[index]) ||
      value.evidence.some(
        (item) =>
          item.ledger !== value.graph.request.ledger ||
          item.chainId !== value.graph.request.chainId,
      ) ||
      terminal?.kind !== 'DERIVED_FEATURE' ||
      terminal.source !== 'zerotrace:entity-investigation-graph-v0.1.0' ||
      terminal.locator !== expectedLocator ||
      terminal.blockOrSlot !== position.value ||
      terminal.finality !== position.finality;
    if (issues) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message:
          'Investigation graph reports require every timeline terminal Evidence node and one exact-Snapshot graph derivation.',
      });
    }
  });
export type EntityInvestigationGraphReport = z.infer<typeof EntityInvestigationGraphReportSchema>;

export const EntityInvestigationGraphTimelinePairStateSchema = z
  .object({
    timelineId: z.string().regex(/^ert_[0-9a-f]{24}$/),
    classification: EntityResolutionClassSchema,
    sameControllerProbability: knowledgeValueSchema(ConfidenceSchema),
    coordinationProbability: knowledgeValueSchema(ConfidenceSchema),
    independenceProbability: knowledgeValueSchema(ConfidenceSchema),
    serviceSuppressionApplied: z.boolean(),
    projectionState: EntityInvestigationGraphProjectionStateSchema,
    relation: knowledgeValueSchema(EntityInvestigationGraphRelationSchema.nullable()),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    automaticOwnershipPropagationAllowed: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const projectedRelation = value.relation.state === 'known' ? value.relation.value : undefined;
    const validProjection =
      value.projectionState === 'PROJECTED'
        ? projectedRelation === 'SAME_CONTROLLER' || projectedRelation === 'COORDINATED_WITH'
        : projectedRelation === null;
    const validClassification =
      projectedRelation === 'SAME_CONTROLLER'
        ? [
            'CONFIRMED_SAME_CONTROLLER',
            'HIGHLY_PROBABLE_SAME_CONTROLLER',
            'PROBABLE_SAME_CONTROLLER',
          ].includes(value.classification)
        : projectedRelation === 'COORDINATED_WITH'
          ? value.classification === 'COORDINATED_BUT_INDEPENDENT'
          : true;
    if (!validProjection || !validClassification) {
      context.addIssue({
        code: 'custom',
        path: ['relation'],
        message:
          'A temporal pair state must preserve the graph projection state and its classification-compatible relation.',
      });
    }
  });
export type EntityInvestigationGraphTimelinePairState = z.infer<
  typeof EntityInvestigationGraphTimelinePairStateSchema
>;

export const EntityInvestigationGraphTimelinePairObservationSchema = z
  .object({
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    state: EntityInvestigationGraphTimelinePairStateSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subjectA >= value.subjectB) {
      context.addIssue({
        code: 'custom',
        path: ['subjectA'],
        message: 'Temporal graph pair observations require a canonical distinct subject pair.',
      });
    }
  });
export type EntityInvestigationGraphTimelinePairObservation = z.infer<
  typeof EntityInvestigationGraphTimelinePairObservationSchema
>;

const EntityInvestigationGraphTimelinePairKnowledgeSchema = knowledgeValueSchema(
  EntityInvestigationGraphTimelinePairStateSchema,
);

export const EntityInvestigationGraphTimelinePairChangeKindSchema = z.enum([
  'ADDED_TO_REQUESTED_GRAPH',
  'OMITTED_FROM_REQUESTED_GRAPH',
  'PROJECTION_CHANGED',
  'RELATION_CHANGED',
  'CLASSIFICATION_CHANGED',
  'SERVICE_SUPPRESSION_CHANGED',
  'PROBABILITY_CHANGED',
  'EVIDENCE_REFRESHED',
]);
export type EntityInvestigationGraphTimelinePairChangeKind = z.infer<
  typeof EntityInvestigationGraphTimelinePairChangeKindSchema
>;

export const EntityInvestigationGraphTimelinePairChangeSchema = z
  .object({
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
    kind: EntityInvestigationGraphTimelinePairChangeKindSchema,
    before: EntityInvestigationGraphTimelinePairKnowledgeSchema,
    after: EntityInvestigationGraphTimelinePairKnowledgeSchema,
    evidenceIds: z
      .array(z.string().regex(/^ev_[0-9a-f]{24}$/))
      .min(1)
      .max(2),
    relationshipStartEstablished: z.literal(false),
    relationshipEndEstablished: z.literal(false),
    automaticEntityMembershipMutationAllowed: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    const before = value.before.state === 'known' ? value.before.value : undefined;
    const after = value.after.state === 'known' ? value.after.value : undefined;
    let expectedKind: EntityInvestigationGraphTimelinePairChangeKind | undefined;
    if (before === undefined && after !== undefined) expectedKind = 'ADDED_TO_REQUESTED_GRAPH';
    else if (before !== undefined && after === undefined)
      expectedKind = 'OMITTED_FROM_REQUESTED_GRAPH';
    else if (before !== undefined && after !== undefined) {
      if (before.projectionState !== after.projectionState) expectedKind = 'PROJECTION_CHANGED';
      else if (JSON.stringify(before.relation) !== JSON.stringify(after.relation))
        expectedKind = 'RELATION_CHANGED';
      else if (before.classification !== after.classification)
        expectedKind = 'CLASSIFICATION_CHANGED';
      else if (before.serviceSuppressionApplied !== after.serviceSuppressionApplied)
        expectedKind = 'SERVICE_SUPPRESSION_CHANGED';
      else if (
        JSON.stringify(before.sameControllerProbability) !==
          JSON.stringify(after.sameControllerProbability) ||
        JSON.stringify(before.coordinationProbability) !==
          JSON.stringify(after.coordinationProbability) ||
        JSON.stringify(before.independenceProbability) !==
          JSON.stringify(after.independenceProbability)
      )
        expectedKind = 'PROBABILITY_CHANGED';
      else if (
        before.timelineId !== after.timelineId ||
        before.terminalEvidenceId !== after.terminalEvidenceId
      )
        expectedKind = 'EVIDENCE_REFRESHED';
    }
    const expectedEvidenceIds = [before?.terminalEvidenceId, after?.terminalEvidenceId]
      .filter((item): item is string => item !== undefined)
      .filter((item, index, items) => items.indexOf(item) === index)
      .sort();
    const missingStateIsExplicit =
      (value.before.state === 'known' || value.before.reason === 'NOT_QUERIED') &&
      (value.after.state === 'known' || value.after.reason === 'NOT_QUERIED');
    if (
      value.subjectA >= value.subjectB ||
      expectedKind === undefined ||
      value.kind !== expectedKind ||
      !missingStateIsExplicit ||
      value.evidenceIds.length !== expectedEvidenceIds.length ||
      value.evidenceIds.some((item, index) => item !== expectedEvidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['kind'],
        message:
          'Temporal pair changes must be canonical, non-empty, Evidence-bound, and treat omitted pairs as not queried rather than ended.',
      });
    }
  });
export type EntityInvestigationGraphTimelinePairChange = z.infer<
  typeof EntityInvestigationGraphTimelinePairChangeSchema
>;

export const EntityInvestigationGraphTimelineObservationSchema = z
  .object({
    graphId: z.string().regex(/^eig_[0-9a-f]{24}$/),
    resultHash: Hash256Schema,
    timelineSetHash: Hash256Schema,
    subjectIds: z.array(z.string().trim().min(1).max(512)).min(2).max(500),
    pairs: z.array(EntityInvestigationGraphTimelinePairObservationSchema).min(1).max(250),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      snapshot: AnalysisSnapshotSchema,
      modelVersion: z.literal('entity-investigation-graph-v0.1.0'),
    }),
  })
  .strict()
  .superRefine((value, context) => {
    const pairKeys = value.pairs.map((item) => `${item.subjectA}\u0000${item.subjectB}`);
    if (
      value.subjectIds.length !== new Set(value.subjectIds).size ||
      value.subjectIds.some((item, index) => item !== [...value.subjectIds].sort()[index]) ||
      pairKeys.length !== new Set(pairKeys).size ||
      pairKeys.some((item, index) => item !== [...pairKeys].sort()[index]) ||
      value.pairs.some(
        (pair) =>
          !value.subjectIds.includes(pair.subjectA) || !value.subjectIds.includes(pair.subjectB),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['pairs'],
        message:
          'Temporal graph observations require canonical subjects and exactly one ordered observation per pair.',
      });
    }
  });
export type EntityInvestigationGraphTimelineObservation = z.infer<
  typeof EntityInvestigationGraphTimelineObservationSchema
>;

export const EntityInvestigationGraphTimelineTransitionSchema = z
  .object({
    fromGraphId: z.string().regex(/^eig_[0-9a-f]{24}$/),
    toGraphId: z.string().regex(/^eig_[0-9a-f]{24}$/),
    fromPosition: UnsignedQuantityStringSchema,
    toPosition: UnsignedQuantityStringSchema,
    kind: z.enum(['REVISION', 'POSITION_ADVANCE']),
    unobservedPositionCount: UnsignedQuantityStringSchema,
    snapshotContinuity: knowledgeValueSchema(z.boolean()),
    addedSubjectIds: z.array(z.string().trim().min(1).max(512)).max(500),
    omittedSubjectIds: z.array(z.string().trim().min(1).max(512)).max(500),
    pairChanges: z.array(EntityInvestigationGraphTimelinePairChangeSchema).max(500),
    unchangedPairCount: z.number().int().nonnegative().max(250),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).length(2),
    omittedSubjectsEstablishExit: z.literal(false),
    omittedPairsEstablishRelationshipEnd: z.literal(false),
    automaticEntityMembershipMutationAllowed: z.literal(false),
  })
  .strict();
export type EntityInvestigationGraphTimelineTransition = z.infer<
  typeof EntityInvestigationGraphTimelineTransitionSchema
>;

export const EntityInvestigationGraphTimelineCoreSchema = z
  .object({
    request: z
      .object({
        ledger: LedgerSchema,
        chainId: z.string().trim().min(1).max(128),
        graphIds: z
          .array(z.string().regex(/^eig_[0-9a-f]{24}$/))
          .min(2)
          .max(100),
        graphSetHash: Hash256Schema,
        fromPosition: UnsignedQuantityStringSchema,
        toPosition: UnsignedQuantityStringSchema,
      })
      .strict(),
    observations: z.array(EntityInvestigationGraphTimelineObservationSchema).min(2).max(100),
    transitions: z.array(EntityInvestigationGraphTimelineTransitionSchema).min(1).max(99),
    summary: z
      .object({
        observationCount: z.number().int().min(2).max(100),
        transitionCount: z.number().int().min(1).max(99),
        subjectAdditionCount: z.number().int().nonnegative(),
        subjectOmissionCount: z.number().int().nonnegative(),
        pairChangeCount: z.number().int().nonnegative(),
        currentGraphId: z.string().regex(/^eig_[0-9a-f]{24}$/),
        completeRequestedGraphSet: z.literal(true),
        rawTransferEdgesCopied: z.literal(false),
        absenceEstablishesRelationshipTermination: z.literal(false),
        automaticEntityMembershipMutationAllowed: z.literal(false),
        chainObservationContinuity: knowledgeValueSchema(z.boolean()),
      })
      .strict(),
    metadata: AnalysisMetadataSchema.extend({
      snapshot: AnalysisSnapshotSchema,
      modelVersion: z.literal('entity-investigation-graph-timeline-v0.1.0'),
    }),
  })
  .strict()
  .superRefine((value, context) => {
    const position = (observation: EntityInvestigationGraphTimelineObservation) => {
      const snapshot = observation.metadata.snapshot;
      return snapshot.ledger === 'EVM'
        ? snapshot.blockNumber
        : snapshot.ledger === 'BITCOIN'
          ? snapshot.height
          : snapshot.slot;
    };
    const snapshotHash = (observation: EntityInvestigationGraphTimelineObservation) => {
      const snapshot = observation.metadata.snapshot;
      return snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
    };
    const expectedContinuity = (
      before: EntityInvestigationGraphTimelineObservation,
      after: EntityInvestigationGraphTimelineObservation,
    ): KnowledgeValue<boolean> => {
      const beforePosition = BigInt(position(before));
      const afterPosition = BigInt(position(after));
      if (beforePosition === afterPosition) {
        return knownValue(snapshotHash(before) === snapshotHash(after));
      }
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
              afterSnapshot.parentBlockHash.toLowerCase() ===
                beforeSnapshot.blockHash.toLowerCase(),
            );
      }
      if (beforeSnapshot.ledger === 'BITCOIN' && afterSnapshot.ledger === 'BITCOIN') {
        return afterSnapshot.previousBlockHash === undefined
          ? unknownValue(
              'INSUFFICIENT_DATA',
              'The successor Bitcoin Snapshot has no previous hash.',
            )
          : knownValue(afterSnapshot.previousBlockHash === beforeSnapshot.blockHash);
      }
      if (beforeSnapshot.ledger === 'SOLANA' && afterSnapshot.ledger === 'SOLANA') {
        return afterSnapshot.parentSlot === undefined ||
          afterSnapshot.previousBlockhash === undefined
          ? unknownValue(
              'INSUFFICIENT_DATA',
              'The successor Solana Snapshot has no complete parent identity.',
            )
          : knownValue(
              afterSnapshot.parentSlot === position(before) &&
                afterSnapshot.previousBlockhash === beforeSnapshot.blockhash,
            );
      }
      return unavailableValue('CONFLICTING_SOURCES', 'Snapshot ledgers are inconsistent.');
    };
    const observations = value.observations;
    const graphIds = observations.map((item) => item.graphId);
    const evidenceIds = observations.map((item) => item.terminalEvidenceId).sort();
    const latest = observations.at(-1);
    if (latest === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message: 'Investigation graph timelines require at least two graph observations.',
      });
      return;
    }
    let invalid =
      graphIds.length !== new Set(graphIds).size ||
      value.request.graphIds.length !== graphIds.length ||
      value.request.graphIds.some((item, index) => item !== graphIds[index]) ||
      value.request.fromPosition !== position(observations[0]!) ||
      value.request.toPosition !== position(latest) ||
      BigInt(value.request.fromPosition) > BigInt(value.request.toPosition) ||
      observations.some((item, index) => {
        if (
          item.metadata.snapshot.ledger !== value.request.ledger ||
          item.metadata.snapshot.chainId !== value.request.chainId
        )
          return true;
        const previous = observations[index - 1];
        if (previous === undefined) return false;
        const previousPosition = BigInt(position(previous));
        const currentPosition = BigInt(position(item));
        return (
          previousPosition > currentPosition ||
          (previousPosition === currentPosition &&
            (previous.metadata.snapshot.capturedAt > item.metadata.snapshot.capturedAt ||
              (previous.metadata.snapshot.capturedAt === item.metadata.snapshot.capturedAt &&
                previous.graphId >= item.graphId)))
        );
      }) ||
      value.transitions.length !== observations.length - 1;

    for (let index = 0; index < value.transitions.length && !invalid; index += 1) {
      const before = observations[index]!;
      const after = observations[index + 1]!;
      const transition = value.transitions[index]!;
      const beforePosition = BigInt(position(before));
      const afterPosition = BigInt(position(after));
      const beforePairs = new Map(
        before.pairs.map((pair) => [`${pair.subjectA}\u0000${pair.subjectB}`, pair.state]),
      );
      const afterPairs = new Map(
        after.pairs.map((pair) => [`${pair.subjectA}\u0000${pair.subjectB}`, pair.state]),
      );
      const allPairKeys = [...new Set([...beforePairs.keys(), ...afterPairs.keys()])].sort();
      const changedPairKeys = allPairKeys.filter(
        (key) => JSON.stringify(beforePairs.get(key)) !== JSON.stringify(afterPairs.get(key)),
      );
      const transitionPairKeys = transition.pairChanges.map(
        (change) => `${change.subjectA}\u0000${change.subjectB}`,
      );
      const pairChangeStatesMatch = transition.pairChanges.every((change) => {
        const key = `${change.subjectA}\u0000${change.subjectB}`;
        const beforeState = beforePairs.get(key);
        const afterState = afterPairs.get(key);
        const expectedBefore =
          beforeState === undefined
            ? unknownValue(
                'NOT_QUERIED',
                'This pair was not included in the earlier requested investigation graph.',
              )
            : knownValue(beforeState);
        const expectedAfter =
          afterState === undefined
            ? unknownValue(
                'NOT_QUERIED',
                'This pair was not included in the later requested investigation graph.',
              )
            : knownValue(afterState);
        return (
          JSON.stringify(change.before) === JSON.stringify(expectedBefore) &&
          JSON.stringify(change.after) === JSON.stringify(expectedAfter)
        );
      });
      const addedSubjectIds = after.subjectIds.filter((item) => !before.subjectIds.includes(item));
      const omittedSubjectIds = before.subjectIds.filter(
        (item) => !after.subjectIds.includes(item),
      );
      const expectedTransitionEvidence = [
        before.terminalEvidenceId,
        after.terminalEvidenceId,
      ].sort();
      invalid =
        transition.fromGraphId !== before.graphId ||
        transition.toGraphId !== after.graphId ||
        transition.fromPosition !== beforePosition.toString() ||
        transition.toPosition !== afterPosition.toString() ||
        transition.kind !== (beforePosition === afterPosition ? 'REVISION' : 'POSITION_ADVANCE') ||
        transition.unobservedPositionCount !==
          (beforePosition === afterPosition
            ? '0'
            : (afterPosition - beforePosition - 1n).toString()) ||
        JSON.stringify(transition.snapshotContinuity) !==
          JSON.stringify(expectedContinuity(before, after)) ||
        JSON.stringify(transition.addedSubjectIds) !== JSON.stringify(addedSubjectIds) ||
        JSON.stringify(transition.omittedSubjectIds) !== JSON.stringify(omittedSubjectIds) ||
        JSON.stringify(transitionPairKeys) !== JSON.stringify(changedPairKeys) ||
        !pairChangeStatesMatch ||
        transition.unchangedPairCount !== allPairKeys.length - changedPairKeys.length ||
        JSON.stringify(transition.evidenceIds) !== JSON.stringify(expectedTransitionEvidence);
    }

    const continuityValues = value.transitions.map((item) => item.snapshotContinuity);
    const expectedAggregateContinuity: KnowledgeValue<boolean> = continuityValues.some(
      (item) => item.state === 'known' && item.value === false,
    )
      ? knownValue(false)
      : continuityValues.some((item) => item.state === 'unavailable')
        ? unavailableValue(
            continuityValues.find((item) => item.state === 'unavailable')!.reason,
            'At least one graph transition continuity check is unavailable.',
          )
        : continuityValues.some((item) => item.state === 'unknown')
          ? unknownValue(
              continuityValues.find((item) => item.state === 'unknown')!.reason,
              'At least one graph transition lacks complete chain continuity evidence.',
            )
          : knownValue(true);
    invalid =
      invalid ||
      value.summary.observationCount !== observations.length ||
      value.summary.transitionCount !== value.transitions.length ||
      value.summary.subjectAdditionCount !==
        value.transitions.reduce((sum, item) => sum + item.addedSubjectIds.length, 0) ||
      value.summary.subjectOmissionCount !==
        value.transitions.reduce((sum, item) => sum + item.omittedSubjectIds.length, 0) ||
      value.summary.pairChangeCount !==
        value.transitions.reduce((sum, item) => sum + item.pairChanges.length, 0) ||
      value.summary.currentGraphId !== latest.graphId ||
      JSON.stringify(value.summary.chainObservationContinuity) !==
        JSON.stringify(expectedAggregateContinuity) ||
      JSON.stringify(value.metadata.snapshot) !== JSON.stringify(latest.metadata.snapshot) ||
      value.metadata.evidenceIds.length !== evidenceIds.length ||
      value.metadata.evidenceIds.some((item, index) => item !== evidenceIds[index]);

    if (invalid) {
      context.addIssue({
        code: 'custom',
        path: ['observations'],
        message:
          'Investigation graph timelines require ordered exact graph observations, deterministic pair deltas, explicit continuity, and no inferred membership or relationship termination.',
      });
    }
  });
export type EntityInvestigationGraphTimelineCore = z.infer<
  typeof EntityInvestigationGraphTimelineCoreSchema
>;

export const EntityInvestigationGraphTimelineReportSchema = z
  .object({
    schemaVersion: z.literal('entity-investigation-graph-timeline-report-v1'),
    sourceOfTruth: z.literal('DURABLE_ENTITY_INVESTIGATION_GRAPHS'),
    automaticOwnershipMergeAllowed: z.literal(false),
    automaticEntityMembershipMutationAllowed: z.literal(false),
    relationshipTerminationInferenceAllowed: z.literal(false),
    timeline: EntityInvestigationGraphTimelineCoreSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidence: z.array(EvidenceSchema).min(3).max(101),
  })
  .strict()
  .superRefine((value, context) => {
    const latest = value.timeline.observations.at(-1);
    if (latest === undefined) return;
    const snapshot = latest.metadata.snapshot;
    const position =
      snapshot.ledger === 'EVM'
        ? { value: snapshot.blockNumber, finality: snapshot.finality }
        : snapshot.ledger === 'BITCOIN'
          ? { value: snapshot.height, finality: snapshot.finality }
          : { value: snapshot.slot, finality: snapshot.commitment };
    const expectedEvidenceIds = [
      ...value.timeline.metadata.evidenceIds,
      value.terminalEvidenceId,
    ].sort();
    const evidenceIds = value.evidence.map((item) => item.id);
    const terminal = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    const expectedLocator = `entity-investigation-graph-timeline:${value.timeline.request.ledger}:${value.timeline.request.chainId}:${value.timeline.request.fromPosition}-${value.timeline.request.toPosition}:${value.timeline.request.graphSetHash}`;
    const invalid =
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((item, index) => item !== [...evidenceIds].sort()[index]) ||
      evidenceIds.length !== expectedEvidenceIds.length ||
      evidenceIds.some((item, index) => item !== expectedEvidenceIds[index]) ||
      value.evidence.some(
        (item) =>
          item.ledger !== value.timeline.request.ledger ||
          item.chainId !== value.timeline.request.chainId,
      ) ||
      value.timeline.observations.some((observation) => {
        const evidence = value.evidence.find((item) => item.id === observation.terminalEvidenceId);
        return evidence?.source !== 'zerotrace:entity-investigation-graph-v0.1.0';
      }) ||
      terminal?.kind !== 'DERIVED_FEATURE' ||
      terminal.source !== 'zerotrace:entity-investigation-graph-timeline-v0.1.0' ||
      terminal.locator !== expectedLocator ||
      terminal.blockOrSlot !== position.value ||
      terminal.finality !== position.finality;
    if (invalid) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message:
          'Investigation graph timeline reports require exact durable graph terminal Evidence and one latest-Snapshot temporal derivation.',
      });
    }
  });
export type EntityInvestigationGraphTimelineReport = z.infer<
  typeof EntityInvestigationGraphTimelineReportSchema
>;

export const BitcoinScriptClassSchema = z.enum([
  'P2PKH',
  'P2SH',
  'P2WPKH',
  'P2WSH',
  'P2TR',
  'BARE_MULTISIG',
  'OP_RETURN',
  'OTHER_SCRIPT',
]);
export type BitcoinScriptClass = z.infer<typeof BitcoinScriptClassSchema>;

export const BitcoinSpendConditionVisibilitySchema = z.enum([
  'FULLY_VISIBLE',
  'HASH_COMMITTED_HIDDEN',
  'REVEALED_AND_COMMITMENT_VERIFIED',
  'TAPROOT_OUTPUT_KEY_ONLY',
  'TAPROOT_SPEND_OBSERVED',
  'UNSUPPORTED_SCRIPT',
]);
export type BitcoinSpendConditionVisibility = z.infer<typeof BitcoinSpendConditionVisibilitySchema>;

export const BitcoinSignatureRequirementSchema = z.enum([
  'SINGLE_KEY',
  'MULTISIG',
  'KEY_OR_SCRIPT',
  'ARBITRARY_SCRIPT',
  'PROVABLY_UNSPENDABLE',
]);
export type BitcoinSignatureRequirement = z.infer<typeof BitcoinSignatureRequirementSchema>;

export const BitcoinTaprootSpendPathSchema = z.enum(['KEY_PATH', 'SCRIPT_PATH', 'UNDETERMINED']);
export type BitcoinTaprootSpendPath = z.infer<typeof BitcoinTaprootSpendPathSchema>;

export const BitcoinTimelockSchema = z.object({
  kind: z.enum(['ABSOLUTE_HEIGHT', 'ABSOLUTE_TIME', 'RELATIVE_BLOCKS', 'RELATIVE_TIME']),
  value: UnsignedQuantityStringSchema,
  encodedValue: UnsignedQuantityStringSchema,
  detail: z.string().min(1),
});
export type BitcoinTimelock = z.infer<typeof BitcoinTimelockSchema>;

export const BitcoinMultisigObservationSchema = z.object({
  threshold: z.number().int().min(1).max(20),
  signerCount: z.number().int().min(1).max(20),
  publicKeyFingerprints: z.array(Hash256Schema).min(1).max(20),
});
export type BitcoinMultisigObservation = z.infer<typeof BitcoinMultisigObservationSchema>;

export const BitcoinScriptControlAnalysisSchema = z.object({
  scriptClass: BitcoinScriptClassSchema,
  scriptPubKey: z.string().regex(/^(?:[0-9a-f]{2})*$/),
  addressMatch: knowledgeValueSchema(z.boolean()),
  spendConditionVisibility: BitcoinSpendConditionVisibilitySchema,
  signatureRequirement: knowledgeValueSchema(BitcoinSignatureRequirementSchema),
  multisig: knowledgeValueSchema(BitcoinMultisigObservationSchema),
  absoluteTimelocks: z.array(BitcoinTimelockSchema),
  relativeTimelocks: z.array(BitcoinTimelockSchema),
  hashPredicatePresent: knowledgeValueSchema(z.boolean()),
  taprootSpendPath: knowledgeValueSchema(BitcoinTaprootSpendPathSchema),
  revealedScript: knowledgeValueSchema(z.string().regex(/^(?:[0-9a-f]{2})*$/)),
  controllerIdentity: knowledgeValueSchema(z.string().min(1)),
  scriptConditionsComplete: knowledgeValueSchema(z.boolean()),
  modelVersion: z.literal('bitcoin-script-control-v1.0.0'),
});
export type BitcoinScriptControlAnalysis = z.infer<typeof BitcoinScriptControlAnalysisSchema>;

export const BitcoinAddressUtxoSchema = z.object({
  outpoint: z.string().regex(/^[0-9a-f]{64}:(?:0|[1-9]\d*)$/),
  txid: BitcoinHashSchema,
  vout: UnsignedQuantityStringSchema,
  valueSats: UnsignedQuantityStringSchema,
  confirmed: z.boolean(),
  blockHeight: knowledgeValueSchema(UnsignedQuantityStringSchema),
  blockHash: knowledgeValueSchema(BitcoinHashSchema),
});
export type BitcoinAddressUtxo = z.infer<typeof BitcoinAddressUtxoSchema>;

export const BitcoinAddressUtxoSetSchema = z.object({
  address: z.string().min(1),
  utxos: z.array(BitcoinAddressUtxoSchema).max(100_000),
  confirmedUtxoCount: z.number().int().nonnegative(),
  mempoolUtxoCount: z.number().int().nonnegative(),
  totalValueSats: UnsignedQuantityStringSchema,
  statsNetValueSats: QuantityStringSchema,
  balanceAgreement: knowledgeValueSchema(z.boolean()),
  modelVersion: z.literal('bitcoin-address-utxo-v1.0.0'),
});
export type BitcoinAddressUtxoSet = z.infer<typeof BitcoinAddressUtxoSetSchema>;

export const BitcoinTransactionPatternSchema = z.enum([
  'NOT_APPLICABLE',
  'EQUAL_OUTPUT_COINJOIN_LIKE',
  'FANOUT_OR_BATCHING_RISK',
  'NO_STRONG_PATTERN_OBSERVED',
  'INCOMPLETE_INPUT_CONTEXT',
]);
export type BitcoinTransactionPattern = z.infer<typeof BitcoinTransactionPatternSchema>;

export const BitcoinClusteringSuppressionReasonSchema = z.enum([
  'COINJOIN_EQUAL_OUTPUT_PATTERN',
  'PAYJOIN_NOT_EXCLUDABLE',
  'FANOUT_OR_BATCHING_PATTERN',
  'SERVICE_ATTRIBUTION_UNQUERIED',
  'INCOMPLETE_PREVOUT_ADDRESS_COVERAGE',
]);
export type BitcoinClusteringSuppressionReason = z.infer<
  typeof BitcoinClusteringSuppressionReasonSchema
>;

export const BitcoinEqualOutputGroupSchema = z.object({
  valueSats: UnsignedQuantityStringSchema,
  outputCount: z.number().int().min(2),
  vouts: z.array(z.number().int().nonnegative()).min(2),
});
export type BitcoinEqualOutputGroup = z.infer<typeof BitcoinEqualOutputGroupSchema>;

export const BitcoinChangeCandidateSchema = z.object({
  vout: z.number().int().nonnegative(),
  valueSats: UnsignedQuantityStringSchema,
  scriptType: z.string().min(1),
  address: knowledgeValueSchema(z.string().min(1)),
  signals: z
    .array(z.enum(['INPUT_SCRIPT_TYPE_MATCH', 'UNIQUE_OUTPUT_VALUE', 'INPUT_ADDRESS_NOT_REUSED']))
    .min(1),
});
export type BitcoinChangeCandidate = z.infer<typeof BitcoinChangeCandidateSchema>;

export const BitcoinTransactionEntityAnalysisSchema = z.object({
  txid: BitcoinHashSchema,
  coinbase: z.boolean(),
  inputCount: z.number().int().nonnegative(),
  outputCount: z.number().int().nonnegative(),
  inputAddressCoverage: CoverageRatioSchema,
  inputAddresses: z.array(z.string().min(1)),
  outputAddresses: z.array(z.string().min(1)),
  inputValueSats: knowledgeValueSchema(UnsignedQuantityStringSchema),
  outputValueSats: UnsignedQuantityStringSchema,
  feeSats: UnsignedQuantityStringSchema,
  feeReconciles: knowledgeValueSchema(z.boolean()),
  virtualSizeBytes: UnsignedQuantityStringSchema,
  feeRateSatPerVbyte: knowledgeValueSchema(DecimalStringSchema),
  equalOutputGroups: z.array(BitcoinEqualOutputGroupSchema),
  structuralPattern: BitcoinTransactionPatternSchema,
  payjoinContaminationRisk: knowledgeValueSchema(z.boolean()),
  serviceClusterRisk: knowledgeValueSchema(z.boolean()),
  addressReuseOutputVouts: z.array(z.number().int().nonnegative()),
  commonInputHeuristic: knowledgeValueSchema(z.boolean()),
  commonInputOwnershipCandidate: knowledgeValueSchema(z.array(z.string().min(1)).min(2)),
  automaticOwnershipMergeAllowed: z.literal(false),
  suppressionReasons: z.array(BitcoinClusteringSuppressionReasonSchema),
  changeCandidates: z.array(BitcoinChangeCandidateSchema),
  selectedChangeOutput: knowledgeValueSchema(z.number().int().nonnegative()),
  ownershipConclusion: knowledgeValueSchema(z.string().min(1)),
  externalAttribution: knowledgeValueSchema(z.string().min(1)),
  modelVersion: z.literal('bitcoin-transaction-entity-v1.0.0'),
});
export type BitcoinTransactionEntityAnalysis = z.infer<
  typeof BitcoinTransactionEntityAnalysisSchema
>;

export const BitcoinForensicGraphNodeKindSchema = z.enum([
  'ADDRESS',
  'OUTPOINT',
  'TRANSACTION',
  'SERVICE',
  'UNKNOWN',
]);
export type BitcoinForensicGraphNodeKind = z.infer<typeof BitcoinForensicGraphNodeKindSchema>;

export const BitcoinForensicGraphNodeSchema = z
  .object({
    id: z.string().min(1).max(256),
    kind: BitcoinForensicGraphNodeKindSchema,
    reference: z.string().min(1).max(256),
    label: knowledgeValueSchema(z.string().min(1).max(160)),
    valueSats: knowledgeValueSchema(UnsignedQuantityStringSchema),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
  })
  .strict();
export type BitcoinForensicGraphNode = z.infer<typeof BitcoinForensicGraphNodeSchema>;

export const BitcoinForensicGraphEdgeKindSchema = z.enum([
  'UTXO_FUNDING',
  'UTXO_SPEND',
  'COMMON_INPUT_CANDIDATE',
  'CHANGE_CANDIDATE',
  'PEELING_PATTERN',
  'FANOUT_PATTERN',
  'CONSOLIDATION_PATTERN',
  'FUNDING_PATH',
  'SETTLEMENT_PATH',
  'SERVICE_SUPPRESSED',
  'COINJOIN_SUPPRESSED',
  'PAYJOIN_UNKNOWN',
]);
export type BitcoinForensicGraphEdgeKind = z.infer<typeof BitcoinForensicGraphEdgeKindSchema>;

export const BitcoinForensicGraphEdgeClassificationSchema = z.enum([
  'OBSERVED',
  'HEURISTIC_CANDIDATE',
  'SUPPRESSED',
  'UNKNOWN',
]);
export type BitcoinForensicGraphEdgeClassification = z.infer<
  typeof BitcoinForensicGraphEdgeClassificationSchema
>;

export const BitcoinForensicGraphEdgeSchema = z
  .object({
    id: z.string().regex(/^bge_[0-9a-f]{24}$/),
    from: z.string().min(1).max(256),
    to: z.string().min(1).max(256),
    kind: BitcoinForensicGraphEdgeKindSchema,
    classification: BitcoinForensicGraphEdgeClassificationSchema,
    amountSats: knowledgeValueSchema(UnsignedQuantityStringSchema),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    reason: z.string().min(1).max(320),
    automaticOwnershipMergeAllowed: z.literal(false),
  })
  .strict();
export type BitcoinForensicGraphEdge = z.infer<typeof BitcoinForensicGraphEdgeSchema>;

export const BitcoinForensicEvidenceLinePhaseSchema = z
  .object({
    phase: z.enum(['FUNDING', 'FLOW', 'SETTLEMENT', 'NEGATIVE']),
    edgeIds: z.array(z.string().regex(/^bge_[0-9a-f]{24}$/)),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
    coverage: CoverageRatioSchema,
    attributionStopped: z.boolean(),
  })
  .strict();
export type BitcoinForensicEvidenceLinePhase = z.infer<
  typeof BitcoinForensicEvidenceLinePhaseSchema
>;

export const BitcoinForensicEvidenceLineSchema = z
  .object({
    schemaVersion: z.literal('bitcoin-forensic-evidence-line-v1'),
    graphId: z.string().regex(/^bfg_[0-9a-f]{24}$/),
    phases: z.array(BitcoinForensicEvidenceLinePhaseSchema),
    terminalBoundary: z.enum(['NONE_OBSERVED', 'SERVICE_BOUNDARY', 'UNKNOWN']),
    edgeIds: z.array(z.string().regex(/^bge_[0-9a-f]{24}$/)),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
    snapshotStart: BitcoinSnapshotSchema,
    snapshotEnd: BitcoinSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('bitcoin-forensic-graph-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    resultHash: Hash256Schema,
  })
  .strict();
export type BitcoinForensicEvidenceLine = z.infer<typeof BitcoinForensicEvidenceLineSchema>;

export const BitcoinForensicCaseBundleSchema = z
  .object({
    schemaVersion: z.literal('bitcoin-forensic-case-v1'),
    id: z.string().regex(/^bfc_[0-9a-f]{24}$/),
    graphId: z.string().regex(/^bfg_[0-9a-f]{24}$/),
    ledger: z.literal('BITCOIN'),
    chainId: z.literal('bitcoin-mainnet'),
    evidenceLine: BitcoinForensicEvidenceLineSchema,
    automaticOwnershipMergeAllowed: z.literal(false),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    snapshot: BitcoinSnapshotSchema,
    modelVersion: z.literal('bitcoin-forensic-graph-v1.0.0'),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.evidenceLine.graphId !== value.graphId ||
      value.evidenceLine.snapshotEnd.blockHash !== value.snapshot.blockHash ||
      JSON.stringify(value.evidenceIds) !==
        JSON.stringify([...value.evidenceLine.evidenceIds].sort())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceLine'],
        message: 'Bitcoin forensic case references must be canonical and identity-consistent.',
      });
    }
  });
export type BitcoinForensicCaseBundle = z.infer<typeof BitcoinForensicCaseBundleSchema>;

export const BitcoinForensicGraphReportSchema = z
  .object({
    schemaVersion: z.literal('bitcoin-forensic-graph-v1'),
    id: z.string().regex(/^bfg_[0-9a-f]{24}$/),
    ledger: z.literal('BITCOIN'),
    chainId: z.literal('bitcoin-mainnet'),
    rootTxids: z.array(BitcoinHashSchema).min(1).max(100),
    transactionIds: z.array(BitcoinHashSchema).min(1).max(100),
    nodes: z.array(BitcoinForensicGraphNodeSchema).max(2_000),
    edges: z.array(BitcoinForensicGraphEdgeSchema).max(10_000),
    transactionAnalyses: z.array(BitcoinTransactionEntityAnalysisSchema).max(100),
    suppressionReasons: z.array(BitcoinClusteringSuppressionReasonSchema),
    case: BitcoinForensicCaseBundleSchema,
    snapshotStart: BitcoinSnapshotSchema,
    snapshotEnd: BitcoinSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('bitcoin-forensic-graph-v1.0.0'),
    policyVersion: z.literal('bitcoin-forensic-policy-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    automaticOwnershipMergeAllowed: z.literal(false),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const nodeIds = new Set(value.nodes.map((node) => node.id));
    const edgeIds = new Set<string>();
    for (const edge of value.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        context.addIssue({
          code: 'custom',
          path: ['edges'],
          message: 'Bitcoin forensic graph edges must reference graph nodes.',
        });
      }
      if (edgeIds.has(edge.id)) {
        context.addIssue({
          code: 'custom',
          path: ['edges'],
          message: 'Bitcoin forensic graph edge IDs must be unique.',
        });
      }
      edgeIds.add(edge.id);
    }
    if (
      value.snapshotStart.blockHash === value.snapshotEnd.blockHash &&
      value.snapshotStart.height !== value.snapshotEnd.height
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshotEnd'],
        message: 'Bitcoin Snapshot heights cannot differ while sharing a block hash.',
      });
    }
    if (
      value.case.graphId !== value.id ||
      value.case.snapshot.blockHash !== value.snapshotEnd.blockHash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['case'],
        message: 'Bitcoin forensic case must reference the enclosing graph and final Snapshot.',
      });
    }
  });
export type BitcoinForensicGraphReport = z.infer<typeof BitcoinForensicGraphReportSchema>;

export const EvmControlRightTypeSchema = z.enum([
  'OWNER',
  'PROXY_ADMIN',
  'UPGRADE',
  'MINT',
  'BURN',
  'TAX_CHANGE',
  'BLACKLIST',
  'WHITELIST',
  'TRADING_SWITCH',
  'MAX_TX',
  'MAX_WALLET',
  'FEE_EXEMPTION',
  'ROUTER_CHANGE',
  'TREASURY',
  'SAFE_OWNER',
  'SAFE_MODULE',
  'SAFE_GUARD',
  'SAFE_FALLBACK_HANDLER',
  'LP_POSITION',
  'MIGRATION',
]);
export type EvmControlRightType = z.infer<typeof EvmControlRightTypeSchema>;

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

export const EvmControlRightSchema = z.object({
  id: z.string().regex(/^cr_[0-9a-f]{24}$/),
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  subject: EvmCanonicalAddressSchema,
  controller: EvmCanonicalAddressSchema,
  rightType: EvmControlRightTypeSchema,
  scope: z.string().min(1),
  threshold: knowledgeValueSchema(DecimalStringSchema),
  constraints: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  activeFrom: knowledgeValueSchema(IsoDateTimeSchema),
  activeTo: knowledgeValueSchema(IsoDateTimeSchema),
});
export type EvmControlRight = z.infer<typeof EvmControlRightSchema>;

export const EvmControlCoverageDomainSchema = z.enum([
  'CONTRACT_CODE',
  'LOGIC_CODE',
  'ERC1167_IMPLEMENTATION',
  'EIP1967_IMPLEMENTATION',
  'EIP1967_ADMIN',
  'EIP1967_BEACON',
  'ERC173_OWNER',
  'SAFE_OWNERS_THRESHOLD',
  'SAFE_MODULES',
  'SAFE_GUARD',
  'SAFE_FALLBACK_HANDLER',
  'UPGRADE_AUTHORIZATION',
  'MINT',
  'BURN',
  'TAX_CHANGE',
  'BLACKLIST',
  'WHITELIST',
  'TRADING_SWITCH',
  'MAX_TX',
  'MAX_WALLET',
  'FEE_EXEMPTION',
  'ROUTER_CHANGE',
  'TREASURY',
  'LP_POSITION',
  'MIGRATION',
]);
export type EvmControlCoverageDomain = z.infer<typeof EvmControlCoverageDomainSchema>;

export const EvmControlCoverageSchema = z.object({
  domain: EvmControlCoverageDomainSchema,
  observed: knowledgeValueSchema(z.boolean()),
  detail: z.string().min(1),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
});
export type EvmControlCoverage = z.infer<typeof EvmControlCoverageSchema>;

export const EvmContractKindSchema = z.enum([
  'EOA',
  'DIRECT_CONTRACT',
  'ERC1167_MINIMAL_PROXY',
  'EIP1967_PROXY',
  'EIP1967_BEACON_PROXY',
  'SAFE_PROXY',
]);
export type EvmContractKind = z.infer<typeof EvmContractKindSchema>;

export const EvmSafeControlSchema = z.object({
  owners: z.array(EvmCanonicalAddressSchema).min(1).max(100),
  threshold: UnsignedQuantityStringSchema.refine((value) => BigInt(value) > 0n),
  nonce: UnsignedQuantityStringSchema,
  implementationAddress: EvmCanonicalAddressSchema,
  implementationVersion: z.string().min(1).max(64),
});
export type EvmSafeControl = z.infer<typeof EvmSafeControlSchema>;

export const EvmLogicCodeRelationSchema = z.enum([
  'SUBJECT',
  'ERC1167_IMPLEMENTATION',
  'EIP1967_IMPLEMENTATION',
  'BEACON_IMPLEMENTATION',
  'SAFE_SINGLETON',
]);
export type EvmLogicCodeRelation = z.infer<typeof EvmLogicCodeRelationSchema>;

export const EvmLogicCodeSchema = z.object({
  address: EvmCanonicalAddressSchema,
  relation: EvmLogicCodeRelationSchema,
  runtimeBytecodeHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  runtimeBytecodeBytes: z.number().int().positive().max(1_000_000),
});
export type EvmLogicCode = z.infer<typeof EvmLogicCodeSchema>;

export const EvmVerifiedSourceDeploymentSchema = z.object({
  blockNumber: UnsignedQuantityStringSchema,
  transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  deployer: EvmCanonicalAddressSchema,
});
export type EvmVerifiedSourceDeployment = z.infer<typeof EvmVerifiedSourceDeploymentSchema>;

export const EvmVerifiedSourceSchema = z.object({
  sourceId: z.string().min(1),
  sourceUri: z.url(),
  address: EvmCanonicalAddressSchema,
  matchType: z.literal('exact_match'),
  runtimeBytecodeHash: z.string().regex(/^0x[0-9a-f]{64}$/),
  runtimeBytecodeBytes: z.number().int().positive().max(1_000_000),
  contractName: z.string().min(1).max(256),
  fullyQualifiedName: z.string().min(1).max(1_024),
  language: z.string().min(1).max(64),
  compilerVersion: z.string().min(1).max(256),
  verifiedAt: IsoDateTimeSchema,
  deployment: knowledgeValueSchema(EvmVerifiedSourceDeploymentSchema),
  abiFunctionCount: z.number().int().nonnegative().max(2_048),
  mutatingFunctionSignatures: z.array(z.string().min(1).max(2_048)).max(2_048),
});
export type EvmVerifiedSource = z.infer<typeof EvmVerifiedSourceSchema>;

export const EvmDeclaredCapabilitySchema = z.object({
  rightType: EvmControlRightTypeSchema,
  functionSignatures: z.array(z.string().min(1).max(2_048)).min(1).max(64),
  detail: z.string().min(1),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
});
export type EvmDeclaredCapability = z.infer<typeof EvmDeclaredCapabilitySchema>;

export const EvmControlSurfaceReportSchema = z
  .object({
    ledger: z.literal('EVM'),
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    subject: EvmCanonicalAddressSchema,
    contractKind: knowledgeValueSchema(EvmContractKindSchema),
    implementationAddress: knowledgeValueSchema(EvmCanonicalAddressSchema),
    proxyAdminAddress: knowledgeValueSchema(EvmCanonicalAddressSchema),
    beaconAddress: knowledgeValueSchema(EvmCanonicalAddressSchema),
    ownerAddress: knowledgeValueSchema(EvmCanonicalAddressSchema),
    safe: knowledgeValueSchema(EvmSafeControlSchema),
    logicCode: knowledgeValueSchema(EvmLogicCodeSchema).optional(),
    verifiedSource: knowledgeValueSchema(EvmVerifiedSourceSchema).optional(),
    declaredCapabilities: z.array(EvmDeclaredCapabilitySchema).optional(),
    sourceAgreement: knowledgeValueSchema(z.boolean()),
    sourceIndependence: knowledgeValueSchema(z.boolean()),
    rights: z.array(EvmControlRightSchema),
    coverage: z.array(EvmControlCoverageSchema),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot?.ledger === 'EVM', {
      message: 'EVM control surface requires an EVM Snapshot.',
    }),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    if (
      snapshot?.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.chainId !== value.chainId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Control surface identity requires one finalized matching EVM Snapshot.',
      });
    }
    const domains = value.coverage.map((item) => item.domain);
    const expectedDomains = EvmControlCoverageDomainSchema.options
      .filter(
        (domain) =>
          value.metadata.modelVersion !== 'evm-control-surface-v1.0.0' ||
          !['LOGIC_CODE', 'MIGRATION'].includes(domain),
      )
      .sort();
    if (
      domains.length !== expectedDomains.length ||
      [...new Set(domains)].sort().some((domain, index) => domain !== expectedDomains[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['coverage'],
        message: 'Control surface coverage must include every EVM control domain exactly once.',
      });
    }
    const evidenceIds = value.evidence.map((item) => item.id).sort();
    const metadataEvidenceIds = value.metadata.evidenceIds;
    const nestedEvidenceIds = [
      ...value.rights.flatMap((right) => right.evidenceIds),
      ...value.coverage.flatMap((item) => item.evidenceIds),
      ...(value.declaredCapabilities ?? []).flatMap((item) => item.evidenceIds),
    ];
    if (
      metadataEvidenceIds.length !== new Set(metadataEvidenceIds).size ||
      metadataEvidenceIds.some((id, index) => id !== evidenceIds[index]) ||
      evidenceIds.length !== metadataEvidenceIds.length ||
      !metadataEvidenceIds.includes(value.terminalEvidenceId) ||
      nestedEvidenceIds.some((id) => !metadataEvidenceIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'evidenceIds'],
        message: 'Control surface provenance must be canonical and contain all nested Evidence.',
      });
    }
    if (
      value.logicCode?.state === 'known' &&
      value.verifiedSource?.state === 'known' &&
      (value.logicCode.value.address !== value.verifiedSource.value.address ||
        value.logicCode.value.runtimeBytecodeHash !==
          value.verifiedSource.value.runtimeBytecodeHash ||
        value.logicCode.value.runtimeBytecodeBytes !==
          value.verifiedSource.value.runtimeBytecodeBytes)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['verifiedSource'],
        message: 'Verified source must match the exact Snapshot-bound logic bytecode.',
      });
    }
    if (
      value.metadata.modelVersion === 'evm-control-surface-v1.1.0' &&
      (value.logicCode === undefined ||
        value.verifiedSource === undefined ||
        value.declaredCapabilities === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'modelVersion'],
        message: 'Control surface v1.1 requires logic code and verified-source fields.',
      });
    }
  });
export type EvmControlSurfaceReport = z.infer<typeof EvmControlSurfaceReportSchema>;

export const SolanaPublicKeySchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const SolanaLaunchpadPlatformSchema = z.enum(['PUMP', 'PUMPSWAP', 'RAYDIUM_LAUNCHLAB']);
export type SolanaLaunchpadPlatform = z.infer<typeof SolanaLaunchpadPlatformSchema>;

export const SolanaLaunchpadInstructionCategorySchema = z.enum([
  'CREATE',
  'TRADE',
  'MIGRATION',
  'POOL_CREATE',
  'LIQUIDITY',
  'SWAP',
  'ADMIN_OR_UTILITY',
]);
export type SolanaLaunchpadInstructionCategory = z.infer<
  typeof SolanaLaunchpadInstructionCategorySchema
>;

export const SolanaLaunchpadExecutionSchema = z.enum(['SUCCESS', 'FAILED', 'UNKNOWN']);

export const SolanaLaunchpadDecodedArgumentSchema = z.object({
  name: z.string().min(1).max(128),
  value: z.string().max(2048),
});
export type SolanaLaunchpadDecodedArgument = z.infer<typeof SolanaLaunchpadDecodedArgumentSchema>;

export const SolanaLaunchpadAccountSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1).max(128),
  address: SolanaPublicKeySchema.optional(),
});
export type SolanaLaunchpadAccount = z.infer<typeof SolanaLaunchpadAccountSchema>;

export const SolanaLaunchpadObservationSchema = z
  .object({
    schemaVersion: z.literal('solana-launchpad-observation-v1'),
    id: z.string().regex(/^slo_[0-9a-f]{24}$/),
    platform: SolanaLaunchpadPlatformSchema,
    programId: SolanaPublicKeySchema,
    deploymentId: z.string().min(1).max(128),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
    abiOrIdlHash: Hash256Schema,
    officialSourceUris: z.array(z.string().url()).min(1),
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
    slot: UnsignedQuantityStringSchema,
    instructionPath: z.string().regex(/^outer:\d+(?:\/inner:\d+)?$/),
    instructionName: z.string().min(1).max(128),
    instructionVersion: z.enum(['LEGACY', 'V2', 'CURRENT']),
    category: SolanaLaunchpadInstructionCategorySchema,
    discriminator: z.string().regex(/^[0-9a-f]{16}$/),
    accountIndexes: z.array(z.number().int().nonnegative()).max(256),
    accounts: z.array(SolanaLaunchpadAccountSchema).max(256),
    accountCoverage: CoverageRatioSchema,
    decodedArguments: z.array(SolanaLaunchpadDecodedArgumentSchema).max(64),
    argumentCoverage: CoverageRatioSchema,
    decodeWarnings: z.array(z.string().min(1).max(320)).max(16),
    execution: SolanaLaunchpadExecutionSchema,
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.slot
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana launchpad observations require an exact finalized slot Snapshot.',
      });
    }
    const evidenceIds = [...value.evidenceIds].sort();
    if (
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((id, index) => id !== evidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Launchpad observation Evidence IDs must be sorted and unique.',
      });
    }
  });
export type SolanaLaunchpadObservation = z.infer<typeof SolanaLaunchpadObservationSchema>;

export const RaydiumLaunchlabPoolStateReadIdSchema = z.string().regex(/^rlp_[0-9a-f]{24}$/);

export const RaydiumLaunchlabPoolStateReadSchema = z
  .object({
    schemaVersion: z.literal('raydium-launchlab-pool-state-read-v1'),
    id: RaydiumLaunchlabPoolStateReadIdSchema,
    account: SolanaPublicKeySchema,
    programId: SolanaPublicKeySchema,
    exists: z.boolean(),
    ownerVerified: z.boolean(),
    discriminatorMatched: z.boolean(),
    accountDataLength: z.number().int().nonnegative(),
    expectedAccountDataLength: z.number().int().positive(),
    requestedSlot: UnsignedQuantityStringSchema.optional(),
    observedContextSlot: UnsignedQuantityStringSchema,
    stateAtRequestedSlot: z.enum(['EXACT', 'MIN_CONTEXT_ONLY', 'UNKNOWN']),
    decodedFields: z.array(SolanaLaunchpadDecodedArgumentSchema).max(64),
    fieldCoverage: CoverageRatioSchema,
    decodeWarnings: z.array(z.string().min(1).max(320)).max(16),
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('solana-raydium-launchlab-v1.0.0'),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.observedContextSlot ||
      value.snapshot.commitment !== 'finalized'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Raydium PoolState reads require a finalized Snapshot at the RPC context slot.',
      });
    }
    if (!value.exists && (value.ownerVerified || value.discriminatorMatched)) {
      context.addIssue({
        code: 'custom',
        path: ['exists'],
        message: 'An absent PoolState account cannot be owner- or discriminator-verified.',
      });
    }
    if (value.ownerVerified && !value.discriminatorMatched && value.fieldCoverage > 0) {
      context.addIssue({
        code: 'custom',
        path: ['fieldCoverage'],
        message: 'A non-PoolState discriminator cannot carry decoded PoolState fields.',
      });
    }
    const evidenceIds = [...value.evidenceIds].sort();
    if (
      evidenceIds.length !== new Set(evidenceIds).size ||
      evidenceIds.some((id, index) => id !== evidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Raydium PoolState read Evidence IDs must be sorted and unique.',
      });
    }
    if (value.stateAtRequestedSlot === 'EXACT' && value.requestedSlot !== undefined) {
      if (value.requestedSlot !== value.observedContextSlot) {
        context.addIssue({
          code: 'custom',
          path: ['stateAtRequestedSlot'],
          message:
            'EXACT PoolState state must have the requested slot as its observed context slot.',
        });
      }
    }
  });
export type RaydiumLaunchlabPoolStateRead = z.infer<typeof RaydiumLaunchlabPoolStateReadSchema>;

export const SolanaTransactionAccountSourceSchema = z.enum([
  'STATIC',
  'LOOKUP_WRITABLE',
  'LOOKUP_READONLY',
]);
export type SolanaTransactionAccountSource = z.infer<typeof SolanaTransactionAccountSourceSchema>;

export const SolanaTransactionAccountSchema = z.object({
  index: z.number().int().nonnegative(),
  address: SolanaPublicKeySchema,
  source: SolanaTransactionAccountSourceSchema,
  signer: z.boolean(),
  writable: z.boolean(),
  feePayer: z.boolean(),
  preBalanceLamports: knowledgeValueSchema(UnsignedQuantityStringSchema),
  postBalanceLamports: knowledgeValueSchema(UnsignedQuantityStringSchema),
  balanceDeltaLamports: knowledgeValueSchema(QuantityStringSchema),
});
export type SolanaTransactionAccount = z.infer<typeof SolanaTransactionAccountSchema>;

export const SolanaAddressTableLookupObservationSchema = z.object({
  accountKey: SolanaPublicKeySchema,
  writableIndexes: z.array(z.number().int().min(0).max(255)),
  readonlyIndexes: z.array(z.number().int().min(0).max(255)),
});
export type SolanaAddressTableLookupObservation = z.infer<
  typeof SolanaAddressTableLookupObservationSchema
>;

export const SolanaInstructionObservationSchema = z.object({
  path: z.string().regex(/^outer:\d+(?:\/inner:\d+)?$/),
  outerIndex: z.number().int().nonnegative(),
  innerIndex: knowledgeValueSchema(z.number().int().nonnegative()),
  stackHeight: knowledgeValueSchema(z.number().int().nonnegative()),
  programIdIndex: z.number().int().nonnegative(),
  programId: knowledgeValueSchema(SolanaPublicKeySchema),
  accountIndexes: z.array(z.number().int().nonnegative()),
  accounts: knowledgeValueSchema(z.array(SolanaPublicKeySchema)),
  dataBase58: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]*$/),
  programSemantic: knowledgeValueSchema(
    z.object({
      programFamily: z.enum(['SYSTEM', 'SPL_TOKEN', 'TOKEN_2022']),
      instructionName: z.string().min(1).max(128),
      category: z.enum([
        'ASSET_TRANSFER',
        'SUPPLY_INCREASE',
        'SUPPLY_DECREASE',
        'ACCOUNT_LIFECYCLE',
        'CONTROL_CHANGE',
        'OTHER',
      ]),
      application: z.enum(['APPLIED', 'NOT_APPLIED', 'UNKNOWN']),
    }),
  ),
});
export type SolanaInstructionObservation = z.infer<typeof SolanaInstructionObservationSchema>;

export const SolanaAssetFlowSchema = z.object({
  id: z.string().regex(/^outer:\d+(?:\/inner:\d+)?:flow:\d+$/),
  instructionPath: z.string().regex(/^outer:\d+(?:\/inner:\d+)?$/),
  programFamily: z.enum(['SYSTEM', 'SPL_TOKEN', 'TOKEN_2022']),
  instructionName: z.string().min(1).max(128),
  application: z.enum(['APPLIED', 'NOT_APPLIED', 'UNKNOWN']),
  flowKind: z.enum(['TRANSFER', 'MINT', 'BURN']),
  assetKind: z.enum(['NATIVE_SOL', 'WRAPPED_SOL', 'SPL_TOKEN', 'TOKEN_2022']),
  sourceAccount: knowledgeValueSchema(SolanaPublicKeySchema),
  destinationAccount: knowledgeValueSchema(SolanaPublicKeySchema),
  sourceOwner: knowledgeValueSchema(SolanaPublicKeySchema),
  destinationOwner: knowledgeValueSchema(SolanaPublicKeySchema),
  mint: knowledgeValueSchema(SolanaPublicKeySchema),
  authority: knowledgeValueSchema(SolanaPublicKeySchema),
  amount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  decimals: knowledgeValueSchema(z.number().int().min(0).max(255)),
  expectedFeeAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  expectedRecipientAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
});
export type SolanaAssetFlow = z.infer<typeof SolanaAssetFlowSchema>;

export const SolanaTokenFlowReconciliationSchema = z.object({
  status: z.enum(['MATCHED', 'PARTIAL', 'CONFLICT', 'NOT_APPLICABLE', 'UNKNOWN']),
  expectedIdentityCount: z.number().int().nonnegative(),
  observedIdentityCount: z.number().int().nonnegative(),
  matchedIdentityCount: z.number().int().nonnegative(),
  conflictingIdentityCount: z.number().int().nonnegative(),
  unknownIdentityCount: z.number().int().nonnegative(),
  unmodeledTokenInstructionCount: z.number().int().nonnegative(),
  coverage: CoverageRatioSchema,
  recommendedMaxRelativeError: z.literal(0),
  observedRelativeError: knowledgeValueSchema(z.number().nonnegative()),
  detail: z.string().min(1),
});
export type SolanaTokenFlowReconciliation = z.infer<typeof SolanaTokenFlowReconciliationSchema>;

export const SolanaTokenBalanceChangeSchema = z.object({
  accountIndex: z.number().int().nonnegative(),
  account: knowledgeValueSchema(SolanaPublicKeySchema),
  mint: SolanaPublicKeySchema,
  ownerBefore: knowledgeValueSchema(SolanaPublicKeySchema),
  ownerAfter: knowledgeValueSchema(SolanaPublicKeySchema),
  programId: knowledgeValueSchema(SolanaPublicKeySchema),
  decimals: knowledgeValueSchema(z.number().int().min(0).max(255)),
  preAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  postAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
  deltaAmount: knowledgeValueSchema(QuantityStringSchema),
});
export type SolanaTokenBalanceChange = z.infer<typeof SolanaTokenBalanceChangeSchema>;

export const SolanaTransactionSemanticsSchema = z.object({
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
  version: z.union([z.literal('legacy'), UnsignedQuantityStringSchema]),
  recentBlockhash: SolanaPublicKeySchema,
  execution: z.enum(['SUCCESS', 'FAILED', 'METADATA_UNAVAILABLE']),
  executionError: knowledgeValueSchema(JsonValueSchema),
  feePayer: knowledgeValueSchema(SolanaPublicKeySchema),
  signers: z.array(SolanaPublicKeySchema).min(1),
  requiredSignatureCount: z.number().int().positive(),
  staticAccountCount: z.number().int().positive(),
  loadedWritableAccountCount: z.number().int().nonnegative(),
  loadedReadonlyAccountCount: z.number().int().nonnegative(),
  accountResolutionComplete: knowledgeValueSchema(z.boolean()),
  accountCoverage: CoverageRatioSchema,
  recordingCoverage: CoverageRatioSchema,
  accounts: z.array(SolanaTransactionAccountSchema).min(1),
  addressTableLookups: z.array(SolanaAddressTableLookupObservationSchema),
  outerInstructions: z.array(SolanaInstructionObservationSchema),
  innerInstructionRecording: knowledgeValueSchema(z.boolean()),
  innerInstructions: z.array(SolanaInstructionObservationSchema),
  cpiCount: knowledgeValueSchema(z.number().int().nonnegative()),
  programIds: z.array(SolanaPublicKeySchema),
  officialProgramInstructionCount: z.number().int().nonnegative(),
  identifiedOfficialProgramInstructionCount: z.number().int().nonnegative(),
  officialProgramIdentificationCoverage: knowledgeValueSchema(CoverageRatioSchema),
  assetFlowCandidateCount: z.number().int().nonnegative(),
  assetFlowDecodeCoverage: knowledgeValueSchema(CoverageRatioSchema),
  assetFlowCoverage: knowledgeValueSchema(CoverageRatioSchema),
  assetFlows: z.array(SolanaAssetFlowSchema),
  tokenFlowReconciliation: SolanaTokenFlowReconciliationSchema,
  tokenBalanceRecording: knowledgeValueSchema(z.boolean()),
  tokenBalanceChanges: z.array(SolanaTokenBalanceChangeSchema),
  computeUnitsConsumed: knowledgeValueSchema(UnsignedQuantityStringSchema),
  logRecording: knowledgeValueSchema(z.boolean()),
  logCount: knowledgeValueSchema(z.number().int().nonnegative()),
  modelVersion: z.literal('solana-transaction-semantics-v1.1.0'),
});
export type SolanaTransactionSemantics = z.infer<typeof SolanaTransactionSemanticsSchema>;

export const SolanaTransactionFactsSchema = z.object({
  status: knowledgeValueSchema(z.literal('CONFIRMED')),
  slot: knowledgeValueSchema(UnsignedQuantityStringSchema),
  blockTime: knowledgeValueSchema(IsoDateTimeSchema),
  version: knowledgeValueSchema(z.union([z.literal('legacy'), UnsignedQuantityStringSchema])),
  feeLamports: knowledgeValueSchema(UnsignedQuantityStringSchema),
  execution: knowledgeValueSchema(z.enum(['SUCCESS', 'FAILED'])),
  transactionSemantics: knowledgeValueSchema(SolanaTransactionSemanticsSchema),
  feePayer: knowledgeValueSchema(SolanaPublicKeySchema),
  signerCount: knowledgeValueSchema(z.number().int().nonnegative()),
  outerInstructionCount: knowledgeValueSchema(z.number().int().nonnegative()),
  cpiCount: knowledgeValueSchema(z.number().int().nonnegative()),
  accountResolutionComplete: knowledgeValueSchema(z.boolean()),
  tokenBalanceChangeCount: knowledgeValueSchema(z.number().int().nonnegative()),
  coreAssetFlowCount: knowledgeValueSchema(z.number().int().nonnegative()),
  tokenFlowReconciliation: knowledgeValueSchema(SolanaTokenFlowReconciliationSchema),
});
export type SolanaTransactionFacts = z.infer<typeof SolanaTransactionFactsSchema>;

export const SolanaTransactionIntelligenceReportSchema = z
  .object({
    ledger: z.literal('SOLANA'),
    chainId: z.literal('solana-mainnet'),
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
    subject: SubjectReferenceSchema,
    facts: SolanaTransactionFactsSchema,
    launchpadObservations: z.array(SolanaLaunchpadObservationSchema).optional(),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine(
      (metadata) =>
        metadata.snapshot?.ledger === 'SOLANA' &&
        metadata.snapshot.chainId === 'solana-mainnet' &&
        metadata.snapshot.commitment === 'finalized' &&
        metadata.modelVersion === 'solana-transaction-query-v1.1.0',
      { message: 'Solana transaction reports require one finalized v1.1 Solana Snapshot.' },
    ),
    evidence: z.array(EvidenceSchema).min(2),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    const solanaSnapshot = snapshot?.ledger === 'SOLANA' ? snapshot : undefined;
    const semantics =
      value.facts.transactionSemantics.state === 'known'
        ? value.facts.transactionSemantics.value
        : undefined;
    const slot = value.facts.slot.state === 'known' ? value.facts.slot.value : undefined;
    const status = value.facts.status.state === 'known' ? value.facts.status.value : undefined;
    const launchpadObservations = value.launchpadObservations ?? [];
    if (
      solanaSnapshot === undefined ||
      value.subject.ledger !== 'SOLANA' ||
      value.subject.chainId !== value.chainId ||
      value.subject.type !== 'TRANSACTION' ||
      value.subject.id !== value.signature ||
      value.subject.normalizedId !== value.signature ||
      semantics?.signature !== value.signature ||
      slot !== solanaSnapshot.slot ||
      status !== 'CONFIRMED'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['signature'],
        message: 'Solana transaction report identity, facts, semantics, and Snapshot must agree.',
      });
    }

    const evidenceIds = value.evidence.map((item) => item.id).sort();
    const metadataEvidenceIds = [...value.metadata.evidenceIds].sort();
    const terminalEvidence = value.evidence.find((item) => item.id === value.terminalEvidenceId);
    if (
      evidenceIds.length !== new Set(evidenceIds).size ||
      metadataEvidenceIds.length !== new Set(metadataEvidenceIds).size ||
      evidenceIds.length !== metadataEvidenceIds.length ||
      evidenceIds.some((id, index) => id !== metadataEvidenceIds[index]) ||
      terminalEvidence?.ledger !== 'SOLANA' ||
      terminalEvidence.chainId !== value.chainId ||
      terminalEvidence.kind !== 'DERIVED_FEATURE' ||
      terminalEvidence.source !== `zerotrace:${semantics?.modelVersion ?? ''}` ||
      terminalEvidence.locator !==
        `transaction-semantics:${value.signature}@${solanaSnapshot?.slot ?? ''}` ||
      terminalEvidence.blockOrSlot !== solanaSnapshot?.slot ||
      terminalEvidence.finality !== 'finalized'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceId'],
        message: 'Solana transaction report Evidence provenance is incomplete or inconsistent.',
      });
    }

    const sourceSet = value.metadata.sourceSet;
    if (
      sourceSet.length === 0 ||
      sourceSet.length !== new Set(sourceSet).size ||
      sourceSet.some((source, index) => source !== [...sourceSet].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'sourceSet'],
        message: 'Solana transaction report sourceSet must be non-empty, sorted, and unique.',
      });
    }
    const reportEvidenceIds = new Set(value.evidence.map((item) => item.id));
    const solanaBlockhash = (
      solanaSnapshot as Extract<AnalysisSnapshot, { ledger: 'SOLANA' }> | undefined
    )?.blockhash;
    for (const observation of launchpadObservations) {
      const observationBlockhash = (
        observation.snapshot as Extract<AnalysisSnapshot, { ledger: 'SOLANA' }>
      ).blockhash;
      if (
        observation.signature !== value.signature ||
        observation.slot !== solanaSnapshot?.slot ||
        observationBlockhash !== solanaBlockhash ||
        observation.evidenceIds.some((evidenceId) => !reportEvidenceIds.has(evidenceId))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['launchpadObservations'],
          message:
            'Solana launchpad observations must reference this transaction, exact Snapshot, and report Evidence.',
        });
      }
    }
  });
export type SolanaTransactionIntelligenceReport = z.infer<
  typeof SolanaTransactionIntelligenceReportSchema
>;

export const SolanaDealerCampaignReportIdSchema = z.string().regex(/^sdc_[0-9a-f]{24}$/);
export const SolanaDealerAssetObservationIdSchema = z.string().regex(/^sdao_[0-9a-f]{24}$/);
export const SolanaDealerFundingEdgeIdSchema = z.string().regex(/^sdf_[0-9a-f]{24}$/);
export const SolanaDealerSettlementEdgeIdSchema = z.string().regex(/^sds_[0-9a-f]{24}$/);

const SolanaDealerSignatureSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
const SolanaDealerAssetKindSchema = z.enum(['NATIVE_SOL', 'SPL_TOKEN', 'TOKEN_2022']);

export const SolanaDealerAssetObservationSchema = z
  .object({
    schemaVersion: z.literal('solana-dealer-asset-observation-v1'),
    id: SolanaDealerAssetObservationIdSchema,
    assetKind: SolanaDealerAssetKindSchema,
    asset: z.union([z.literal('SOL'), SolanaPublicKeySchema]),
    source: SolanaPublicKeySchema,
    destination: SolanaPublicKeySchema,
    amountRaw: UnsignedQuantityStringSchema,
    decimals: z.number().int().min(0).max(255),
    signature: SolanaDealerSignatureSchema,
    slot: UnsignedQuantityStringSchema,
    blockhash: SolanaPublicKeySchema,
    transactionIndex: UnsignedQuantityStringSchema,
    instructionPath: z.string().regex(/^outer:\d+(?:\/inner:\d+)?$/),
    execution: z.enum(['SUCCESS', 'FAILED', 'UNKNOWN']),
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.slot ||
      value.snapshot.blockhash !== value.blockhash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana dealer asset observations require an exact finalized slot Snapshot.',
      });
    }
    if (value.assetKind === 'NATIVE_SOL' && value.asset !== 'SOL') {
      context.addIssue({
        code: 'custom',
        path: ['asset'],
        message: 'Native SOL observations must use the SOL asset marker.',
      });
    }
    if (value.assetKind !== 'NATIVE_SOL' && value.asset === 'SOL') {
      context.addIssue({
        code: 'custom',
        path: ['asset'],
        message: 'Token observations must carry their mint address.',
      });
    }
  });
export type SolanaDealerAssetObservation = z.infer<typeof SolanaDealerAssetObservationSchema>;

export const SolanaDealerFundingEdgeSchema = z
  .object({
    schemaVersion: z.literal('solana-dealer-funding-edge-v1'),
    id: SolanaDealerFundingEdgeIdSchema,
    source: SolanaPublicKeySchema,
    destination: SolanaPublicKeySchema,
    amountLamports: UnsignedQuantityStringSchema,
    signature: SolanaDealerSignatureSchema,
    slot: UnsignedQuantityStringSchema,
    blockhash: SolanaPublicKeySchema,
    relation: z.enum(['DIRECT_SOL_FUNDING', 'SAME_TRANSACTION_FUNDING', 'UNKNOWN']),
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    confidence: knowledgeValueSchema(ConfidenceSchema),
    detail: z.string().min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.slot ||
      value.snapshot.blockhash !== value.blockhash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana funding edges require an exact finalized slot Snapshot.',
      });
    }
    if (value.source === value.destination) {
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'Solana funding edges require distinct source and destination accounts.',
      });
    }
  });
export type SolanaDealerFundingEdge = z.infer<typeof SolanaDealerFundingEdgeSchema>;

export const SolanaDealerSettlementEdgeSchema = z
  .object({
    schemaVersion: z.literal('solana-dealer-settlement-edge-v1'),
    id: SolanaDealerSettlementEdgeIdSchema,
    source: SolanaPublicKeySchema,
    destination: SolanaPublicKeySchema,
    tokenAmountRaw: UnsignedQuantityStringSchema,
    solAmountLamports: UnsignedQuantityStringSchema,
    signature: SolanaDealerSignatureSchema,
    slot: UnsignedQuantityStringSchema,
    blockhash: SolanaPublicKeySchema,
    status: z.enum(['POSSIBLE', 'NOT_OBSERVED', 'UNKNOWN']),
    evidenceIds: CanonicalStringArraySchema.min(1),
    snapshot: AnalysisSnapshotSchema,
    confidence: knowledgeValueSchema(ConfidenceSchema),
    detail: z.string().min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.slot ||
      value.snapshot.blockhash !== value.blockhash
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana settlement edges require an exact finalized slot Snapshot.',
      });
    }
    if (value.source === value.destination) {
      context.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'Solana settlement edges require distinct source and destination accounts.',
      });
    }
  });
export type SolanaDealerSettlementEdge = z.infer<typeof SolanaDealerSettlementEdgeSchema>;

export const SolanaDealerOriginSchema = z
  .object({
    mint: SolanaPublicKeySchema,
    tokenProgram: z.enum(['SPL_TOKEN', 'TOKEN_2022']),
    firstObservedSlot: UnsignedQuantityStringSchema,
    firstObservedSignature: SolanaDealerSignatureSchema,
    mintInstructionObserved: z.boolean(),
    evidenceIds: CanonicalStringArraySchema.min(1),
  })
  .strict();
export type SolanaDealerOrigin = z.infer<typeof SolanaDealerOriginSchema>;

export const SolanaDealerHolderSchema = z
  .object({
    owner: SolanaPublicKeySchema,
    tokenAccounts: z.array(SolanaPublicKeySchema).min(1),
    observedBalanceRaw: UnsignedQuantityStringSchema,
    netDeltaRaw: QuantityStringSchema,
    firstObservedSlot: UnsignedQuantityStringSchema,
    lastObservedSlot: UnsignedQuantityStringSchema,
    openingBalance: knowledgeValueSchema(UnsignedQuantityStringSchema),
    evidenceIds: CanonicalStringArraySchema.min(1),
  })
  .strict();
export type SolanaDealerHolder = z.infer<typeof SolanaDealerHolderSchema>;

export const SolanaDealerCampaignReportSchema = z
  .object({
    schemaVersion: z.literal('solana-dealer-campaign-report-v1'),
    id: SolanaDealerCampaignReportIdSchema,
    ledger: z.literal('SOLANA'),
    chainId: z.literal('solana-mainnet'),
    mint: SolanaPublicKeySchema,
    fromSlot: UnsignedQuantityStringSchema,
    toSlot: UnsignedQuantityStringSchema,
    status: z.enum(['COMPLETE', 'PARTIAL', 'UNKNOWN']),
    origin: knowledgeValueSchema(SolanaDealerOriginSchema),
    holders: z.array(SolanaDealerHolderSchema),
    tokenFlowEdges: z.array(TokenFlowEdgeSchema),
    solTransfers: z.array(SolanaDealerAssetObservationSchema),
    fundingEdges: z.array(SolanaDealerFundingEdgeSchema),
    settlementEdges: z.array(SolanaDealerSettlementEdgeSchema),
    openingBalanceUnknownWalletIds: CanonicalStringArraySchema,
    pdaSuppressedOwnerIds: CanonicalStringArraySchema,
    launchpadObservations: z.array(SolanaLaunchpadObservationSchema).max(500).optional(),
    campaign: ControlCampaignBundleSchema.nullable(),
    alerts: z.array(ForensicCampaignAlertSchema),
    evidence: z.array(EvidenceSchema).min(1),
    snapshot: AnalysisSnapshotSchema,
    dataCoverage: CoverageRatioSchema,
    sourceCoverage: CoverageRatioSchema,
    historyCoverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: CanonicalStringArraySchema.min(1),
    modelVersion: z.literal('solana-dealer-campaign-v1.0.0'),
    policyVersion: z.literal('solana-dealer-policy-v1.0.0'),
    evidenceIds: CanonicalStringArraySchema.min(1),
    resultHash: Hash256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.snapshot.ledger !== 'SOLANA' ||
      value.snapshot.chainId !== 'solana-mainnet' ||
      value.snapshot.slot !== value.toSlot ||
      BigInt(value.toSlot) < BigInt(value.fromSlot)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['snapshot'],
        message: 'Solana dealer reports require one finalized Snapshot at the range end.',
      });
    }
    const nestedEvidenceIds = [
      ...(value.origin.state === 'known' ? value.origin.value.evidenceIds : []),
      ...value.holders.flatMap((holder) => holder.evidenceIds),
      ...value.tokenFlowEdges.flatMap((edge) => [edge.evidenceId]),
      ...value.solTransfers.flatMap((edge) => edge.evidenceIds),
      ...value.fundingEdges.flatMap((edge) => edge.evidenceIds),
      ...value.settlementEdges.flatMap((edge) => edge.evidenceIds),
      ...(value.launchpadObservations ?? []).flatMap((observation) => observation.evidenceIds),
      ...(value.campaign === null
        ? []
        : [
            ...value.campaign.campaign.metadata.evidenceIds,
            ...value.campaign.clusterVersion.membershipEvidenceIds,
            ...value.campaign.positions.flatMap((position) => position.positionEvidenceIds),
            ...value.campaign.behaviorEvents.flatMap((event) => [
              ...event.supportingEvidenceIds,
              ...event.contradictingEvidenceIds,
            ]),
            ...value.campaign.evidenceLine.evidenceIds,
          ]),
      ...value.alerts.flatMap((alert) => alert.evidenceIds),
    ];
    const evidenceIds = [...new Set(value.evidence.map((item) => item.id))].sort();
    const declared = [...value.evidenceIds].sort();
    const expected = [...new Set(nestedEvidenceIds)].sort();
    const launchpadIds = (value.launchpadObservations ?? []).map((observation) => observation.id);
    if (
      evidenceIds.length !== value.evidence.length ||
      JSON.stringify(evidenceIds) !== JSON.stringify(declared) ||
      expected.some((id) => !declared.includes(id)) ||
      launchpadIds.length !== new Set(launchpadIds).size ||
      launchpadIds.some((id, index) => id !== [...launchpadIds].sort()[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Solana dealer report Evidence must contain every nested observation reference.',
      });
    }
    if (
      value.tokenFlowEdges.some(
        (edge) =>
          edge.ledger !== 'SOLANA' ||
          edge.chainId !== 'solana-mainnet' ||
          edge.token !== value.mint ||
          BigInt(edge.blockNumber) < BigInt(value.fromSlot) ||
          BigInt(edge.blockNumber) > BigInt(value.toSlot),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['tokenFlowEdges'],
        message: 'Solana dealer token-flow edges must match the report mint and range.',
      });
    }
    if (
      (value.launchpadObservations ?? []).some(
        (observation) =>
          BigInt(observation.slot) < BigInt(value.fromSlot) ||
          BigInt(observation.slot) > BigInt(value.toSlot),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['launchpadObservations'],
        message: 'Solana launchpad observations must remain inside the dealer report slot range.',
      });
    }
    if (
      value.campaign !== null &&
      (value.campaign.campaign.token !== value.mint ||
        value.campaign.campaign.chainId !== 'solana-mainnet')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['campaign'],
        message: 'Solana dealer campaign identity must match the report mint and chain.',
      });
    }
    if (value.status === 'COMPLETE' && value.campaign === null) {
      context.addIssue({
        code: 'custom',
        path: ['campaign'],
        message: 'A complete Solana dealer report requires a materialized Campaign bundle.',
      });
    }
  });
export type SolanaDealerCampaignReport = z.infer<typeof SolanaDealerCampaignReportSchema>;

export const SolanaDealerCampaignRequestSchema = z
  .object({
    mint: SolanaPublicKeySchema,
    fromSlot: UnsignedQuantityStringSchema,
    toSlot: UnsignedQuantityStringSchema,
    maxTransactions: z.number().int().min(1).max(500).default(500),
  })
  .strict()
  .superRefine((value, context) => {
    const from = BigInt(value.fromSlot);
    const to = BigInt(value.toSlot);
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    if (to < from) {
      context.addIssue({
        code: 'custom',
        path: ['toSlot'],
        message: 'toSlot must be greater than or equal to fromSlot.',
      });
    }
    if (to >= from && to - from + 1n > 50_000n) {
      context.addIssue({
        code: 'custom',
        path: ['toSlot'],
        message: 'Solana dealer ranges may contain at most 50,000 slots.',
      });
    }
    if (from > maxSafe || to > maxSafe) {
      context.addIssue({
        code: 'custom',
        path: ['toSlot'],
        message: 'Solana slots must fit the JSON-RPC safe integer range.',
      });
    }
  });
export type SolanaDealerCampaignRequest = z.infer<typeof SolanaDealerCampaignRequestSchema>;

export const SolanaControlRightTypeSchema = z.enum([
  'MINT_AUTHORITY',
  'FREEZE_AUTHORITY',
  'ACCOUNT_OWNER',
  'ACCOUNT_CLOSE_AUTHORITY',
  'MINT_CLOSE_AUTHORITY',
  'ACCOUNT_DELEGATE',
  'PERMANENT_DELEGATE',
  'TRANSFER_FEE_CONFIG_AUTHORITY',
  'WITHHELD_FEE_AUTHORITY',
  'CONFIDENTIAL_TRANSFER_AUTHORITY',
  'INTEREST_RATE_AUTHORITY',
  'TRANSFER_HOOK_AUTHORITY',
  'TRANSFER_HOOK_PROGRAM',
  'METADATA_POINTER_AUTHORITY',
  'METADATA_UPDATE_AUTHORITY',
  'GROUP_POINTER_AUTHORITY',
  'GROUP_UPDATE_AUTHORITY',
  'GROUP_MEMBER_POINTER_AUTHORITY',
  'SCALED_UI_AMOUNT_AUTHORITY',
  'PAUSE_AUTHORITY',
  'PERMISSIONED_BURN_AUTHORITY',
  'PROGRAM_UPGRADE_AUTHORITY',
  'MULTISIG_SIGNER',
]);
export type SolanaControlRightType = z.infer<typeof SolanaControlRightTypeSchema>;

export const SolanaAccountKindSchema = z.enum([
  'SYSTEM_ACCOUNT',
  'SPL_TOKEN_MINT',
  'SPL_TOKEN_ACCOUNT',
  'SPL_TOKEN_MULTISIG',
  'TOKEN_2022_MINT',
  'TOKEN_2022_ACCOUNT',
  'TOKEN_2022_MULTISIG',
  'UPGRADEABLE_PROGRAM',
  'UPGRADEABLE_PROGRAM_DATA',
  'IMMUTABLE_PROGRAM',
  'OTHER_ACCOUNT',
]);
export type SolanaAccountKind = z.infer<typeof SolanaAccountKindSchema>;

export const SolanaTokenProgramSchema = z.enum(['SPL_TOKEN', 'TOKEN_2022']);
export type SolanaTokenProgram = z.infer<typeof SolanaTokenProgramSchema>;

export const SolanaMintControlSchema = z.object({
  tokenProgram: SolanaTokenProgramSchema,
  supply: UnsignedQuantityStringSchema,
  decimals: z.number().int().min(0).max(255),
  initialized: z.boolean(),
  mintAuthority: knowledgeValueSchema(SolanaPublicKeySchema),
  freezeAuthority: knowledgeValueSchema(SolanaPublicKeySchema),
});
export type SolanaMintControl = z.infer<typeof SolanaMintControlSchema>;

export const SolanaTokenAccountControlSchema = z.object({
  tokenProgram: SolanaTokenProgramSchema,
  mint: SolanaPublicKeySchema,
  owner: SolanaPublicKeySchema,
  amount: UnsignedQuantityStringSchema,
  state: z.string().min(1),
  delegate: knowledgeValueSchema(SolanaPublicKeySchema),
  delegatedAmount: UnsignedQuantityStringSchema,
  closeAuthority: knowledgeValueSchema(SolanaPublicKeySchema),
});
export type SolanaTokenAccountControl = z.infer<typeof SolanaTokenAccountControlSchema>;

export const SolanaMultisigControlSchema = z.object({
  tokenProgram: SolanaTokenProgramSchema,
  initialized: z.boolean(),
  minimumSigners: z.number().int().min(1).max(11),
  signerCount: z.number().int().min(1).max(11),
  signers: z.array(SolanaPublicKeySchema).min(1).max(11),
});
export type SolanaMultisigControl = z.infer<typeof SolanaMultisigControlSchema>;

export const SolanaTokenExtensionAuthoritySchema = z.object({
  role: z.string().min(1).max(128),
  address: SolanaPublicKeySchema,
});
export const SolanaTokenExtensionRelatedAddressSchema = z.object({
  role: z.string().min(1).max(128),
  address: SolanaPublicKeySchema,
});
export const SolanaTokenExtensionControlSchema = z.object({
  extensionType: z.string().min(1).max(128),
  authorities: z.array(SolanaTokenExtensionAuthoritySchema),
  relatedAddresses: z.array(SolanaTokenExtensionRelatedAddressSchema),
  settings: z.record(z.string(), z.union([z.string(), z.boolean(), z.null()])),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
});
export type SolanaTokenExtensionControl = z.infer<typeof SolanaTokenExtensionControlSchema>;

export const SolanaProgramControlSchema = z.object({
  loader: SolanaPublicKeySchema,
  programDataAddress: knowledgeValueSchema(SolanaPublicKeySchema),
  upgradeAuthority: knowledgeValueSchema(SolanaPublicKeySchema),
  immutable: knowledgeValueSchema(z.boolean()),
  deploymentSlot: knowledgeValueSchema(UnsignedQuantityStringSchema),
  programDataBytes: knowledgeValueSchema(z.number().int().nonnegative()),
});
export type SolanaProgramControl = z.infer<typeof SolanaProgramControlSchema>;

export const SolanaControlRightSchema = z.object({
  id: z.string().regex(/^cr_[0-9a-f]{24}$/),
  chainId: z.literal('solana-mainnet'),
  subject: SolanaPublicKeySchema,
  controller: SolanaPublicKeySchema,
  rightType: SolanaControlRightTypeSchema,
  scope: z.string().min(1),
  threshold: knowledgeValueSchema(DecimalStringSchema),
  constraints: z.array(z.string().min(1)),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  activeFrom: knowledgeValueSchema(IsoDateTimeSchema),
  activeTo: knowledgeValueSchema(IsoDateTimeSchema),
});
export type SolanaControlRight = z.infer<typeof SolanaControlRightSchema>;

export const SolanaControlCoverageDomainSchema = z.enum([
  'ACCOUNT_STATE',
  'ACCOUNT_CLASSIFICATION',
  'TOKEN_BASE_STATE',
  'MINT_AUTHORITY',
  'FREEZE_AUTHORITY',
  'ACCOUNT_OWNER',
  'ACCOUNT_CLOSE_AUTHORITY',
  'ACCOUNT_DELEGATE',
  'MULTISIG_CONFIGURATION',
  'MINT_CLOSE_AUTHORITY',
  'PERMANENT_DELEGATE',
  'TRANSFER_FEE_CONFIG',
  'WITHHELD_FEE_AUTHORITY',
  'CONFIDENTIAL_TRANSFER',
  'DEFAULT_ACCOUNT_STATE',
  'NON_TRANSFERABLE',
  'INTEREST_BEARING',
  'TRANSFER_HOOK',
  'METADATA_POINTER',
  'TOKEN_METADATA',
  'GROUP_POINTER',
  'TOKEN_GROUP',
  'GROUP_MEMBER_POINTER',
  'TOKEN_GROUP_MEMBER',
  'SCALED_UI_AMOUNT',
  'PAUSABLE',
  'PERMISSIONED_BURN',
  'CPI_GUARD',
  'MEMO_TRANSFER',
  'IMMUTABLE_OWNER',
  'PROGRAM_EXECUTABLE',
  'PROGRAM_DATA',
  'PROGRAM_UPGRADE_AUTHORITY',
  'ANCHOR_IDL',
  'VERIFIABLE_BUILD',
  'SQUADS_CONFIGURATION',
  'AUTHORITY_HISTORY',
  'CONTROLLER_RECURSION',
]);
export type SolanaControlCoverageDomain = z.infer<typeof SolanaControlCoverageDomainSchema>;

export const SolanaControlCoverageSchema = z.object({
  domain: SolanaControlCoverageDomainSchema,
  observed: knowledgeValueSchema(z.boolean()),
  detail: z.string().min(1),
  evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
});
export type SolanaControlCoverage = z.infer<typeof SolanaControlCoverageSchema>;

export const SolanaControlSurfaceReportSchema = z
  .object({
    ledger: z.literal('SOLANA'),
    chainId: z.literal('solana-mainnet'),
    subject: SolanaPublicKeySchema,
    accountKind: knowledgeValueSchema(SolanaAccountKindSchema),
    ownerProgram: knowledgeValueSchema(SolanaPublicKeySchema),
    executable: knowledgeValueSchema(z.boolean()),
    mint: knowledgeValueSchema(SolanaMintControlSchema),
    tokenAccount: knowledgeValueSchema(SolanaTokenAccountControlSchema),
    multisig: knowledgeValueSchema(SolanaMultisigControlSchema),
    program: knowledgeValueSchema(SolanaProgramControlSchema),
    extensions: z.array(SolanaTokenExtensionControlSchema),
    sourceAgreement: knowledgeValueSchema(z.boolean()),
    sourceIndependence: knowledgeValueSchema(z.boolean()),
    rights: z.array(SolanaControlRightSchema),
    coverage: z.array(SolanaControlCoverageSchema),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot?.ledger === 'SOLANA', {
      message: 'Solana control surface requires a Solana Snapshot.',
    }),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    if (
      snapshot?.ledger !== 'SOLANA' ||
      snapshot.commitment !== 'finalized' ||
      snapshot.chainId !== value.chainId
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Solana control identity requires one finalized matching Snapshot.',
      });
    }
    const domains = value.coverage.map((item) => item.domain);
    const expectedDomains = [...SolanaControlCoverageDomainSchema.options].sort();
    if (
      domains.length !== expectedDomains.length ||
      [...new Set(domains)].sort().some((domain, index) => domain !== expectedDomains[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['coverage'],
        message: 'Coverage must include every Solana control domain exactly once.',
      });
    }
    const evidenceIds = value.evidence.map((item) => item.id).sort();
    const metadataEvidenceIds = value.metadata.evidenceIds;
    const nestedEvidenceIds = [
      ...value.rights.flatMap((right) => right.evidenceIds),
      ...value.coverage.flatMap((item) => item.evidenceIds),
      ...value.extensions.flatMap((item) => item.evidenceIds),
    ];
    if (
      metadataEvidenceIds.length !== new Set(metadataEvidenceIds).size ||
      metadataEvidenceIds.some((id, index) => id !== evidenceIds[index]) ||
      evidenceIds.length !== metadataEvidenceIds.length ||
      !metadataEvidenceIds.includes(value.terminalEvidenceId) ||
      nestedEvidenceIds.some((id) => !metadataEvidenceIds.includes(id))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'evidenceIds'],
        message: 'Solana control provenance must be canonical and contain all nested Evidence.',
      });
    }
  });
export type SolanaControlSurfaceReport = z.infer<typeof SolanaControlSurfaceReportSchema>;

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
  spotPrice: OptionalDecimalKnowledgeSchema,
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

export const FlapOriginSearchModeSchema = z.enum(['FULL_DATASET', 'VERIFIED_HINT']);
export type FlapOriginSearchMode = z.infer<typeof FlapOriginSearchModeSchema>;

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
    originSearchMode: FlapOriginSearchModeSchema.default('FULL_DATASET'),
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
      value.originSearchMode !== 'FULL_DATASET' ||
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

export const FlapPancakeV2TokenAmountSchema = z.object({
  atomic: UnsignedQuantityStringSchema,
  decimal: DecimalStringSchema,
});
export type FlapPancakeV2TokenAmount = z.infer<typeof FlapPancakeV2TokenAmountSchema>;

export const FlapPancakeV2MarketSchema = z.object({
  venue: z.literal('PANCAKESWAP_V2'),
  chainId: z.literal('eip155:56'),
  pool: z.string().regex(/^0x[0-9a-f]{40}$/),
  factory: z.string().regex(/^0x[0-9a-f]{40}$/),
  router: z.string().regex(/^0x[0-9a-f]{40}$/),
  token: z.string().regex(/^0x[0-9a-f]{40}$/),
  quoteAsset: z.string().regex(/^0x[0-9a-f]{40}$/),
  token0: z.string().regex(/^0x[0-9a-f]{40}$/),
  token1: z.string().regex(/^0x[0-9a-f]{40}$/),
  tokenDecimals: z.number().int().min(0).max(255),
  quoteDecimals: z.number().int().min(0).max(255),
  tokenReserve: FlapPancakeV2TokenAmountSchema,
  quoteReserve: FlapPancakeV2TokenAmountSchema,
  currentSpotPriceWad: UnsignedQuantityStringSchema,
  currentSpotPrice: DecimalStringSchema,
  dexFeeBps: UnsignedQuantityStringSchema,
  configuredBuyTaxBps: knowledgeValueSchema(UnsignedQuantityStringSchema),
  configuredSellTaxBps: knowledgeValueSchema(UnsignedQuantityStringSchema),
  pairTimestampLast: UnsignedQuantityStringSchema,
  sourceRevision: z.string().min(1),
});
export type FlapPancakeV2Market = z.infer<typeof FlapPancakeV2MarketSchema>;

export const FlapPancakeV2BuyScenarioPointSchema = z.object({
  quoteInput: FlapPancakeV2TokenAmountSchema,
  officialRouterGrossTokenOutput: FlapPancakeV2TokenAmountSchema,
  deterministicPoolGrossTokenOutput: FlapPancakeV2TokenAmountSchema,
  configuredTaxNetTokenOutput: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
  executionNetTokenOutput: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
  averageGrossBuyPrice: knowledgeValueSchema(DecimalStringSchema),
  averageConfiguredTaxBuyPrice: knowledgeValueSchema(DecimalStringSchema),
  modeledPostBuySpotPrice: DecimalStringSchema,
  modeledPriceChangeBps: DecimalStringSchema,
  deterministicQuoteErrorBps: DecimalStringSchema,
  deterministicToleranceBps: DecimalStringSchema,
  withinDeterministicTolerance: z.boolean(),
  assumption: z.string().min(1),
});
export type FlapPancakeV2BuyScenarioPoint = z.infer<typeof FlapPancakeV2BuyScenarioPointSchema>;

export const FlapPancakeV2BuyScenarioResultSchema = z
  .object({
    platform: z.literal('flap'),
    token: z.string().regex(/^0x[0-9a-f]{40}$/),
    market: knowledgeValueSchema(FlapPancakeV2MarketSchema),
    scenarios: z.array(FlapPancakeV2BuyScenarioPointSchema).max(8),
    validation: z.object({
      status: z.enum(['PASS', 'FAIL', 'NOT_RUN']),
      deterministicToleranceBps: DecimalStringSchema,
      evaluatedScenarioCount: z.number().int().nonnegative(),
      failedScenarioCount: z.number().int().nonnegative(),
    }),
    pensionSinkTreatment: knowledgeValueSchema(z.string().min(1)),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot !== null, {
      message: 'Flap Pancake V2 buy scenarios require a replayable chain Snapshot.',
    }),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.chainId !== 'eip155:56' ||
      !value.metadata.evidenceIds.includes(value.terminalEvidenceId) ||
      !value.evidence.some((item) => item.id === value.terminalEvidenceId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceId'],
        message:
          'Flap Pancake V2 buy scenarios must bind their terminal Evidence to one BSC Snapshot.',
      });
    }
    if (value.market.state === 'known') {
      const market = value.market.value;
      const pairMatches =
        (market.token0 === market.token && market.token1 === market.quoteAsset) ||
        (market.token1 === market.token && market.token0 === market.quoteAsset);
      const failedScenarioCount = value.scenarios.filter(
        (scenario) => !scenario.withinDeterministicTolerance,
      ).length;
      if (
        market.token !== value.token ||
        !pairMatches ||
        value.scenarios.length === 0 ||
        market.tokenReserve.atomic === '0' ||
        market.quoteReserve.atomic === '0' ||
        value.validation.status === 'NOT_RUN' ||
        value.validation.evaluatedScenarioCount !== value.scenarios.length ||
        value.validation.failedScenarioCount !== failedScenarioCount ||
        (failedScenarioCount === 0
          ? value.validation.status !== 'PASS'
          : value.validation.status !== 'FAIL')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['market'],
          message:
            'A known Flap Pancake V2 market requires matching pair identities, positive reserves and scenarios.',
        });
      }
    } else if (
      value.scenarios.length !== 0 ||
      value.validation.status !== 'NOT_RUN' ||
      value.validation.evaluatedScenarioCount !== 0 ||
      value.validation.failedScenarioCount !== 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['scenarios'],
        message: 'Unavailable or unknown Flap Pancake V2 markets cannot contain scenarios.',
      });
    }
  });
export type FlapPancakeV2BuyScenarioResult = z.infer<typeof FlapPancakeV2BuyScenarioResultSchema>;

export const FlapPancakeV2PensionBehaviorReferenceSchema = z
  .object({
    reportId: z.string().regex(/^pcr_[0-9a-f]{24}$/),
    resultHash: Hash256Schema,
    wallet: z.string().regex(/^0x[0-9a-f]{40}$/),
    shareUnit: FlapPancakeV2TokenAmountSchema,
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    snapshotHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    observedWholeShares: UnsignedQuantityStringSchema,
    candidateEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    reportTerminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    roleAttribution: knowledgeValueSchema(z.literal('PENSION_VAULT')),
    participantExitPolicy: knowledgeValueSchema(z.boolean()),
    dividendExecution: knowledgeValueSchema(z.boolean()),
  })
  .superRefine((value, context) => {
    if (
      BigInt(value.toBlock) < BigInt(value.fromBlock) ||
      BigInt(value.shareUnit.atomic) === 0n ||
      value.roleAttribution.state === 'known' ||
      value.participantExitPolicy.state === 'known' ||
      value.dividendExecution.state === 'known'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['roleAttribution'],
        message:
          'Pension behavior references require a valid range/share unit and cannot promote role, exit, or dividend policy to fact.',
      });
    }
  });
export type FlapPancakeV2PensionBehaviorReference = z.infer<
  typeof FlapPancakeV2PensionBehaviorReferenceSchema
>;

export const FlapPancakeV2PensionEntryScenarioPointSchema = z
  .object({
    buyScenario: FlapPancakeV2BuyScenarioPointSchema,
    modeledNetTokenOutput: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
    modeledShareEquivalent: knowledgeValueSchema(DecimalStringSchema),
    modeledWholeShares: knowledgeValueSchema(UnsignedQuantityStringSchema),
    modeledCommittedTokenAmount: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
    modeledRemainderTokenAmount: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
    modeledQuoteCostForCommittedShares: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
    modeledAverageQuoteCostPerShare: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
    modeledPostDepositSpotPrice: knowledgeValueSchema(DecimalStringSchema),
    executionNetTokenOutput: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
    executionWholeShares: knowledgeValueSchema(UnsignedQuantityStringSchema),
    executionPostDepositSpotPrice: knowledgeValueSchema(DecimalStringSchema),
    assumption: z.string().min(1),
  })
  .superRefine((value, context) => {
    const modeledFields = [
      value.modeledShareEquivalent,
      value.modeledWholeShares,
      value.modeledCommittedTokenAmount,
      value.modeledRemainderTokenAmount,
      value.modeledQuoteCostForCommittedShares,
    ];
    const modeledState = value.modeledNetTokenOutput.state;
    if (modeledFields.some((field) => field.state !== modeledState)) {
      context.addIssue({
        code: 'custom',
        path: ['modeledNetTokenOutput'],
        message: 'Pension entry modeled quantities must share the modeled net-output state.',
      });
    }
    if (value.modeledNetTokenOutput.state === 'known') {
      const isZeroReceipt = BigInt(value.modeledNetTokenOutput.value.atomic) === 0n;
      if (
        (isZeroReceipt &&
          (value.modeledAverageQuoteCostPerShare.state !== 'unknown' ||
            value.modeledAverageQuoteCostPerShare.reason !== 'NOT_APPLICABLE')) ||
        (!isZeroReceipt && value.modeledAverageQuoteCostPerShare.state !== 'known')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['modeledAverageQuoteCostPerShare'],
          message:
            'Average share cost must be known for a positive modeled receipt and Unknown/NOT_APPLICABLE for a zero receipt.',
        });
      }
    } else if (value.modeledAverageQuoteCostPerShare.state !== modeledState) {
      context.addIssue({
        code: 'custom',
        path: ['modeledAverageQuoteCostPerShare'],
        message: 'Unavailable or Unknown modeled receipts must propagate to average share cost.',
      });
    }
    if (
      value.modeledPostDepositSpotPrice.state !== 'known' ||
      value.modeledPostDepositSpotPrice.value !== value.buyScenario.modeledPostBuySpotPrice
    ) {
      context.addIssue({
        code: 'custom',
        path: ['modeledPostDepositSpotPrice'],
        message:
          'The custody-only pension deposit model must preserve the post-buy pool spot price.',
      });
    }
    if (
      value.executionWholeShares.state === 'known' ||
      value.executionPostDepositSpotPrice.state === 'known'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['executionNetTokenOutput'],
        message:
          'Executed pension-wallet shares and post-deposit price remain unresolved without buy-plus-transfer fork execution.',
      });
    }
  });
export type FlapPancakeV2PensionEntryScenarioPoint = z.infer<
  typeof FlapPancakeV2PensionEntryScenarioPointSchema
>;

export const FlapPancakeV2PensionEntryResultSchema = z
  .object({
    platform: z.literal('flap'),
    token: z.string().regex(/^0x[0-9a-f]{40}$/),
    behavior: FlapPancakeV2PensionBehaviorReferenceSchema,
    market: knowledgeValueSchema(FlapPancakeV2MarketSchema),
    entries: z.array(FlapPancakeV2PensionEntryScenarioPointSchema).max(8),
    validation: z.object({
      status: z.enum(['PASS', 'FAIL', 'NOT_RUN']),
      deterministicToleranceBps: DecimalStringSchema,
      evaluatedScenarioCount: z.number().int().nonnegative(),
      failedScenarioCount: z.number().int().nonnegative(),
    }),
    destinationTreatment: z.literal('NON_ZERO_CUSTODY_ADDRESS'),
    totalSupplyReduction: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
    custodyIrreversible: knowledgeValueSchema(z.boolean()),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('flap-pension-entry-economics-v0.1.0'),
    }),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    const evidenceIds = new Set(value.evidence.map((item) => item.id));
    const requiredEvidenceIds = [
      value.behavior.candidateEvidenceId,
      value.behavior.reportTerminalEvidenceId,
      value.terminalEvidenceId,
    ];
    if (
      snapshot?.ledger !== 'EVM' ||
      snapshot.chainId !== 'eip155:56' ||
      BigInt(snapshot.blockNumber) < BigInt(value.behavior.toBlock) ||
      (snapshot.blockNumber === value.behavior.toBlock &&
        snapshot.blockHash.toLowerCase() !== value.behavior.snapshotHash) ||
      value.totalSupplyReduction.state === 'known' ||
      value.custodyIrreversible.state === 'known' ||
      requiredEvidenceIds.some(
        (evidenceId) =>
          !evidenceIds.has(evidenceId) || !value.metadata.evidenceIds.includes(evidenceId),
      ) ||
      value.evidence.length !== evidenceIds.size
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message:
          'Pension entry economics require a later same-chain Snapshot, unique complete Evidence, and Unknown supply/irreversibility effects.',
      });
    }
    if (value.market.state === 'known') {
      if (
        value.market.value.token !== value.token ||
        value.entries.length === 0 ||
        value.entries.length !== value.validation.evaluatedScenarioCount
      ) {
        context.addIssue({
          code: 'custom',
          path: ['entries'],
          message: 'A known pension-entry market requires matching token scenarios and validation.',
        });
      }
    } else if (value.entries.length !== 0 || value.validation.status !== 'NOT_RUN') {
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'Unavailable pension-entry markets cannot expose modeled entries.',
      });
    }
  });
export type FlapPancakeV2PensionEntryResult = z.infer<typeof FlapPancakeV2PensionEntryResultSchema>;

export const FlapPancakeV2SellScenarioPointSchema = z.object({
  tokenInput: FlapPancakeV2TokenAmountSchema,
  nominalSpotQuoteValue: FlapPancakeV2TokenAmountSchema,
  officialRouterGrossQuoteOutput: FlapPancakeV2TokenAmountSchema,
  deterministicPoolGrossQuoteOutput: FlapPancakeV2TokenAmountSchema,
  configuredTaxTokenInputToPool: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
  configuredTaxNetQuoteOutput: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
  executionNetQuoteOutput: knowledgeValueSchema(FlapPancakeV2TokenAmountSchema),
  averageGrossExitPrice: knowledgeValueSchema(DecimalStringSchema),
  averageConfiguredTaxExitPrice: knowledgeValueSchema(DecimalStringSchema),
  modeledGrossPostSellSpotPrice: DecimalStringSchema,
  modeledConfiguredTaxPostSellSpotPrice: knowledgeValueSchema(DecimalStringSchema),
  grossPriceImpactBps: DecimalStringSchema,
  configuredTotalExitHaircutBps: knowledgeValueSchema(DecimalStringSchema),
  grossQuoteReserveConsumedBps: DecimalStringSchema,
  configuredTaxQuoteReserveConsumedBps: knowledgeValueSchema(DecimalStringSchema),
  deterministicQuoteErrorBps: DecimalStringSchema,
  deterministicToleranceBps: DecimalStringSchema,
  withinDeterministicTolerance: z.boolean(),
  assumption: z.string().min(1),
});
export type FlapPancakeV2SellScenarioPoint = z.infer<typeof FlapPancakeV2SellScenarioPointSchema>;

export const FlapPancakeV2SellScenarioResultSchema = z
  .object({
    platform: z.literal('flap'),
    token: z.string().regex(/^0x[0-9a-f]{40}$/),
    market: knowledgeValueSchema(FlapPancakeV2MarketSchema),
    scenarios: z.array(FlapPancakeV2SellScenarioPointSchema).max(8),
    validation: z.object({
      status: z.enum(['PASS', 'FAIL', 'NOT_RUN']),
      deterministicToleranceBps: DecimalStringSchema,
      evaluatedScenarioCount: z.number().int().nonnegative(),
      failedScenarioCount: z.number().int().nonnegative(),
    }),
    executionCapacity: knowledgeValueSchema(z.string().min(1)),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot !== null, {
      message: 'Flap Pancake V2 sell scenarios require a replayable chain Snapshot.',
    }),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.chainId !== 'eip155:56' ||
      !value.metadata.evidenceIds.includes(value.terminalEvidenceId) ||
      !value.evidence.some((item) => item.id === value.terminalEvidenceId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceId'],
        message:
          'Flap Pancake V2 sell scenarios must bind their terminal Evidence to one BSC Snapshot.',
      });
    }
    if (value.market.state === 'known') {
      const market = value.market.value;
      const pairMatches =
        (market.token0 === market.token && market.token1 === market.quoteAsset) ||
        (market.token1 === market.token && market.token0 === market.quoteAsset);
      const failedScenarioCount = value.scenarios.filter(
        (scenario) => !scenario.withinDeterministicTolerance,
      ).length;
      if (
        market.token !== value.token ||
        !pairMatches ||
        market.tokenReserve.atomic === '0' ||
        market.quoteReserve.atomic === '0' ||
        value.scenarios.length === 0 ||
        value.validation.status === 'NOT_RUN' ||
        value.validation.evaluatedScenarioCount !== value.scenarios.length ||
        value.validation.failedScenarioCount !== failedScenarioCount ||
        (failedScenarioCount === 0
          ? value.validation.status !== 'PASS'
          : value.validation.status !== 'FAIL')
      ) {
        context.addIssue({
          code: 'custom',
          path: ['market'],
          message:
            'A known Flap Pancake V2 market requires matching sell scenarios and validation counts.',
        });
      }
    } else if (
      value.scenarios.length !== 0 ||
      value.validation.status !== 'NOT_RUN' ||
      value.validation.evaluatedScenarioCount !== 0 ||
      value.validation.failedScenarioCount !== 0
    ) {
      context.addIssue({
        code: 'custom',
        path: ['scenarios'],
        message: 'Unavailable or unknown Flap Pancake V2 markets cannot contain sell scenarios.',
      });
    }
  });
export type FlapPancakeV2SellScenarioResult = z.infer<typeof FlapPancakeV2SellScenarioResultSchema>;

export const FlapPancakeV2ReconciliationSourceSchema = z.object({
  sourceId: z.string().min(1),
  operatorId: knowledgeValueSchema(z.string().min(1)),
  buy: FlapPancakeV2BuyScenarioResultSchema,
  sell: FlapPancakeV2SellScenarioResultSchema,
});
export type FlapPancakeV2ReconciliationSource = z.infer<
  typeof FlapPancakeV2ReconciliationSourceSchema
>;

export const FlapPancakeV2ReconciliationResultSchema = z
  .object({
    platform: z.literal('flap'),
    token: z.string().regex(/^0x[0-9a-f]{40}$/),
    status: DiscrepancyAuditStatusSchema,
    blockNumber: UnsignedQuantityStringSchema,
    blockHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    anchorReconciliation: AnchorReconciliationResultSchema,
    sourceIndependence: SourceIndependenceAssessmentSchema,
    sources: z.array(FlapPancakeV2ReconciliationSourceSchema).min(2).max(8),
    audit: DiscrepancyAuditResultSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('flap-pancake-v2-multi-source-reconciliation-v1.0.0'),
    }),
    evidence: z.array(EvidenceSchema).min(1),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    const canonical = value.anchorReconciliation.canonicalAnchor;
    const sourceIds = value.sources.map((source) => source.sourceId);
    const expectedStatus =
      value.audit.status === 'FAIL'
        ? 'FAIL'
        : value.audit.status === 'PASS' &&
            value.sourceIndependence.independence.state === 'known' &&
            value.sourceIndependence.independence.value
          ? 'PASS'
          : value.audit.status === 'PASS_WITH_WARNINGS' &&
              value.sourceIndependence.independence.state === 'known' &&
              value.sourceIndependence.independence.value
            ? 'PASS_WITH_WARNINGS'
            : 'INCONCLUSIVE';
    const invalidChild = value.sources.some((source) => {
      const buySnapshot = source.buy.metadata.snapshot;
      const sellSnapshot = source.sell.metadata.snapshot;
      return (
        source.buy.token !== value.token ||
        source.sell.token !== value.token ||
        buySnapshot === null ||
        buySnapshot.ledger !== 'EVM' ||
        buySnapshot.blockNumber !== value.blockNumber ||
        buySnapshot.blockHash.toLowerCase() !== value.blockHash ||
        sellSnapshot === null ||
        sellSnapshot.ledger !== 'EVM' ||
        sellSnapshot.blockNumber !== value.blockNumber ||
        sellSnapshot.blockHash.toLowerCase() !== value.blockHash ||
        !source.buy.metadata.sourceSet.includes(source.sourceId) ||
        !source.sell.metadata.sourceSet.includes(source.sourceId)
      );
    });
    if (
      value.status !== expectedStatus ||
      value.anchorReconciliation.status !== 'AGREEMENT' ||
      canonical.state !== 'known' ||
      (canonical.state === 'known' &&
        (canonical.value.position !== value.blockNumber ||
          canonical.value.hash.toLowerCase() !== value.blockHash)) ||
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.chainId !== 'eip155:56' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockNumber !== value.blockNumber ||
      snapshot.blockHash.toLowerCase() !== value.blockHash ||
      value.metadata.freshness !== snapshot.capturedAt ||
      new Set(sourceIds).size !== sourceIds.length ||
      sourceIds.some((source) => !value.metadata.sourceSet.includes(source)) ||
      sourceIds.some((source) => !value.anchorReconciliation.metadata.sourceSet.includes(source)) ||
      invalidChild ||
      !value.metadata.evidenceIds.includes(value.terminalEvidenceId) ||
      !value.metadata.evidenceIds.includes(value.sourceIndependence.terminalEvidenceId) ||
      !value.evidence.some((evidence) => evidence.id === value.terminalEvidenceId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message:
          'Multi-source market reconciliation requires an agreed finalized Snapshot, complete source replay, and terminal Evidence.',
      });
    }
  });
export type FlapPancakeV2ReconciliationResult = z.infer<
  typeof FlapPancakeV2ReconciliationResultSchema
>;

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
export type ClaimExpectedAction = z.infer<typeof ClaimExpectedActionSchema>;
export const ClaimWalletRoleSchema = z.enum([
  'TAX_RECEIVER',
  'COMMUNITY_FUND',
  'BUYBACK_BURN',
  'BUYBACK_LIQUIDITY',
  'PENSION_VAULT',
  'DIVIDEND_DISTRIBUTOR',
  'OTHER',
]);
export type ClaimWalletRole = z.infer<typeof ClaimWalletRoleSchema>;
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

export const ClaimDeclarationDraftSchema = z.object({
  id: z.string().regex(/^cld_[0-9a-f]{24}$/),
  assetId: z.string().min(1),
  role: ClaimWalletRoleSchema,
  expectedAction: ClaimExpectedActionSchema,
  sourceAddress: knowledgeValueSchema(z.string().min(1)),
  destinationAddress: knowledgeValueSchema(z.string().min(1)),
  expectedShareBps: knowledgeValueSchema(ClaimBpsSchema),
  shareUnitTokens: knowledgeValueSchema(UnsignedQuantityStringSchema),
  noExit: knowledgeValueSchema(z.boolean()),
  cadenceSeconds: knowledgeValueSchema(UnsignedQuantityStringSchema),
  window: knowledgeValueSchema(ClaimWindowSchema),
  matchedText: z.string().min(1),
  missingFields: z.array(z.string().min(1)),
  chainVerifyReadiness: z.enum(['READY_FOR_REVIEW', 'INCOMPLETE']),
  requiresHumanReview: z.literal(true),
  claimEvidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
});
export type ClaimDeclarationDraft = z.infer<typeof ClaimDeclarationDraftSchema>;

export const ClaimSourceDocumentSnapshotSchema = z
  .object({
    schemaVersion: z.literal('claim-source-document-snapshot-v1'),
    id: z.string().regex(/^csd_[0-9a-f]{24}$/),
    documentHash: Hash256Schema,
    contentHash: Hash256Schema,
    content: z.string().min(1).max(100_000),
    source: z.string().trim().min(1).max(512),
    sourceUri: z.url().max(2_048).optional(),
    capturedAt: IsoDateTimeSchema,
    offsetEncoding: z.literal('UTF16_CODE_UNITS'),
  })
  .strict();
export type ClaimSourceDocumentSnapshot = z.infer<typeof ClaimSourceDocumentSnapshotSchema>;

export const ClaimDeclarationCoverageSchema = z
  .object({
    documentCapture: CoverageRatioSchema,
    fieldExtraction: knowledgeValueSchema(CoverageRatioSchema),
    sourceIndependence: knowledgeValueSchema(CoverageRatioSchema),
    chainVerification: knowledgeValueSchema(CoverageRatioSchema),
  })
  .strict();
export type ClaimDeclarationCoverage = z.infer<typeof ClaimDeclarationCoverageSchema>;

export const ClaimDeclarationParseResultSchema = z
  .object({
    schemaVersion: z.literal('claim-declaration-report-v1'),
    id: z.string().regex(/^cdr_[0-9a-f]{24}$/),
    resultHash: Hash256Schema,
    parserVersion: z.string().min(1),
    documentHash: Hash256Schema,
    sourceSnapshot: ClaimSourceDocumentSnapshotSchema,
    assetId: z.string().min(1),
    evidence: EvidenceSchema,
    terminalEvidence: EvidenceSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(2),
    drafts: z.array(ClaimDeclarationDraftSchema),
    unmatchedAddresses: z.array(z.string().min(1)),
    warnings: z.array(z.string().min(1)),
    coverage: ClaimDeclarationCoverageSchema,
    freshness: IsoDateTimeSchema,
    sourceSet: z.array(z.string().trim().min(1)).min(1),
    modelVersion: z.string().trim().min(1),
    extractionConfidence: knowledgeValueSchema(ConfidenceSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const evidenceIds = [...new Set(value.evidenceIds)].sort();
    const sourceSet = [...new Set(value.sourceSet)].sort();
    const invalid =
      value.documentHash !== value.sourceSnapshot.documentHash ||
      value.evidence.source !== value.sourceSnapshot.source ||
      value.evidence.locator !== `claim-declaration:${value.documentHash}` ||
      value.evidence.observedAt !== value.sourceSnapshot.capturedAt ||
      value.terminalEvidence.id !== value.terminalEvidenceId ||
      value.freshness !== value.sourceSnapshot.capturedAt ||
      value.modelVersion !== value.parserVersion ||
      evidenceIds.length !== value.evidenceIds.length ||
      evidenceIds.some((id, index) => id !== value.evidenceIds[index]) ||
      !evidenceIds.includes(value.evidence.id) ||
      !evidenceIds.includes(value.terminalEvidenceId) ||
      sourceSet.length !== value.sourceSet.length ||
      sourceSet.some((source, index) => source !== value.sourceSet[index]) ||
      sourceSet.length !== 1 ||
      sourceSet[0] !== value.evidence.source ||
      value.coverage.documentCapture !== 1 ||
      value.coverage.chainVerification.state === 'known';
    if (invalid) {
      context.addIssue({
        code: 'custom',
        path: ['resultHash'],
        message:
          'Claim declaration reports require one exact source-document Snapshot, canonical Evidence/source metadata, and Unknown chain verification.',
      });
    }
  });
export type ClaimDeclarationParseResult = z.infer<typeof ClaimDeclarationParseResultSchema>;

export const ClaimRuleFieldOriginSchema = z.enum(['DECLARATION_CONFIRMED', 'ANALYST_OVERRIDE']);
export type ClaimRuleFieldOrigin = z.infer<typeof ClaimRuleFieldOriginSchema>;

export const ClaimRuleFieldOriginsSchema = z
  .object({
    assetId: z.literal('DECLARATION_CONFIRMED'),
    sourceAddress: ClaimRuleFieldOriginSchema,
    destinationAddress: ClaimRuleFieldOriginSchema,
    role: ClaimRuleFieldOriginSchema,
    expectedAction: ClaimRuleFieldOriginSchema,
    expectedShareBps: ClaimRuleFieldOriginSchema.nullable(),
    window: ClaimRuleFieldOriginSchema,
    shareUnit: ClaimRuleFieldOriginSchema.nullable(),
    noExit: ClaimRuleFieldOriginSchema.nullable(),
    cadenceSeconds: ClaimRuleFieldOriginSchema.nullable(),
  })
  .strict();
export type ClaimRuleFieldOrigins = z.infer<typeof ClaimRuleFieldOriginsSchema>;

export const ClaimRuleReviewCoverageSchema = z
  .object({
    sourceDocument: z.literal(1),
    humanReview: z.literal(1),
    fieldCompleteness: z.literal(1),
    chainVerification: knowledgeValueSchema(CoverageRatioSchema),
  })
  .strict();
export type ClaimRuleReviewCoverage = z.infer<typeof ClaimRuleReviewCoverageSchema>;

export const ClaimRuleReviewReportSchema = z
  .object({
    schemaVersion: z.literal('claim-rule-review-report-v1'),
    id: z.string().regex(/^crr_[0-9a-f]{24}$/),
    resultHash: Hash256Schema,
    declarationReportId: z.string().regex(/^cdr_[0-9a-f]{24}$/),
    declarationResultHash: Hash256Schema,
    documentHash: Hash256Schema,
    draftId: z.string().regex(/^cld_[0-9a-f]{24}$/),
    assetId: z.string().min(1),
    declarationDraft: ClaimDeclarationDraftSchema,
    reviewerLabel: z.string().trim().min(1).max(256),
    reviewedAt: IsoDateTimeSchema,
    rule: ClaimRuleSchema.extend({
      id: z.string().regex(/^clr_[0-9a-f]{24}$/),
      claimEvidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(3),
    }),
    fieldOrigins: ClaimRuleFieldOriginsSchema,
    tokenDecimals: knowledgeValueSchema(z.number().int().min(0).max(255)),
    tokenDecimalsEvidenceId: z
      .string()
      .regex(/^ev_[0-9a-f]{24}$/)
      .optional(),
    reviewEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    declarationEvidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).length(2),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(4),
    evidence: z.array(EvidenceSchema).min(4),
    coverage: ClaimRuleReviewCoverageSchema,
    claimTruth: knowledgeValueSchema(z.boolean()),
    reviewerAuthority: knowledgeValueSchema(z.boolean()),
    freshness: IsoDateTimeSchema,
    sourceSet: z.array(z.string().trim().min(1)).min(2),
    modelVersion: z.literal('claim-rule-review-v1.0.0'),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    requiresChainVerification: z.literal(true),
  })
  .strict()
  .superRefine((value, context) => {
    const canonical = (items: readonly string[]) => [...new Set(items)].sort();
    const evidenceIds = canonical(value.evidenceIds);
    const embeddedEvidenceIds = canonical(value.evidence.map((item) => item.id));
    const declarationEvidenceIds = canonical(value.declarationEvidenceIds);
    const ruleEvidenceIds = canonical(value.rule.claimEvidenceIds);
    const nonTerminalEvidenceIds = evidenceIds.filter((id) => id !== value.terminalEvidenceId);
    const sourceSet = canonical(value.sourceSet);
    const evidenceSourceSet = canonical(
      value.evidence
        .filter((item) => !['DERIVED_FEATURE', 'NEGATIVE_EVIDENCE'].includes(item.kind))
        .map((item) => item.source),
    );
    const decimalsEvidenceValid =
      value.tokenDecimals.state === 'known'
        ? value.tokenDecimalsEvidenceId !== undefined &&
          evidenceIds.includes(value.tokenDecimalsEvidenceId)
        : value.tokenDecimalsEvidenceId === undefined;
    const invalid =
      value.assetId !== value.rule.assetId ||
      value.assetId !== value.declarationDraft.assetId ||
      value.draftId !== value.declarationDraft.id ||
      value.freshness !== value.reviewedAt ||
      value.claimTruth.state === 'known' ||
      value.reviewerAuthority.state === 'known' ||
      value.confidence.state === 'known' ||
      value.coverage.chainVerification.state === 'known' ||
      !decimalsEvidenceValid ||
      evidenceIds.length !== value.evidenceIds.length ||
      evidenceIds.some((id, index) => id !== value.evidenceIds[index]) ||
      embeddedEvidenceIds.length !== evidenceIds.length ||
      embeddedEvidenceIds.some((id, index) => id !== evidenceIds[index]) ||
      declarationEvidenceIds.length !== value.declarationEvidenceIds.length ||
      declarationEvidenceIds.some((id, index) => id !== value.declarationEvidenceIds[index]) ||
      ruleEvidenceIds.length !== value.rule.claimEvidenceIds.length ||
      ruleEvidenceIds.some((id, index) => id !== value.rule.claimEvidenceIds[index]) ||
      !evidenceIds.includes(value.reviewEvidenceId) ||
      !evidenceIds.includes(value.terminalEvidenceId) ||
      !declarationEvidenceIds.every((id) => ruleEvidenceIds.includes(id)) ||
      !value.declarationDraft.claimEvidenceIds.every((id) => declarationEvidenceIds.includes(id)) ||
      !ruleEvidenceIds.includes(value.reviewEvidenceId) ||
      ruleEvidenceIds.includes(value.terminalEvidenceId) ||
      ruleEvidenceIds.length !== nonTerminalEvidenceIds.length ||
      ruleEvidenceIds.some((id, index) => id !== nonTerminalEvidenceIds[index]) ||
      sourceSet.length !== value.sourceSet.length ||
      sourceSet.some((source, index) => source !== value.sourceSet[index]) ||
      sourceSet.length !== evidenceSourceSet.length ||
      sourceSet.some((source, index) => source !== evidenceSourceSet[index]);
    if (invalid) {
      context.addIssue({
        code: 'custom',
        path: ['resultHash'],
        message:
          'Claim rule reviews require canonical declaration/review Evidence, complete reviewed fields, and Unknown truth/authority/chain confidence.',
      });
    }
  });
export type ClaimRuleReviewReport = z.infer<typeof ClaimRuleReviewReportSchema>;

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

export const EvmClaimTransferObservationSchema = ClaimTransferObservationSchema.extend({
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  transactionId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  blockNumber: UnsignedQuantityStringSchema,
  blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  transactionIndex: UnsignedQuantityStringSchema,
  logIndex: UnsignedQuantityStringSchema,
});
export type EvmClaimTransferObservation = z.infer<typeof EvmClaimTransferObservationSchema>;

export const EvmPensionCandidatePolicySchema = z.object({
  shareUnitAtomic: UnsignedQuantityStringSchema.refine((value) => BigInt(value) > 0n, {
    message: 'Pension candidate share unit must be positive.',
  }),
  minimumExactUnitDeposits: z.number().int().min(1).max(100_000),
  minimumUniqueExactUnitDepositors: z.number().int().min(1).max(100_000),
  maximumCandidates: z.number().int().min(1).max(1_000),
});
export type EvmPensionCandidatePolicy = z.infer<typeof EvmPensionCandidatePolicySchema>;

export const EvmPensionCandidateCriterionSchema = z.enum([
  'EXACT_SHARE_UNIT_DEPOSITS',
  'UNIQUE_DEPOSITOR_THRESHOLD',
]);

export const EvmPensionCandidateMetricsSchema = z
  .object({
    address: z.string().regex(/^0x[0-9a-f]{40}$/),
    inflowTransferCount: z.number().int().positive(),
    outflowTransferCount: z.number().int().nonnegative(),
    exactUnitDepositCount: z.number().int().positive(),
    exactMultipleDepositCount: z.number().int().positive(),
    nonMultipleDepositCount: z.number().int().nonnegative(),
    uniqueExactUnitDepositorCount: z.number().int().positive(),
    uniqueOutflowDestinationCount: z.number().int().nonnegative(),
    observedInflowAmount: UnsignedQuantityStringSchema,
    observedOutflowAmount: UnsignedQuantityStringSchema,
    observedNetAmount: QuantityStringSchema,
    observedWholeShares: UnsignedQuantityStringSchema,
    firstInflowAt: IsoDateTimeSchema,
    lastInflowAt: IsoDateTimeSchema,
    firstOutflowAt: knowledgeValueSchema(IsoDateTimeSchema),
    lastOutflowAt: knowledgeValueSchema(IsoDateTimeSchema),
    criteria: z.array(EvmPensionCandidateCriterionSchema).length(2),
    transferEvidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  })
  .superRefine((value, context) => {
    if (
      value.exactUnitDepositCount > value.exactMultipleDepositCount ||
      value.exactMultipleDepositCount + value.nonMultipleDepositCount !==
        value.inflowTransferCount ||
      value.uniqueExactUnitDepositorCount > value.exactUnitDepositCount ||
      BigInt(value.observedNetAmount) !==
        BigInt(value.observedInflowAmount) - BigInt(value.observedOutflowAmount) ||
      value.transferEvidenceIds.length !== new Set(value.transferEvidenceIds).size ||
      value.transferEvidenceIds.some(
        (evidenceId, index) => evidenceId !== [...value.transferEvidenceIds].sort()[index],
      ) ||
      value.criteria[0] !== 'EXACT_SHARE_UNIT_DEPOSITS' ||
      value.criteria[1] !== 'UNIQUE_DEPOSITOR_THRESHOLD'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['address'],
        message: 'Pension candidate metrics and canonical provenance must agree.',
      });
    }
    const hasOutflow = value.outflowTransferCount > 0;
    if (
      value.uniqueOutflowDestinationCount > value.outflowTransferCount ||
      (hasOutflow &&
        (value.firstOutflowAt.state !== 'known' || value.lastOutflowAt.state !== 'known')) ||
      (!hasOutflow &&
        (value.firstOutflowAt.state !== 'unknown' || value.lastOutflowAt.state !== 'unknown'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['outflowTransferCount'],
        message: 'Pension candidate outflow timing must match observed outflows.',
      });
    }
  });
export type EvmPensionCandidateMetrics = z.infer<typeof EvmPensionCandidateMetricsSchema>;

export const EvmPensionVaultCandidateSchema = EvmPensionCandidateMetricsSchema.extend({
  evidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  roleAttribution: knowledgeValueSchema(z.literal('PENSION_VAULT')),
  participantExitPolicy: knowledgeValueSchema(z.boolean()),
  dividendExecution: knowledgeValueSchema(z.boolean()),
}).superRefine((value, context) => {
  for (const field of ['roleAttribution', 'participantExitPolicy', 'dividendExecution'] as const) {
    if (value[field].state === 'known') {
      context.addIssue({
        code: 'custom',
        path: [field],
        message: 'Behavioral candidate discovery cannot promote social or policy meaning to fact.',
      });
    }
  }
});
export type EvmPensionVaultCandidate = z.infer<typeof EvmPensionVaultCandidateSchema>;

export const EvmPensionCandidateDiscoverySchema = z
  .object({
    tokenAddress: z.string().regex(/^0x[0-9a-f]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    policy: EvmPensionCandidatePolicySchema,
    scannedTransferCount: z.number().int().nonnegative(),
    candidates: z.array(EvmPensionVaultCandidateSchema),
    coverageEvidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('evm-pension-candidate-discovery-v1.0.0'),
    }),
  })
  .superRefine((value, context) => {
    const snapshot = value.metadata.snapshot;
    const addresses = value.candidates.map((candidate) => candidate.address);
    const coverageEvidenceIds = [...value.coverageEvidenceIds];
    const expectedEvidenceIds = [
      ...coverageEvidenceIds,
      ...value.candidates.map((candidate) => candidate.evidenceId),
      value.terminalEvidenceId,
    ].sort();
    const actualEvidenceIds = [...value.metadata.evidenceIds].sort();
    if (
      BigInt(value.toBlock) < BigInt(value.fromBlock) ||
      snapshot?.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockTimestamp === undefined ||
      snapshot.blockNumber !== value.toBlock ||
      value.metadata.freshness !== snapshot.blockTimestamp ||
      value.metadata.dataCoverage !== 1 ||
      value.metadata.historyCoverage !== 1 ||
      value.metadata.sourceSet.length === 0 ||
      value.metadata.sourceSet.length !== new Set(value.metadata.sourceSet).size ||
      value.metadata.sourceSet.some(
        (source, index) => source !== [...value.metadata.sourceSet].sort()[index],
      ) ||
      addresses.length !== new Set(addresses).size ||
      addresses.some((address, index) => address !== [...addresses].sort()[index]) ||
      value.candidates.length > value.policy.maximumCandidates ||
      coverageEvidenceIds.length !== new Set(coverageEvidenceIds).size ||
      coverageEvidenceIds.some(
        (evidenceId, index) => evidenceId !== [...coverageEvidenceIds].sort()[index],
      ) ||
      expectedEvidenceIds.length !== actualEvidenceIds.length ||
      expectedEvidenceIds.some((evidenceId, index) => evidenceId !== actualEvidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Pension candidate report range, coverage, order and Evidence must be canonical.',
      });
    }
    for (const candidate of value.candidates) {
      if (
        candidate.exactUnitDepositCount < value.policy.minimumExactUnitDeposits ||
        candidate.uniqueExactUnitDepositorCount < value.policy.minimumUniqueExactUnitDepositors
      ) {
        context.addIssue({
          code: 'custom',
          path: ['candidates'],
          message: 'Every emitted pension candidate must satisfy the recorded policy.',
        });
      }
    }
  });
export type EvmPensionCandidateDiscovery = z.infer<typeof EvmPensionCandidateDiscoverySchema>;

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

export const ClaimBurnConservationStatusSchema = z.enum([
  'VERIFIED',
  'CONTRADICTED',
  'NOT_APPLICABLE',
]);
export const EvmClaimBurnConservationSchema = z
  .object({
    tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    blockNumber: UnsignedQuantityStringSchema,
    blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    parentBlockNumber: UnsignedQuantityStringSchema,
    parentBlockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    totalSupplyBefore: UnsignedQuantityStringSchema,
    totalSupplyAfter: UnsignedQuantityStringSchema,
    mintedAmount: UnsignedQuantityStringSchema,
    burnedAmount: UnsignedQuantityStringSchema,
    supplyDelta: QuantityStringSchema,
    eventNetSupplyDelta: QuantityStringSchema,
    expectedSupplyAfter: QuantityStringSchema,
    status: ClaimBurnConservationStatusSchema,
    candidateBurnTransferIds: z.array(z.string().min(1)),
    actions: z.array(ClaimActionObservationSchema),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('erc20-burn-conservation-v1.0.0'),
    }),
  })
  .superRefine((value, context) => {
    const before = BigInt(value.totalSupplyBefore);
    const after = BigInt(value.totalSupplyAfter);
    const minted = BigInt(value.mintedAmount);
    const burned = BigInt(value.burnedAmount);
    const expectedAfter = before + minted - burned;
    const conserved = expectedAfter === after;
    const snapshot = value.metadata.snapshot;
    if (BigInt(value.parentBlockNumber) + 1n !== BigInt(value.blockNumber)) {
      context.addIssue({
        code: 'custom',
        path: ['parentBlockNumber'],
        message: 'Burn conservation requires adjacent parent and target blocks.',
      });
    }
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockTimestamp === undefined ||
      snapshot.blockNumber !== value.blockNumber ||
      snapshot.blockHash.toLowerCase() !== value.blockHash.toLowerCase() ||
      snapshot.parentBlockHash?.toLowerCase() !== value.parentBlockHash.toLowerCase() ||
      value.metadata.freshness !== snapshot.blockTimestamp
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Burn conservation metadata must bind the exact target and parent block.',
      });
    }
    if (value.metadata.dataCoverage !== 1 || value.metadata.historyCoverage !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Burn conservation requires complete target-block data and history.',
      });
    }
    if (
      value.supplyDelta !== (after - before).toString() ||
      value.eventNetSupplyDelta !== (minted - burned).toString() ||
      value.expectedSupplyAfter !== expectedAfter.toString()
    ) {
      context.addIssue({
        code: 'custom',
        path: ['supplyDelta'],
        message: 'Burn conservation arithmetic is inconsistent.',
      });
    }
    const expectedStatus = !conserved
      ? 'CONTRADICTED'
      : burned === 0n
        ? 'NOT_APPLICABLE'
        : 'VERIFIED';
    if (value.status !== expectedStatus) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Burn conservation status does not match the supply/event result.',
      });
    }
    if (
      new Set(value.candidateBurnTransferIds).size !== value.candidateBurnTransferIds.length ||
      new Set(value.actions.map((action) => action.id)).size !== value.actions.length ||
      new Set(value.metadata.evidenceIds).size !== value.metadata.evidenceIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'Burn conservation action and transfer identities must be unique.',
      });
    }
    if (!value.metadata.evidenceIds.includes(value.terminalEvidenceId)) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceId'],
        message: 'Burn conservation metadata must include terminal Evidence.',
      });
    }
    if ((!conserved || burned === 0n) && value.actions.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'Burn actions require verified non-zero supply/event conservation.',
      });
    }
    const mappedTransferIds = value.actions.flatMap((action) => action.transferIds);
    const metadataEvidenceIds = new Set(value.metadata.evidenceIds);
    const snapshotBlockTimestamp = snapshot?.ledger === 'EVM' ? snapshot.blockTimestamp : undefined;
    if (
      conserved &&
      burned > 0n &&
      (value.actions.length !== value.candidateBurnTransferIds.length ||
        new Set(mappedTransferIds).size !== mappedTransferIds.length ||
        value.candidateBurnTransferIds.some((id) => !mappedTransferIds.includes(id)) ||
        value.actions.reduce((total, action) => total + BigInt(action.amount), 0n) !== burned ||
        value.actions.some(
          (action) =>
            action.type !== 'BURN' ||
            action.liquidityControl !== undefined ||
            action.transferIds.length !== 1 ||
            !value.candidateBurnTransferIds.includes(action.transferIds[0] ?? '') ||
            action.path.length !== 2 ||
            !/^0x[a-fA-F0-9]{40}$/.test(action.actor) ||
            !action.path.every((address) => /^0x[a-fA-F0-9]{40}$/.test(address)) ||
            action.path[0]?.toLowerCase() !== action.actor.toLowerCase() ||
            action.path[1]?.toLowerCase() !== `0x${'0'.repeat(40)}` ||
            action.evidenceIds.includes(value.terminalEvidenceId) ||
            new Set(action.evidenceIds).size !== action.evidenceIds.length ||
            action.evidenceIds.some((id) => !metadataEvidenceIds.has(id)) ||
            action.observedAt !== snapshotBlockTimestamp,
        ))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['actions'],
        message: 'Verified burn actions must map one-to-one to conserved zero-address transfers.',
      });
    }
  });
export type EvmClaimBurnConservation = z.infer<typeof EvmClaimBurnConservationSchema>;

export const EvmClaimBurnCandidateBlockSchema = z.object({
  blockNumber: UnsignedQuantityStringSchema,
  blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  burnTransferIds: z.array(z.string().min(1)).min(1),
  mintedEventAmount: UnsignedQuantityStringSchema,
  burnedEventAmount: UnsignedQuantityStringSchema,
});
export type EvmClaimBurnCandidateBlock = z.infer<typeof EvmClaimBurnCandidateBlockSchema>;

export const EvmClaimBurnCandidateDiscoverySchema = z
  .object({
    tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    coverageScope: z.literal('ERC20_ZERO_ADDRESS_TRANSFER_EVENTS'),
    status: z.enum(['CANDIDATES_DISCOVERED', 'NO_EVENT_CANDIDATES']),
    zeroAddressEventCount: z.number().int().nonnegative(),
    burnCandidateCount: z.number().int().nonnegative(),
    candidates: z.array(EvmClaimBurnCandidateBlockSchema),
    silentSupplyChangeDetection: knowledgeValueSchema(z.boolean()),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('erc20-burn-candidate-discovery-v1.0.0'),
    }),
  })
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const snapshot = value.metadata.snapshot;
    const expectedStatus =
      value.candidates.length === 0 ? 'NO_EVENT_CANDIDATES' : 'CANDIDATES_DISCOVERED';
    if (toBlock < fromBlock) {
      context.addIssue({
        code: 'custom',
        path: ['toBlock'],
        message: 'Burn candidate discovery range must be ordered.',
      });
    }
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockTimestamp === undefined ||
      snapshot.blockNumber !== value.toBlock ||
      value.metadata.freshness !== snapshot.blockTimestamp
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Burn candidate discovery must bind the finalized range-end Snapshot.',
      });
    }
    if (value.metadata.dataCoverage !== 1 || value.metadata.historyCoverage !== 1) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Burn candidate discovery requires complete event-query coverage.',
      });
    }
    if (
      value.status !== expectedStatus ||
      value.burnCandidateCount !== value.candidates.length ||
      value.zeroAddressEventCount <
        value.candidates.reduce((total, candidate) => total + candidate.burnTransferIds.length, 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Burn candidate discovery counts and status are inconsistent.',
      });
    }
    if (value.silentSupplyChangeDetection.state !== 'unknown') {
      context.addIssue({
        code: 'custom',
        path: ['silentSupplyChangeDetection'],
        message: 'Event-only discovery cannot claim silent supply-change coverage.',
      });
    }
    const candidateBlocks = new Set<string>();
    const transferIds = new Set<string>();
    let previousBlock: bigint | undefined;
    for (const candidate of value.candidates) {
      const block = BigInt(candidate.blockNumber);
      const invalidTransferIdentity = candidate.burnTransferIds.some((id) => {
        if (transferIds.has(id)) return true;
        transferIds.add(id);
        return false;
      });
      if (
        block < fromBlock ||
        block > toBlock ||
        (previousBlock !== undefined && block <= previousBlock) ||
        candidateBlocks.has(candidate.blockNumber) ||
        invalidTransferIdentity ||
        BigInt(candidate.burnedEventAmount) <= 0n ||
        (snapshot?.ledger === 'EVM' &&
          candidate.blockNumber === snapshot.blockNumber &&
          candidate.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase())
      ) {
        context.addIssue({
          code: 'custom',
          path: ['candidates'],
          message: 'Burn candidates must be unique, ordered, in-range, and Snapshot-consistent.',
        });
        break;
      }
      candidateBlocks.add(candidate.blockNumber);
      previousBlock = block;
    }
    if (
      !value.metadata.evidenceIds.includes(value.terminalEvidenceId) ||
      new Set(value.metadata.evidenceIds).size !== value.metadata.evidenceIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['terminalEvidenceId'],
        message: 'Burn candidate discovery requires unique metadata and terminal Evidence.',
      });
    }
  });
export type EvmClaimBurnCandidateDiscovery = z.infer<typeof EvmClaimBurnCandidateDiscoverySchema>;

export const EvmClaimBurnPromotionCertificateSchema = z.object({
  blockNumber: UnsignedQuantityStringSchema,
  blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  burnTransferIds: z.array(z.string().min(1)).min(1),
  mintedEventAmount: UnsignedQuantityStringSchema,
  burnedEventAmount: UnsignedQuantityStringSchema,
  status: z.enum(['VERIFIED', 'CONTRADICTED']),
  actionCount: z.number().int().nonnegative(),
  terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
});
export type EvmClaimBurnPromotionCertificate = z.infer<
  typeof EvmClaimBurnPromotionCertificateSchema
>;

export const EvmClaimBurnPromotionSegmentSchema = z
  .object({
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    zeroAddressEventCount: z.number().int().nonnegative(),
    burnCandidateCount: z.number().int().nonnegative(),
    discoveryTerminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    certificates: z.array(EvmClaimBurnPromotionCertificateSchema),
    snapshot: EvmSnapshotSchema,
    sourceSet: z.array(z.string().min(1)).min(1),
  })
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const transferIds = new Set<string>();
    let previousBlock: bigint | undefined;
    if (
      toBlock < fromBlock ||
      value.burnCandidateCount !== value.certificates.length ||
      value.snapshot.blockNumber !== value.toBlock ||
      value.snapshot.finality !== 'finalized' ||
      value.snapshot.blockTimestamp === undefined ||
      new Set(value.sourceSet).size !== value.sourceSet.length ||
      [...value.sourceSet].sort().some((source, index) => source !== value.sourceSet[index]) ||
      Object.keys(value.snapshot.providerVersions).some(
        (source) => !value.sourceSet.includes(source),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['burnCandidateCount'],
        message: 'Burn promotion segment range and candidate count must be consistent.',
      });
    }
    for (const certificate of value.certificates) {
      const block = BigInt(certificate.blockNumber);
      const duplicateTransfer = certificate.burnTransferIds.some((id) => {
        if (transferIds.has(id)) return true;
        transferIds.add(id);
        return false;
      });
      if (
        block < fromBlock ||
        block > toBlock ||
        (previousBlock !== undefined && block <= previousBlock) ||
        duplicateTransfer ||
        BigInt(certificate.burnedEventAmount) <= 0n ||
        (certificate.status === 'VERIFIED'
          ? certificate.actionCount !== certificate.burnTransferIds.length
          : certificate.actionCount !== 0)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['certificates'],
          message:
            'Burn promotion certificates must be ordered, unique, in-range, and action-consistent.',
        });
        break;
      }
      previousBlock = block;
    }
  });
export type EvmClaimBurnPromotionSegment = z.infer<typeof EvmClaimBurnPromotionSegmentSchema>;

export const EvmClaimBurnPromotionSchema = z
  .object({
    tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    coverageScope: z.literal(
      'ERC20_ZERO_ADDRESS_TRANSFER_EVENTS_WITH_EXACT_BLOCK_SUPPLY_CONSERVATION',
    ),
    status: z.literal('REQUESTED_RANGE_COMPLETE'),
    segmentCount: z.number().int().positive(),
    zeroAddressEventCount: z.number().int().nonnegative(),
    burnCandidateCount: z.number().int().nonnegative(),
    verifiedCandidateCount: z.number().int().nonnegative(),
    contradictedCandidateCount: z.number().int().nonnegative(),
    verifiedActionCount: z.number().int().nonnegative(),
    segments: z.array(EvmClaimBurnPromotionSegmentSchema).min(1),
    silentSupplyChangeDetection: knowledgeValueSchema(z.boolean()),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('erc20-burn-candidate-promotion-v1.0.0'),
    }),
  })
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const snapshot = value.metadata.snapshot;
    let nextBlock = fromBlock;
    const terminalEvidenceIds: string[] = [];
    const sourceSet = new Set<string>();
    const certificates = value.segments.flatMap((segment) => {
      if (BigInt(segment.fromBlock) !== nextBlock) {
        context.addIssue({
          code: 'custom',
          path: ['segments'],
          message: 'Burn promotion segments must be contiguous.',
        });
      }
      nextBlock = BigInt(segment.toBlock) + 1n;
      terminalEvidenceIds.push(
        segment.discoveryTerminalEvidenceId,
        ...segment.certificates.map((certificate) => certificate.terminalEvidenceId),
      );
      segment.sourceSet.forEach((source) => sourceSet.add(source));
      return segment.certificates;
    });
    terminalEvidenceIds.push(value.terminalEvidenceId);
    const verified = certificates.filter((item) => item.status === 'VERIFIED');
    const contradicted = certificates.filter((item) => item.status === 'CONTRADICTED');
    if (
      toBlock < fromBlock ||
      nextBlock !== toBlock + 1n ||
      value.segmentCount !== value.segments.length ||
      value.zeroAddressEventCount !==
        value.segments.reduce((total, segment) => total + segment.zeroAddressEventCount, 0) ||
      value.burnCandidateCount !== certificates.length ||
      value.verifiedCandidateCount !== verified.length ||
      value.contradictedCandidateCount !== contradicted.length ||
      value.verifiedActionCount !==
        verified.reduce((total, certificate) => total + certificate.actionCount, 0)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['segments'],
        message: 'Burn promotion range and aggregate counts are inconsistent.',
      });
    }
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockTimestamp === undefined ||
      snapshot.blockNumber !== value.toBlock ||
      snapshot.blockHash.toLowerCase() !==
        value.segments.at(-1)?.snapshot.blockHash.toLowerCase() ||
      value.metadata.freshness !== snapshot.blockTimestamp ||
      value.metadata.dataCoverage !== 1 ||
      value.metadata.historyCoverage !== 1 ||
      [...sourceSet].sort().some((source, index) => source !== value.metadata.sourceSet[index]) ||
      sourceSet.size !== value.metadata.sourceSet.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Burn promotion must bind complete scoped coverage to its final Snapshot.',
      });
    }
    if (value.silentSupplyChangeDetection.state !== 'unknown') {
      context.addIssue({
        code: 'custom',
        path: ['silentSupplyChangeDetection'],
        message: 'Event promotion cannot claim silent supply-change coverage.',
      });
    }
    const expectedEvidenceIds = [...new Set(terminalEvidenceIds)].sort();
    const actualEvidenceIds = [...value.metadata.evidenceIds].sort();
    if (
      expectedEvidenceIds.length !== terminalEvidenceIds.length ||
      expectedEvidenceIds.length !== actualEvidenceIds.length ||
      expectedEvidenceIds.some((id, index) => id !== actualEvidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'evidenceIds'],
        message:
          'Burn promotion metadata must contain each terminal Evidence identity exactly once.',
      });
    }
  });
export type EvmClaimBurnPromotion = z.infer<typeof EvmClaimBurnPromotionSchema>;

export const EvmSupplyContinuityChangeSchema = z
  .object({
    blockNumber: UnsignedQuantityStringSchema,
    blockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    parentBlockHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    totalSupplyBefore: UnsignedQuantityStringSchema,
    totalSupplyAfter: UnsignedQuantityStringSchema,
    supplyDelta: QuantityStringSchema,
    mintedEventAmount: UnsignedQuantityStringSchema,
    burnedEventAmount: UnsignedQuantityStringSchema,
    eventNetSupplyDelta: QuantityStringSchema,
    reconciliationStatus: z.enum(['EVENT_CONSERVED', 'UNEXPLAINED']),
    certificateStatus: ClaimBurnConservationStatusSchema,
    certificateTerminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
  })
  .superRefine((value, context) => {
    const before = BigInt(value.totalSupplyBefore);
    const after = BigInt(value.totalSupplyAfter);
    const delta = after - before;
    const eventDelta = BigInt(value.mintedEventAmount) - BigInt(value.burnedEventAmount);
    const expectedStatus = delta === eventDelta ? 'EVENT_CONSERVED' : 'UNEXPLAINED';
    if (
      delta === 0n ||
      value.supplyDelta !== delta.toString() ||
      value.eventNetSupplyDelta !== eventDelta.toString() ||
      value.reconciliationStatus !== expectedStatus ||
      (expectedStatus === 'UNEXPLAINED' && value.certificateStatus !== 'CONTRADICTED') ||
      (expectedStatus === 'EVENT_CONSERVED' && value.certificateStatus === 'CONTRADICTED')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['reconciliationStatus'],
        message: 'Supply-continuity change arithmetic and event reconciliation must agree.',
      });
    }
  });
export type EvmSupplyContinuityChange = z.infer<typeof EvmSupplyContinuityChangeSchema>;

export const EvmSupplyContinuitySegmentSchema = z
  .object({
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    sampleCount: z.number().int().min(2),
    startTotalSupply: UnsignedQuantityStringSchema,
    endTotalSupply: UnsignedQuantityStringSchema,
    supplyChangeCount: z.number().int().nonnegative(),
    eventConservedChangeCount: z.number().int().nonnegative(),
    unexplainedChangeCount: z.number().int().nonnegative(),
    changes: z.array(EvmSupplyContinuityChangeSchema),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    snapshot: EvmSnapshotSchema,
    sourceSet: z.array(z.string().min(1)).min(1),
  })
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const expectedSamples = Number(toBlock - fromBlock + 2n);
    const eventConserved = value.changes.filter(
      (change) => change.reconciliationStatus === 'EVENT_CONSERVED',
    ).length;
    const unexplained = value.changes.length - eventConserved;
    let previous: bigint | undefined;
    const invalidChange = value.changes.some((change) => {
      const block = BigInt(change.blockNumber);
      const invalid =
        block < fromBlock ||
        block > toBlock ||
        (previous !== undefined && block <= previous) ||
        (block === toBlock && change.blockHash.toLowerCase() !== value.snapshot.blockHash);
      previous = block;
      return invalid;
    });
    if (
      fromBlock < 1n ||
      toBlock < fromBlock ||
      !Number.isSafeInteger(expectedSamples) ||
      value.sampleCount !== expectedSamples ||
      value.supplyChangeCount !== value.changes.length ||
      value.eventConservedChangeCount !== eventConserved ||
      value.unexplainedChangeCount !== unexplained ||
      value.snapshot.ledger !== 'EVM' ||
      value.snapshot.finality !== 'finalized' ||
      value.snapshot.blockTimestamp === undefined ||
      value.snapshot.blockNumber !== value.toBlock ||
      new Set(value.sourceSet).size !== value.sourceSet.length ||
      [...value.sourceSet].sort().some((source, index) => source !== value.sourceSet[index]) ||
      invalidChange
    ) {
      context.addIssue({
        code: 'custom',
        path: ['changes'],
        message: 'Supply-continuity segment range, samples, changes, and Snapshot must agree.',
      });
    }
  });
export type EvmSupplyContinuitySegment = z.infer<typeof EvmSupplyContinuitySegmentSchema>;

export const EvmSupplyContinuitySchema = z
  .object({
    tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    coverageScope: z.literal('ERC20_TOTAL_SUPPLY_EVERY_FINALIZED_BLOCK_WITH_EVENT_RECONCILIATION'),
    status: z.enum([
      'VERIFIED_NO_CHANGE',
      'VERIFIED_EVENT_CONSERVED_CHANGES',
      'UNEXPLAINED_SUPPLY_CHANGE',
      'INCONCLUSIVE_SOURCE_INDEPENDENCE',
    ]),
    segmentCount: z.number().int().positive(),
    scannedBlockCount: z.number().int().positive(),
    supplySampleCount: z.number().int().min(2),
    initialTotalSupply: UnsignedQuantityStringSchema,
    finalTotalSupply: UnsignedQuantityStringSchema,
    netSupplyDelta: QuantityStringSchema,
    supplyChangeCount: z.number().int().nonnegative(),
    eventConservedChangeCount: z.number().int().nonnegative(),
    unexplainedChangeCount: z.number().int().nonnegative(),
    segments: z.array(EvmSupplyContinuitySegmentSchema).min(1),
    sourceIndependence: SourceIndependenceAssessmentSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('erc20-supply-continuity-v1.0.0'),
    }),
  })
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const snapshot = value.metadata.snapshot;
    const changes = value.segments.flatMap((segment) => segment.changes);
    let nextBlock = fromBlock;
    let sampleCount = 0;
    const sourceSet = new Set<string>();
    for (const [index, segment] of value.segments.entries()) {
      if (BigInt(segment.fromBlock) !== nextBlock) {
        context.addIssue({
          code: 'custom',
          path: ['segments', index],
          message: 'Supply-continuity segments must be contiguous.',
        });
      }
      nextBlock = BigInt(segment.toBlock) + 1n;
      sampleCount += segment.sampleCount - (index === 0 ? 0 : 1);
      segment.sourceSet.forEach((source) => sourceSet.add(source));
    }
    const eventConserved = changes.filter(
      (change) => change.reconciliationStatus === 'EVENT_CONSERVED',
    ).length;
    const unexplained = changes.length - eventConserved;
    const independentlyVerified =
      value.sourceIndependence.independence.state === 'known' &&
      value.sourceIndependence.independence.value;
    const expectedStatus =
      unexplained > 0
        ? 'UNEXPLAINED_SUPPLY_CHANGE'
        : !independentlyVerified
          ? 'INCONCLUSIVE_SOURCE_INDEPENDENCE'
          : changes.length === 0
            ? 'VERIFIED_NO_CHANGE'
            : 'VERIFIED_EVENT_CONSERVED_CHANGES';
    const expectedEvidenceIds = [
      ...value.segments.map((segment) => segment.terminalEvidenceId),
      ...value.sourceIndependence.evidenceIds,
      value.terminalEvidenceId,
    ].sort();
    const actualEvidenceIds = [...value.metadata.evidenceIds].sort();
    const expectedScannedBlocks = toBlock - fromBlock + 1n;
    if (
      fromBlock < 1n ||
      toBlock < fromBlock ||
      expectedScannedBlocks > BigInt(Number.MAX_SAFE_INTEGER) ||
      nextBlock !== toBlock + 1n ||
      value.segmentCount !== value.segments.length ||
      value.scannedBlockCount !== Number(expectedScannedBlocks) ||
      value.supplySampleCount !== sampleCount ||
      value.initialTotalSupply !== value.segments[0]?.startTotalSupply ||
      value.finalTotalSupply !== value.segments.at(-1)?.endTotalSupply ||
      value.netSupplyDelta !==
        (BigInt(value.finalTotalSupply) - BigInt(value.initialTotalSupply)).toString() ||
      value.supplyChangeCount !== changes.length ||
      value.eventConservedChangeCount !== eventConserved ||
      value.unexplainedChangeCount !== unexplained ||
      value.status !== expectedStatus
    ) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'Supply-continuity aggregate range, arithmetic, and status must agree.',
      });
    }
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      snapshot.finality !== 'finalized' ||
      snapshot.blockTimestamp === undefined ||
      snapshot.blockNumber !== value.toBlock ||
      snapshot.blockHash.toLowerCase() !==
        value.segments.at(-1)?.snapshot.blockHash.toLowerCase() ||
      value.metadata.freshness !== snapshot.blockTimestamp ||
      value.metadata.dataCoverage !== 1 ||
      value.metadata.historyCoverage !== 1 ||
      value.metadata.sourceCoverage !== (independentlyVerified ? 1 : 0.5) ||
      value.metadata.confidence !== (independentlyVerified ? 1 : 0.5) ||
      [...sourceSet].sort().some((source, index) => source !== value.metadata.sourceSet[index]) ||
      sourceSet.size !== value.metadata.sourceSet.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Supply-continuity metadata must bind complete scoped coverage and source truth.',
      });
    }
    if (
      expectedEvidenceIds.length !== new Set(expectedEvidenceIds).size ||
      expectedEvidenceIds.length !== actualEvidenceIds.length ||
      expectedEvidenceIds.some((id, index) => id !== actualEvidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'evidenceIds'],
        message: 'Supply-continuity metadata must contain each terminal Evidence identity once.',
      });
    }
  });
export type EvmSupplyContinuity = z.infer<typeof EvmSupplyContinuitySchema>;

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
  exactUnitDeposits: z.number().int().nonnegative(),
  exactMultipleDeposits: z.number().int().nonnegative(),
  nonMultipleDeposits: z.number().int().nonnegative(),
  observedWholeShares: UnsignedQuantityStringSchema,
  nonMultipleObservedAmount: UnsignedQuantityStringSchema,
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

export const EvmClaimAddressObservationSchema = z
  .object({
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
    // Older persisted v1.0 reports predate transfer replay. New production captures always include it.
    transfers: z.array(EvmClaimTransferObservationSchema).optional(),
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot !== null, {
      message: 'EVM claim address observation requires a replayable chain Snapshot.',
    }),
  })
  .superRefine((value, context) => {
    if (value.transfers === undefined) return;
    const address = value.address.toLowerCase();
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    const ids = value.transfers.map((transfer) => transfer.id);
    const invalidTransfer = value.transfers.some((transfer) => {
      const block = BigInt(transfer.blockNumber);
      return (
        block < fromBlock ||
        block > toBlock ||
        (transfer.from.toLowerCase() !== address && transfer.to.toLowerCase() !== address) ||
        transfer.evidenceIds.some((id) => !value.metadata.evidenceIds.includes(id))
      );
    });
    if (new Set(ids).size !== ids.length || invalidTransfer) {
      context.addIssue({
        code: 'custom',
        path: ['transfers'],
        message:
          'Replayable Claim address transfers must be unique, address-scoped, range-bounded, and Evidence-linked.',
      });
    }
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

export const ClaimVerificationObservationCoverageSchema = z
  .object({
    reviewedRule: z.literal(1),
    addressFlow: z.literal(1),
    custodyAtSnapshot: z.literal(1),
    custodyHistory: knowledgeValueSchema(CoverageRatioSchema),
    actionSemantics: knowledgeValueSchema(CoverageRatioSchema),
    sourceIndependence: knowledgeValueSchema(CoverageRatioSchema),
  })
  .strict();

export const ClaimVerificationObservationReportSchema = z
  .object({
    schemaVersion: z.literal('claim-verification-observation-report-v1'),
    id: z.string().regex(/^cvr_[0-9a-f]{24}$/),
    resultHash: Hash256Schema,
    reviewReportId: z.string().regex(/^crr_[0-9a-f]{24}$/),
    reviewResultHash: Hash256Schema,
    reviewTerminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    ruleId: z.string().regex(/^clr_[0-9a-f]{24}$/),
    assetId: z.string().min(1),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    sourceObservationReportId: z.string().regex(/^ecr_[0-9a-f]{24}$/),
    destinationObservationReportId: z.string().regex(/^ecr_[0-9a-f]{24}$/),
    sourceObservation: EvmClaimAddressObservationSchema,
    destinationObservation: EvmClaimAddressObservationSchema,
    observedBaseAmountLowerBound: UnsignedQuantityStringSchema,
    baseAmount: knowledgeValueSchema(UnsignedQuantityStringSchema),
    actions: z.array(ClaimActionObservationSchema),
    actionSemanticsReportIds: z.array(z.string().regex(/^asr_[0-9a-f]{24}$/)),
    actionSemanticsTerminalEvidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)),
    audit: ClaimAuditReportSchema,
    status: ClaimStatusSchema,
    claimTruth: knowledgeValueSchema(z.boolean()),
    coverage: ClaimVerificationObservationCoverageSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    metadata: AnalysisMetadataSchema.extend({
      modelVersion: z.literal('claim-verification-observation-v0.1.0'),
    }).refine((metadata) => metadata.snapshot !== null, {
      message: 'Claim verification observation requires a replayable chain Snapshot.',
    }),
  })
  .strict()
  .superRefine((value, context) => {
    const source = value.sourceObservation;
    const destination = value.destinationObservation;
    const snapshot = value.metadata.snapshot;
    const sourceSnapshot = source.metadata.snapshot;
    const destinationSnapshot = destination.metadata.snapshot;
    const auditSnapshot = value.audit.metadata.snapshot;
    const evidenceIds = [...new Set(value.evidenceIds)].sort();
    const actionReportIds = [...new Set(value.actionSemanticsReportIds)].sort();
    const actionTerminalIds = [...new Set(value.actionSemanticsTerminalEvidenceIds)].sort();
    const actionIds = [...new Set(value.actions.map((action) => action.id))].sort();
    if (
      snapshot === null ||
      snapshot.ledger !== 'EVM' ||
      sourceSnapshot === null ||
      sourceSnapshot.ledger !== 'EVM' ||
      destinationSnapshot === null ||
      destinationSnapshot.ledger !== 'EVM' ||
      auditSnapshot === null ||
      auditSnapshot.ledger !== 'EVM'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata', 'snapshot'],
        message: 'Claim verification observation v1 requires one EVM Snapshot.',
      });
      return;
    }
    const invalid =
      value.status !== value.audit.status ||
      value.claimTruth.state === 'known' ||
      value.fromBlock !== source.fromBlock ||
      value.fromBlock !== destination.fromBlock ||
      value.toBlock !== source.toBlock ||
      value.toBlock !== destination.toBlock ||
      sourceSnapshot.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase() ||
      destinationSnapshot.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase() ||
      sourceSnapshot.blockNumber !== snapshot.blockNumber ||
      destinationSnapshot.blockNumber !== snapshot.blockNumber ||
      auditSnapshot.blockHash.toLowerCase() !== snapshot.blockHash.toLowerCase() ||
      auditSnapshot.blockNumber !== snapshot.blockNumber ||
      source.transfers === undefined ||
      destination.transfers === undefined ||
      evidenceIds.length !== value.evidenceIds.length ||
      evidenceIds.some((id, index) => id !== value.evidenceIds[index]) ||
      !evidenceIds.includes(value.terminalEvidenceId) ||
      actionReportIds.length !== value.actionSemanticsReportIds.length ||
      actionReportIds.some((id, index) => id !== value.actionSemanticsReportIds[index]) ||
      actionTerminalIds.length !== value.actionSemanticsTerminalEvidenceIds.length ||
      actionTerminalIds.some(
        (id, index) => id !== value.actionSemanticsTerminalEvidenceIds[index],
      ) ||
      actionTerminalIds.length !== actionReportIds.length ||
      actionIds.length !== value.actions.length ||
      actionIds.some((id, index) => id !== value.actions[index]?.id) ||
      value.actions.length !== 0 ||
      value.actionSemanticsReportIds.length !== 0 ||
      value.actionSemanticsTerminalEvidenceIds.length !== 0 ||
      value.coverage.actionSemantics.state === 'known' ||
      value.metadata.freshness !== snapshot.capturedAt;
    if (invalid) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message:
          'Claim verification observations require canonical replay inputs, one chain Snapshot, Unknown authenticity, and complete Evidence identity.',
      });
    }
  });
export type ClaimVerificationObservationReport = z.infer<
  typeof ClaimVerificationObservationReportSchema
>;

export const CaptureKindSchema = z.enum([
  'CHAIN_HEAD',
  'TRANSACTION',
  'ADDRESS_FLOW',
  'TOKEN_FLOW',
  'CLAIM_ACTIONS',
  'LABEL_INTELLIGENCE',
  'ENTITY_GRAPH',
  'CONTROL_SURFACE',
  'LAUNCH_LIFECYCLE',
  'REALIZABLE_VALUE',
  'SCENARIO',
  'TOKEN_HISTORY_DISCOVERY',
  'TOKEN_HISTORY_BACKFILL',
  'TOKEN_LIVE_CAPTURE',
  'TOKEN_FLOW_MATERIALIZE',
  'ENTITY_CANDIDATE_REFRESH',
  'CLUSTER_POSITION_REFRESH',
  'BEHAVIOR_DETECTION',
  'CAMPAIGN_RECOMPUTE',
  'CAMPAIGN_ALERT',
  'FORENSIC_BUNDLE_EXPORT',
]);
export type CaptureKind = z.infer<typeof CaptureKindSchema>;

export const CaptureTargetSchema = z
  .object({
    ledger: LedgerSchema,
    chainId: z.string().trim().min(1).max(128),
    subjectType: SubjectTypeSchema,
    normalizedIdentifier: z.string().trim().min(1).max(512),
  })
  .strict();
export type CaptureTarget = z.infer<typeof CaptureTargetSchema>;

export const TokenHistoryBackfillParametersSchema = z
  .object({
    schemaVersion: z.literal('token-history-backfill-v1'),
    dataset: z.enum(['ethereum-mainnet', 'binance-mainnet']),
    token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    modelVersion: z.literal('token-history-backfill-v1.0.0'),
    policyVersion: z.literal('token-history-policy-v1.0.0'),
  })
  .strict()
  .superRefine((value, context) => {
    if (BigInt(value.toBlock) < BigInt(value.fromBlock)) {
      context.addIssue({
        code: 'custom',
        path: ['toBlock'],
        message: 'Token History backfill range must not end before it begins.',
      });
    }
  });
export type TokenHistoryBackfillParameters = z.infer<typeof TokenHistoryBackfillParametersSchema>;

export const TokenLiveCaptureParametersSchema = z
  .object({
    schemaVersion: z.literal('token-live-capture-v1'),
    dataset: z.enum(['ethereum-mainnet', 'binance-mainnet']),
    token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    initialFromBlock: UnsignedQuantityStringSchema,
    windowBlocks: z.number().int().min(1).max(1_000_000),
    modelVersion: z.literal('token-live-capture-v1.0.0'),
    policyVersion: z.literal('token-history-policy-v1.0.0'),
  })
  .strict();
export type TokenLiveCaptureParameters = z.infer<typeof TokenLiveCaptureParametersSchema>;

export const ActionSemanticsTransactionCaptureParametersSchema = z
  .object({
    schemaVersion: z.literal('action-semantics-transaction-capture-v1'),
    dataset: z.enum(['ethereum-mainnet', 'binance-mainnet', 'bitcoin-mainnet', 'solana-mainnet']),
    profile: z.literal('ledger-records'),
    blockOrSlot: UnsignedQuantityStringSchema,
    adapterVersion: z.literal('raw-ledger-action-adapter-v0.1.0'),
  })
  .strict();
export type ActionSemanticsTransactionCaptureParameters = z.infer<
  typeof ActionSemanticsTransactionCaptureParametersSchema
>;

export const EvmClaimActionsCaptureParametersSchema = z
  .object({
    schemaVersion: z.literal('evm-claim-actions-capture-v1'),
    reviewReportId: z.string().regex(/^crr_[0-9a-f]{24}$/),
    reviewResultHash: Hash256Schema,
    ruleId: z.string().regex(/^clr_[0-9a-f]{24}$/),
    assetId: z.string().regex(/^eip155:(?:0|[1-9]\d*):erc20:0x[0-9a-f]{40}$/),
    fromBlock: UnsignedQuantityStringSchema,
    toBlock: UnsignedQuantityStringSchema,
    observerVersion: z.literal('evm-claim-address-observation-v1.0.0'),
    limits: z
      .object({
        maxBlocksPerRequest: z.number().int().min(1).max(1_000_000),
        maxRequests: z.number().int().min(1).max(10_000),
        maxTransfers: z.number().int().min(1).max(1_000_000),
        topCounterpartyLimit: z.number().int().min(1).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (BigInt(value.toBlock) < BigInt(value.fromBlock)) {
      context.addIssue({
        code: 'custom',
        path: ['toBlock'],
        message: 'Claim Actions capture range must not end before it begins.',
      });
    }
    const requiredRequests =
      ((BigInt(value.toBlock) - BigInt(value.fromBlock)) /
        BigInt(value.limits.maxBlocksPerRequest) +
        1n) *
      2n;
    if (requiredRequests > BigInt(value.limits.maxRequests)) {
      context.addIssue({
        code: 'custom',
        path: ['limits', 'maxRequests'],
        message:
          'Claim Actions request budget must cover both indexed address directions across the range.',
      });
    }
  });
export type EvmClaimActionsCaptureParameters = z.infer<
  typeof EvmClaimActionsCaptureParametersSchema
>;

export const CaptureTriggerSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('ONCE'),
      at: IsoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('INTERVAL'),
      anchorAt: IsoDateTimeSchema,
      everySeconds: z.number().int().min(30).max(31_536_000),
      catchupPolicy: z.literal('SKIP_MISSED'),
    })
    .strict(),
]);
export type CaptureTrigger = z.infer<typeof CaptureTriggerSchema>;

export const CaptureRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(20),
    initialDelaySeconds: z.number().int().min(1).max(86_400),
    maximumDelaySeconds: z.number().int().min(1).max(604_800),
    backoffMultiplierBps: z.number().int().min(10_000).max(100_000),
  })
  .strict()
  .refine((value) => value.maximumDelaySeconds >= value.initialDelaySeconds, {
    message: 'Maximum retry delay must not be below the initial delay.',
  });
export type CaptureRetryPolicy = z.infer<typeof CaptureRetryPolicySchema>;

export const CaptureScheduleDefinitionSchema = z
  .object({
    schemaVersion: z.literal('capture-schedule-v1'),
    id: z.string().regex(/^cps_[0-9a-f]{24}$/),
    identityHash: Hash256Schema,
    captureKind: CaptureKindSchema,
    operation: z.literal('READ_ONLY_CAPTURE'),
    target: CaptureTargetSchema,
    parameters: JsonValueSchema,
    trigger: CaptureTriggerSchema,
    retryPolicy: CaptureRetryPolicySchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict();
export type CaptureScheduleDefinition = z.infer<typeof CaptureScheduleDefinitionSchema>;

export const CaptureScheduleStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']);

export const CaptureScheduleRecordSchema = z
  .object({
    definition: CaptureScheduleDefinitionSchema,
    status: CaptureScheduleStatusSchema,
    nextRunAt: knowledgeValueSchema(IsoDateTimeSchema),
    revision: z.number().int().positive(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.createdAt !== value.definition.createdAt) {
      context.addIssue({
        code: 'custom',
        path: ['createdAt'],
        message: 'Schedule creation time must match the immutable definition.',
      });
    }
    if (value.status === 'ACTIVE' && value.nextRunAt.state !== 'known') {
      context.addIssue({
        code: 'custom',
        path: ['nextRunAt'],
        message: 'An active schedule requires a known next run time.',
      });
    }
    if (value.status !== 'ACTIVE' && value.nextRunAt.state === 'known') {
      context.addIssue({
        code: 'custom',
        path: ['nextRunAt'],
        message: 'A non-active schedule cannot expose a runnable next time.',
      });
    }
  });
export type CaptureScheduleRecord = z.infer<typeof CaptureScheduleRecordSchema>;

export const CaptureRunStatusSchema = z.enum([
  'LEASED',
  'RETRY_WAIT',
  'SUCCEEDED',
  'FAILED_TERMINAL',
]);

export const CaptureRunLeaseSchema = z
  .object({
    owner: z.string().trim().min(1).max(160),
    token: z.string().regex(/^[0-9a-f]{32}$/),
    expiresAt: IsoDateTimeSchema,
  })
  .strict();

export const CaptureRunSuccessSchema = z
  .object({
    resultRef: z.string().trim().min(1).max(512),
    snapshot: AnalysisSnapshotSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
    sourceSet: z.array(z.string().trim().min(1)).min(1),
    modelVersion: z.string().trim().min(1).max(160),
    coverage: CoverageRatioSchema,
    freshness: IsoDateTimeSchema,
    confidence: ConfidenceSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const sortedEvidence = [...new Set(value.evidenceIds)].sort();
    const sortedSources = [...new Set(value.sourceSet)].sort();
    if (
      sortedEvidence.length !== value.evidenceIds.length ||
      sortedEvidence.some((item, index) => item !== value.evidenceIds[index]) ||
      !value.evidenceIds.includes(value.terminalEvidenceId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Run Evidence IDs must be sorted, unique, and include the terminal Evidence.',
      });
    }
    if (
      sortedSources.length !== value.sourceSet.length ||
      sortedSources.some((item, index) => item !== value.sourceSet[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['sourceSet'],
        message: 'Run sources must be sorted and unique.',
      });
    }
    if (value.snapshot.capturedAt !== value.freshness) {
      context.addIssue({
        code: 'custom',
        path: ['freshness'],
        message: 'Run freshness must be the captured Snapshot time.',
      });
    }
  });
export type CaptureRunSuccess = z.infer<typeof CaptureRunSuccessSchema>;

export const CaptureRunFailureSchema = z
  .object({
    code: z.string().trim().min(1).max(160),
    detail: z.string().trim().min(1).max(2_000),
    sourceRetryable: z.boolean(),
  })
  .strict();

export const CaptureRunSchema = z
  .object({
    schemaVersion: z.literal('capture-run-v1'),
    id: z.string().regex(/^cpr_[0-9a-f]{24}$/),
    scheduleId: z.string().regex(/^cps_[0-9a-f]{24}$/),
    captureKind: CaptureKindSchema,
    operation: z.literal('READ_ONLY_CAPTURE'),
    target: CaptureTargetSchema,
    parameters: JsonValueSchema,
    scheduledFor: IsoDateTimeSchema,
    status: CaptureRunStatusSchema,
    attempt: z.number().int().min(1).max(20),
    maxAttempts: z.number().int().min(1).max(20),
    availableAt: IsoDateTimeSchema,
    lease: knowledgeValueSchema(CaptureRunLeaseSchema),
    result: knowledgeValueSchema(CaptureRunSuccessSchema),
    failure: knowledgeValueSchema(CaptureRunFailureSchema),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    completedAt: knowledgeValueSchema(IsoDateTimeSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const leased = value.status === 'LEASED';
    const succeeded = value.status === 'SUCCEEDED';
    const failed = value.status === 'RETRY_WAIT' || value.status === 'FAILED_TERMINAL';
    const terminal = succeeded || value.status === 'FAILED_TERMINAL';
    if (value.attempt > value.maxAttempts) {
      context.addIssue({
        code: 'custom',
        path: ['attempt'],
        message: 'Capture attempt may not exceed the configured maximum.',
      });
    }
    if ((leased && value.lease.state !== 'known') || (!leased && value.lease.state === 'known')) {
      context.addIssue({
        code: 'custom',
        path: ['lease'],
        message: 'Only a leased run may carry an active lease.',
      });
    }
    if (
      (succeeded && value.result.state !== 'known') ||
      (!succeeded && value.result.state === 'known')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Only a successful run may carry a capture result.',
      });
    }
    if (
      (failed && value.failure.state !== 'known') ||
      (!failed && value.failure.state === 'known')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['failure'],
        message: 'Only failed or retry-wait runs may carry a failure.',
      });
    }
    if (
      (terminal && value.completedAt.state !== 'known') ||
      (!terminal && value.completedAt.state === 'known')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'Only terminal runs require a completion time.',
      });
    }
    if (
      value.result.state === 'known' &&
      (value.result.value.snapshot.ledger !== value.target.ledger ||
        value.result.value.snapshot.chainId !== value.target.chainId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result', 'value', 'snapshot'],
        message: 'Capture result Snapshot must match the scheduled ledger target.',
      });
    }
    if (value.status === 'RETRY_WAIT' && value.attempt >= value.maxAttempts) {
      context.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'An exhausted run cannot remain retryable.',
      });
    }
  });
export type CaptureRun = z.infer<typeof CaptureRunSchema>;

export const ActionPrimitiveKindSchema = z.enum([
  'TRANSFER',
  'SWAP',
  'BURN',
  'MINT',
  'ADD_LIQUIDITY',
  'REMOVE_LIQUIDITY',
  'LP_LOCK',
  'DISTRIBUTION',
  'CONTRACT_CALL',
]);
export type ActionPrimitiveKind = z.infer<typeof ActionPrimitiveKindSchema>;

export const ActionApplicationSchema = z.enum(['APPLIED', 'NOT_APPLIED', 'UNKNOWN']);

export const ActionProofKindSchema = z.enum([
  'TRANSACTION_INPUT',
  'EXECUTION_RECEIPT',
  'CALL_TRACE',
  'TRANSFER_LOG',
  'BALANCE_DELTAS',
  'SWAP_EVENT',
  'SUPPLY_CONSERVATION',
  'LP_MINT_RESERVE_CHANGE',
  'LP_BURN_RESERVE_CHANGE',
  'LP_CUSTODY',
  'DISTRIBUTION_FLOWS',
  'VALUE_TRANSFER',
  'UTXO_CONSERVATION',
]);
export type ActionProofKind = z.infer<typeof ActionProofKindSchema>;

export const ActionAssetDeltaSchema = z
  .object({
    assetId: z.string().trim().min(1).max(512),
    account: z.string().trim().min(1).max(512),
    direction: z.enum(['DEBIT', 'CREDIT']),
    amount: UnsignedQuantityStringSchema.refine((value) => BigInt(value) > 0n, {
      message: 'Action delta amount must be positive.',
    }),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const evidenceIds = [...new Set(value.evidenceIds)].sort();
    if (
      evidenceIds.length !== value.evidenceIds.length ||
      evidenceIds.some((item, index) => item !== value.evidenceIds[index])
    ) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Action delta Evidence IDs must be sorted and unique.',
      });
    }
  });
export type ActionAssetDelta = z.infer<typeof ActionAssetDeltaSchema>;

function isCanonicalActionTransactionId(ledger: Ledger, transactionId: string): boolean {
  switch (ledger) {
    case 'EVM':
      return /^0x[0-9a-f]{64}$/.test(transactionId);
    case 'BITCOIN':
      return /^[0-9a-f]{64}$/.test(transactionId);
    case 'SOLANA':
      return /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(transactionId);
  }
}

export const ActionSemanticCandidateSchema = z
  .object({
    id: z.string().regex(/^acn_[0-9a-f]{24}$/),
    ledger: LedgerSchema,
    chainId: z.string().trim().min(1).max(128),
    transactionId: z.string().trim().min(1).max(512),
    blockOrSlot: UnsignedQuantityStringSchema,
    observedAt: IsoDateTimeSchema,
    proposedKind: ActionPrimitiveKindSchema,
    application: ActionApplicationSchema,
    actor: knowledgeValueSchema(z.string().trim().min(1).max(512)),
    counterparties: z.array(z.string().trim().min(1).max(512)).max(1_000),
    assetDeltas: z.array(ActionAssetDeltaSchema).max(10_000),
    proofKinds: z.array(ActionProofKindSchema).min(1),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const canonical = (items: readonly string[]) => [...new Set(items)].sort();
    const counterparties = canonical(value.counterparties);
    const proofs = canonical(value.proofKinds);
    const evidence = canonical(value.evidenceIds);
    if (!isCanonicalActionTransactionId(value.ledger, value.transactionId)) {
      context.addIssue({
        code: 'custom',
        path: ['transactionId'],
        message: 'Action transaction ID must be canonical for its ledger.',
      });
    }
    if (counterparties.some((item, index) => item !== value.counterparties[index])) {
      context.addIssue({
        code: 'custom',
        path: ['counterparties'],
        message: 'Action counterparties must be sorted and unique.',
      });
    }
    if (proofs.some((item, index) => item !== value.proofKinds[index])) {
      context.addIssue({
        code: 'custom',
        path: ['proofKinds'],
        message: 'Action proof kinds must be sorted and unique.',
      });
    }
    if (evidence.some((item, index) => item !== value.evidenceIds[index])) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceIds'],
        message: 'Action Evidence IDs must be sorted and unique.',
      });
    }
    if (value.assetDeltas.some((delta) => delta.evidenceIds.some((id) => !evidence.includes(id)))) {
      context.addIssue({
        code: 'custom',
        path: ['assetDeltas'],
        message: 'Every asset delta Evidence ID must belong to the candidate Evidence set.',
      });
    }
    if (value.application === 'NOT_APPLIED' && value.assetDeltas.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['assetDeltas'],
        message: 'A failed execution cannot carry applied asset deltas.',
      });
    }
  });
export type ActionSemanticCandidate = z.infer<typeof ActionSemanticCandidateSchema>;

export const ActionSemanticFindingCodeSchema = z.enum([
  'PRIMITIVE_CONFIRMED',
  'EXECUTION_NOT_APPLIED',
  'EXECUTION_UNKNOWN',
  'ACTOR_UNKNOWN',
  'PROOF_INCOMPLETE',
  'DELTA_SHAPE_INVALID',
  'INTENT_NOT_INFERRED',
]);

export const ActionSemanticObservationSchema = z
  .object({
    id: z.string().regex(/^act_[0-9a-f]{24}$/),
    candidateId: z.string().regex(/^acn_[0-9a-f]{24}$/),
    ledger: LedgerSchema,
    chainId: z.string().trim().min(1).max(128),
    transactionId: z.string().trim().min(1).max(512),
    blockOrSlot: UnsignedQuantityStringSchema,
    observedAt: IsoDateTimeSchema,
    proposedKind: ActionPrimitiveKindSchema,
    primitive: knowledgeValueSchema(ActionPrimitiveKindSchema),
    application: ActionApplicationSchema,
    actor: knowledgeValueSchema(z.string().trim().min(1).max(512)),
    counterparties: z.array(z.string().trim().min(1).max(512)).max(1_000),
    assetDeltas: z.array(ActionAssetDeltaSchema).max(10_000),
    proofKinds: z.array(ActionProofKindSchema).min(1),
    claimedPurpose: knowledgeValueSchema(ClaimExpectedActionSchema),
    confidence: knowledgeValueSchema(ConfidenceSchema),
    findings: z.array(ActionSemanticFindingCodeSchema).min(1),
    evidenceIds: z.array(z.string().regex(/^ev_[0-9a-f]{24}$/)).min(1),
  })
  .strict()
  .superRefine((value, context) => {
    const canonical = (items: readonly string[]) => [...new Set(items)].sort();
    if (!isCanonicalActionTransactionId(value.ledger, value.transactionId)) {
      context.addIssue({
        code: 'custom',
        path: ['transactionId'],
        message: 'Action transaction ID must be canonical for its ledger.',
      });
    }
    for (const [field, items] of [
      ['counterparties', value.counterparties],
      ['proofKinds', value.proofKinds],
      ['evidenceIds', value.evidenceIds],
    ] as const) {
      const expected = canonical(items);
      if (
        expected.length !== items.length ||
        expected.some((item, index) => item !== items[index])
      ) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: `Action ${field} must be sorted and unique.`,
        });
      }
    }
    if (new Set(value.findings).size !== value.findings.length) {
      context.addIssue({
        code: 'custom',
        path: ['findings'],
        message: 'Action findings must be unique.',
      });
    }
  });
export type ActionSemanticObservation = z.infer<typeof ActionSemanticObservationSchema>;

export const ActionSemanticsReportSchema = z
  .object({
    schemaVersion: z.literal('action-semantics-report-v1'),
    resultHash: Hash256Schema,
    snapshot: AnalysisSnapshotSchema,
    actions: z.array(ActionSemanticObservationSchema).min(1).max(10_000),
    classificationCoverage: CoverageRatioSchema,
    terminalEvidenceId: z.string().regex(/^ev_[0-9a-f]{24}$/),
    metadata: AnalysisMetadataSchema.refine((metadata) => metadata.snapshot !== null, {
      message: 'Action Semantics requires a replayable chain Snapshot.',
    }),
    evidence: z.array(EvidenceSchema).min(2).max(10_001),
  })
  .strict()
  .superRefine((value, context) => {
    const evidenceIds = value.evidence.map((item) => item.id);
    const metadataEvidence = [...value.metadata.evidenceIds].sort();
    const sortedEvidence = [...new Set(evidenceIds)].sort();
    const actionIds = value.actions.map((item) => item.id);
    const sortedActionIds = [...actionIds].sort();
    const actionEvidenceIds = [
      ...new Set(value.actions.flatMap((item) => item.evidenceIds)),
    ].sort();
    const nonTerminalEvidenceIds = sortedEvidence.filter(
      (item) => item !== value.terminalEvidenceId,
    );
    const nonDerivedSourceSet = [
      ...new Set(
        value.evidence
          .filter(
            (item) =>
              item.kind !== 'DERIVED_FEATURE' &&
              item.kind !== 'NEGATIVE_EVIDENCE' &&
              item.kind !== 'ANALYST_OBSERVATION',
          )
          .map((item) => item.source),
      ),
    ].sort();
    const metadataSourceSet = [...value.metadata.sourceSet];
    const knownActions = value.actions.filter((item) => item.primitive.state === 'known').length;
    const position =
      value.snapshot.ledger === 'EVM'
        ? value.snapshot.blockNumber
        : value.snapshot.ledger === 'BITCOIN'
          ? value.snapshot.height
          : value.snapshot.slot;
    if (
      value.metadata.snapshot === null ||
      JSON.stringify(value.metadata.snapshot) !== JSON.stringify(value.snapshot) ||
      value.metadata.freshness !== value.snapshot.capturedAt ||
      !['action-semantics-v0.1.0', 'action-semantics-v0.2.0'].includes(
        value.metadata.modelVersion,
      ) ||
      value.metadata.confidence !== 1 ||
      value.classificationCoverage !== knownActions / value.actions.length ||
      !evidenceIds.includes(value.terminalEvidenceId) ||
      sortedEvidence.length !== evidenceIds.length ||
      sortedEvidence.some((item, index) => item !== evidenceIds[index]) ||
      new Set(actionIds).size !== actionIds.length ||
      sortedActionIds.some((item, index) => item !== actionIds[index]) ||
      actionEvidenceIds.length !== nonTerminalEvidenceIds.length ||
      actionEvidenceIds.some((item, index) => item !== nonTerminalEvidenceIds[index]) ||
      metadataSourceSet.length !== nonDerivedSourceSet.length ||
      nonDerivedSourceSet.length === 0 ||
      metadataSourceSet.some((item, index) => item !== nonDerivedSourceSet[index]) ||
      metadataEvidence.length !== evidenceIds.length ||
      metadataEvidence.some((item, index) => item !== sortedEvidence[index]) ||
      value.evidence.some(
        (evidence) =>
          evidence.ledger !== value.snapshot.ledger ||
          evidence.chainId !== value.snapshot.chainId ||
          (evidence.blockOrSlot !== undefined && evidence.blockOrSlot !== position),
      ) ||
      value.actions.some(
        (action) =>
          action.ledger !== value.snapshot.ledger ||
          action.chainId !== value.snapshot.chainId ||
          action.blockOrSlot !== position ||
          action.evidenceIds.some((id) => !evidenceIds.includes(id)),
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['metadata'],
        message: 'Action Semantics Snapshot and Evidence provenance must be complete and exact.',
      });
    }
  });
export type ActionSemanticsReport = z.infer<typeof ActionSemanticsReportSchema>;

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
