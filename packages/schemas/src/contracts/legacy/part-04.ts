import { z } from 'zod';
export * from './part-03.js';
import type {
  Evidence,
} from './part-03.js';
import {
  AnalysisSnapshotSchema,
  BehaviorEventIdSchema,
  BehaviorEventStatusSchema,
  BehaviorSuppressionReasonSchema,
  BehaviorTypeSchema,
  CampaignCalibrationStatusSchema,
  CampaignEvidenceFamilySchema,
  CampaignEvidenceIdSchema,
  CampaignEvidenceItemIdSchema,
  CampaignWalletRoleSchema,
  CandidateDiscoveryResultSchema,
  CanonicalStringArraySchema,
  CexBoundaryIdSchema,
  ClusterPositionIdSchema,
  ConfidenceSchema,
  ControlCampaignIdSchema,
  ControlCampaignStageSchema,
  ControlCampaignStatusSchema,
  ControlClusterVersionIdSchema,
  CoverageRatioSchema,
  DecimalStringSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  JsonValueSchema,
  LedgerSchema,
  QuantityStringSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-03.js';

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
