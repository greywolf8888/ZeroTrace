import { z } from 'zod';

const IdentifierSchema = z.string().trim().min(1).max(256);
const AtomicSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const EvidenceIdSchema = z.string().regex(/^ev_[0-9a-f]{24,64}$/);
const IsoDateTimeSchema = z.iso.datetime({ offset: true });

const PositionPolicySchema = z
  .object({
    version: IdentifierSchema,
    targetPositionBps: z.number().int().min(0).max(10_000),
    maxSinglePositionBps: z.number().int().min(0).max(10_000),
    maxControllerGroupBps: z.number().int().min(0).max(10_000),
    maxNarrativeGroupBps: z.number().int().min(0).max(10_000),
    maxTotalInvestedBps: z.number().int().min(0).max(10_000),
    minimumUncommittedCashBps: z.number().int().min(0).max(10_000),
    minimumFeeReserveBps: z.number().int().min(0).max(10_000),
    opaqueTokenStressLossBps: z.literal(10_000),
  })
  .strict();

export const PaperExperimentCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(128),
    chain: z.enum(['BSC', 'SOLANA']),
    initialPrincipalAtomic: AtomicSchema.refine((value) => BigInt(value) > 0n),
    policy: PositionPolicySchema,
    createdAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export const PaperExperimentParamsSchema = z
  .object({ experimentId: z.string().regex(/^pex_[0-9a-f]{24}$/) })
  .strict();

export const PaperReviewParamsSchema = z
  .object({ reviewId: z.string().regex(/^prv_[0-9a-f]{24}$/) })
  .strict();

const CommonCommandShape = {
  commandId: IdentifierSchema,
  assetId: IdentifierSchema,
  strategyVersion: IdentifierSchema,
  candidateEpoch: IdentifierSchema,
  eventAt: IsoDateTimeSchema,
  reasons: z.array(IdentifierSchema).max(64),
  evidenceIds: z.array(EvidenceIdSchema).min(1).max(128),
};

const HardConditionSchema = z
  .object({ id: IdentifierSchema, state: z.enum(['PASS', 'FAIL', 'UNKNOWN', 'STALE']) })
  .strict();

const PaperCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ENTER_CANDIDATE'), ...CommonCommandShape }).strict(),
  z
    .object({
      type: z.literal('PREPARE_BUY'),
      ...CommonCommandShape,
      currentValues: z.record(IdentifierSchema, z.string().max(1024)),
      unmetConditions: z.array(IdentifierSchema).max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal('START_BUY'),
      ...CommonCommandShape,
      controllerGroupId: IdentifierSchema,
      narrativeGroupId: IdentifierSchema,
      requestedQuoteAtomic: AtomicSchema,
      maximumFeeAtomic: AtomicSchema,
      maximumWorstLossAtomic: AtomicSchema,
      exitCapacityQuoteAtomic: AtomicSchema,
      quoteAvailableAt: IsoDateTimeSchema,
      quoteValidUntil: IsoDateTimeSchema,
      hardConditions: z.array(HardConditionSchema).max(128),
    })
    .strict(),
  z
    .object({
      type: z.literal('RECORD_BUY_FILL'),
      ...CommonCommandShape,
      intentId: IdentifierSchema,
      fillId: IdentifierSchema,
      quoteSpentAtomic: AtomicSchema,
      feeAtomic: AtomicSchema,
      tokenReceivedAtomic: AtomicSchema,
      final: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('FAIL_BUY'),
      ...CommonCommandShape,
      intentId: IdentifierSchema,
      failureFeeAtomic: AtomicSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('PREPARE_SELL'),
      ...CommonCommandShape,
      quantityAtomic: AtomicSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('START_SELL'),
      ...CommonCommandShape,
      controllerGroupId: IdentifierSchema,
      narrativeGroupId: IdentifierSchema,
      requestedTokenAtomic: AtomicSchema,
      sellableTokenAtomic: z.discriminatedUnion('state', [
        z.object({ state: z.literal('known'), value: AtomicSchema }).strict(),
        z
          .object({ state: z.enum(['unknown', 'unavailable', 'stale']), reason: IdentifierSchema })
          .strict(),
      ]),
      maximumFeeAtomic: AtomicSchema,
      quoteAvailableAt: IsoDateTimeSchema,
      quoteValidUntil: IsoDateTimeSchema,
      urgent: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('RECORD_SELL_FILL'),
      ...CommonCommandShape,
      intentId: IdentifierSchema,
      fillId: IdentifierSchema,
      tokenSoldAtomic: AtomicSchema,
      quoteReceivedAtomic: AtomicSchema,
      feeAtomic: AtomicSchema,
      final: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('FAIL_SELL'),
      ...CommonCommandShape,
      intentId: IdentifierSchema,
      failureFeeAtomic: AtomicSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('INVALIDATE_SIGNAL'),
      ...CommonCommandShape,
      intentId: IdentifierSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal('DATA_DEGRADED'), ...CommonCommandShape }).strict(),
]);

export const PaperCommandRequestSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative().optional(),
    command: PaperCommandSchema,
  })
  .strict();

export const PaperOutboxQuerySchema = z
  .object({
    after: z
      .string()
      .regex(/^pob_[0-9a-f]{24}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

const AtomicObservationSchema = z.discriminatedUnion('state', [
  z
    .object({
      state: z.literal('known'),
      valueAtomic: AtomicSchema,
      sourceId: IdentifierSchema,
      observedAt: IsoDateTimeSchema,
      availableAt: IsoDateTimeSchema,
    })
    .strict(),
  z
    .object({
      state: z.enum(['unknown', 'unavailable', 'stale']),
      reason: IdentifierSchema,
      sourceId: IdentifierSchema.optional(),
      observedAt: IsoDateTimeSchema.optional(),
      availableAt: IsoDateTimeSchema.optional(),
    })
    .strict(),
]);

const RejectedCandidateReviewSchema = z
  .object({
    candidateId: IdentifierSchema,
    assetId: IdentifierSchema,
    chain: z.enum(['BSC', 'SOLANA']),
    strategyVersion: IdentifierSchema,
    decisionAt: IsoDateTimeSchema,
    evaluatedAt: IsoDateTimeSchema,
    rejectionReasons: z.array(IdentifierSchema).min(1).max(128),
    evidenceIds: z.array(EvidenceIdSchema).min(1).max(128),
    entryCost: AtomicObservationSchema,
    laterExitProceeds: AtomicObservationSchema,
    estimatedCosts: AtomicObservationSchema,
    exitCapacity: AtomicObservationSchema,
  })
  .strict();

export const PaperReviewCreateSchema = z
  .object({
    asOf: IsoDateTimeSchema,
    rejectedCandidates: z.array(RejectedCandidateReviewSchema).max(10_000),
  })
  .strict();
