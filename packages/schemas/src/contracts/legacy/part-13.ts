import { z } from 'zod';
export * from './part-12.js';
import {
  AnalysisMetadataSchema,
  CoverageRatioSchema,
  DecimalStringSchema,
  EvidenceSchema,
  FlapLifetimeExtensionSchema,
  FlapLifetimeMaterializationSchema,
  Hash256Schema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-12.js';

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
