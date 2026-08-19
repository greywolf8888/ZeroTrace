import { z } from 'zod';
export * from './part-01.js';
import type {
  Evidence,
} from './part-01.js';
import {
  AnalysisSnapshotSchema,
  AnchorContinuityAssessmentSchema,
  ConfidenceSchema,
  CoverageRatioSchema,
  DataQualityAlertSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  LedgerSchema,
  PersistedChainAnchorObservationSchema,
  ReconciledChainAnchorSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-01.js';

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

export const CanonicalStringArraySchema = z.array(z.string().min(1)).superRefine((items, context) => {
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

export const TokenHistoryRpcDiagnosticsSchema = z.object({
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

export const TokenHistoryProviderCapabilitySchema = z.enum([
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
