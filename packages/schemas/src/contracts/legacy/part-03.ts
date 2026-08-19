import { z } from 'zod';
export * from './part-02.js';
import type {
  Evidence,
} from './part-02.js';
import {
  AnalysisSnapshotSchema,
  CampaignEvidenceIdSchema,
  CandidateDiscoveryIdSchema,
  CandidateWalletIdSchema,
  CanonicalStringArraySchema,
  ConfidenceSchema,
  CoverageRatioSchema,
  EvmAssetTransferObservationIdSchema,
  EvmCanonicalAddressSchema,
  FundingEdgeIdSchema,
  FundingSettlementPatternIdSchema,
  FundingSettlementReportIdSchema,
  FundingSettlementSuppressionIdSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  LedgerSchema,
  QuantityStringSchema,
  SettlementEdgeIdSchema,
  TokenFlowEdgeIdSchema,
  TokenFlowKindSchema,
  TokenHistoryDiscoveryReportSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-02.js';

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

export const EvmAssetSchema = z.union([z.literal('NATIVE'), EvmCanonicalAddressSchema]);

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

export const FundingSettlementResultCommonShape = {
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
