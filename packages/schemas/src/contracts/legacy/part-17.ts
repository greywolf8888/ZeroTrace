import { z } from 'zod';
export * from './part-16.js';
import type { Evidence, Ledger } from './part-16.js';
import {
  AnalysisSnapshotSchema,
  ClaimVerificationObservationReportSchema,
  ConfidenceSchema,
  CoverageRatioSchema,
  Hash256Schema,
  IsoDateTimeSchema,
  JsonValueSchema,
  LedgerSchema,
  SubjectTypeSchema,
  UnsignedQuantityStringSchema,
  knowledgeValueSchema,
} from './part-16.js';

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

export function isCanonicalActionTransactionId(ledger: Ledger, transactionId: string): boolean {
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
