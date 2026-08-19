import { z } from 'zod';
export * from './part-13.js';
import {
  AnalysisMetadataSchema,
  AnchorReconciliationResultSchema,
  ConfidenceSchema,
  CoverageRatioSchema,
  DiscrepancyAuditResultSchema,
  DiscrepancyAuditStatusSchema,
  EvidenceSchema,
  FlapPancakeV2BuyScenarioResultSchema,
  FlapPancakeV2SellScenarioResultSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  QuantityStringSchema,
  SourceIndependenceAssessmentSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-13.js';

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

export const ClaimBpsSchema = UnsignedQuantityStringSchema.refine(
  (value) => BigInt(value) <= 10_000n,
  {
    message: 'Basis points may not exceed 10000.',
  },
);

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
