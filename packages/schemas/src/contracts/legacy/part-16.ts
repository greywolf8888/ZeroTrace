import { z } from 'zod';
export * from './part-15.js';
import type {
  Evidence,
} from './part-15.js';
import {
  AnalysisMetadataSchema,
  ClaimActionObservationSchema,
  ClaimBpsSchema,
  ClaimBurnConservationStatusSchema,
  ClaimCustodyKindSchema,
  ClaimRuleSchema,
  ClaimStatusSchema,
  ClaimWindowSchema,
  CoverageRatioSchema,
  DecimalStringSchema,
  EvmClaimBurnPromotionSchema,
  EvmClaimTransferObservationSchema,
  EvmSnapshotSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  QuantityStringSchema,
  SourceIndependenceAssessmentSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-15.js';

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
