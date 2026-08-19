import { z } from 'zod';
export * from './part-11.js';
import type { Evidence } from './part-11.js';
import {
  AnalysisMetadataSchema,
  CoverageRatioSchema,
  DecimalStringSchema,
  EvidenceSchema,
  Hash256Schema,
  JsonValueSchema,
  LedgerSchema,
  SolanaAccountKindSchema,
  SolanaControlCoverageDomainSchema,
  SolanaControlRightSchema,
  SolanaMintControlSchema,
  SolanaMultisigControlSchema,
  SolanaProgramControlSchema,
  SolanaPublicKeySchema,
  SolanaTokenAccountControlSchema,
  SolanaTokenExtensionControlSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-11.js';

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

export const OptionalDecimalKnowledgeSchema = knowledgeValueSchema(DecimalStringSchema);
export const OptionalStringKnowledgeSchema = knowledgeValueSchema(z.string());
export const OptionalJsonKnowledgeSchema = knowledgeValueSchema(JsonValueSchema);

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
