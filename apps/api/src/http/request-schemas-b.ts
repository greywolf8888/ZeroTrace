import { z } from 'zod';
import {
  AnalysisMetadataSchema,
  DiscrepancyCheckInputSchema,
  type Evidence,
  ClaimExpectedActionSchema,
  ClaimWalletRoleSchema,
} from '@zerotrace/schemas';

export const ReviewedClaimRuleValuesRequestSchema = z
  .object({
    sourceAddress: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
    destinationAddress: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
    role: ClaimWalletRoleSchema,
    expectedAction: ClaimExpectedActionSchema,
    expectedShareBps: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
    window: z
      .object({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
      })
      .refine((window) => Date.parse(window.from) <= Date.parse(window.to), {
        message: 'Review window must not end before it begins.',
      }),
    shareUnit: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
    noExit: z.boolean().optional(),
    cadenceSeconds: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
  })
  .strict();

export const ClaimRuleReviewRequestSchema = z
  .object({
    declarationReportId: z.string().regex(/^cdr_[0-9a-f]{24}$/),
    draftId: z.string().regex(/^cld_[0-9a-f]{24}$/),
    reviewerLabel: z.string().trim().min(1).max(256),
    rule: ReviewedClaimRuleValuesRequestSchema,
    tokenDecimals: z.number().int().min(0).max(255).optional(),
    tokenDecimalsEvidenceId: z
      .string()
      .regex(/^ev_[0-9a-f]{24}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.tokenDecimals === undefined) !== (value.tokenDecimalsEvidenceId === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['tokenDecimalsEvidenceId'],
        message: 'Known token decimals and their Evidence ID must be supplied together.',
      });
    }
  });

export const Erc20DecimalsObservationRequestSchema = z
  .object({
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  })
  .strict();

export const FlapPancakeV2BuyScenarioRequestSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
    quoteInputs: z
      .array(
        z
          .string()
          .trim()
          .max(128)
          .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      )
      .min(1)
      .max(8),
    blockNumber: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
  })
  .strict();

export const FlapPancakeV2SellScenarioRequestSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
    tokenInputs: z
      .array(
        z
          .string()
          .trim()
          .max(128)
          .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      )
      .min(1)
      .max(8),
    blockNumber: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
  })
  .strict();

export const FlapPancakeV2PensionEntryRequestSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
    quoteInputs: z
      .array(
        z
          .string()
          .trim()
          .max(128)
          .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      )
      .min(1)
      .max(8),
    pensionReportId: z
      .string()
      .regex(/^pcr_[0-9a-f]{24}$/)
      .optional(),
    pensionWallet: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/)
      .optional(),
    blockNumber: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
  })
  .strict();

export const FlapPensionEntryReportQuerySchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .strict();

export const FlapPensionEntryReportParamsSchema = z
  .object({ reportId: z.string().regex(/^per_[0-9a-f]{24}$/) })
  .strict();

export const EntityRelationshipReportQuerySchema = z
  .object({
    ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']),
    chainId: z.string().trim().min(1).max(128),
    subjectA: z.string().trim().min(1).max(512),
    subjectB: z.string().trim().min(1).max(512),
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
  });

export const EntityRelationshipReportParamsSchema = z
  .object({ reportId: z.string().regex(/^erh_[0-9a-f]{24}$/) })
  .strict();

export const EntityRelationshipTimelineMaterializeSchema =
  EntityRelationshipReportQuerySchema.safeExtend({
    fromPosition: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
    toPosition: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
  }).superRefine((value, context) => {
    if (
      value.fromPosition !== undefined &&
      value.toPosition !== undefined &&
      BigInt(value.fromPosition) > BigInt(value.toPosition)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['toPosition'],
        message: 'Timeline toPosition must be greater than or equal to fromPosition.',
      });
    }
  });

export const EntityRelationshipTimelineParamsSchema = z
  .object({ timelineId: z.string().regex(/^ert_[0-9a-f]{24}$/) })
  .strict();

export const EntityInvestigationGraphMaterializeSchema = z
  .object({
    ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']),
    chainId: z.string().trim().min(1).max(128),
    timelineIds: z
      .array(z.string().regex(/^ert_[0-9a-f]{24}$/))
      .min(1)
      .max(250),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.timelineIds).size !== value.timelineIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['timelineIds'],
        message: 'Investigation graph timeline IDs must be unique.',
      });
    }
  });

export const EntityInvestigationGraphQuerySchema = z
  .object({
    ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']),
    chainId: z.string().trim().min(1).max(128),
    subjectId: z.string().trim().min(1).max(512).optional(),
    seedSubjectId: z.string().trim().min(1).max(512).optional(),
    maxDepth: z.coerce.number().int().min(0).max(3).default(2),
    maxNodes: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const EntityInvestigationGraphParamsSchema = z
  .object({ graphId: z.string().regex(/^eig_[0-9a-f]{24}$/) })
  .strict();

export const EntityInvestigationGraphTimelineMaterializeSchema = z
  .object({
    ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']),
    chainId: z.string().trim().min(1).max(128),
    graphIds: z
      .array(z.string().regex(/^eig_[0-9a-f]{24}$/))
      .min(2)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.graphIds).size !== value.graphIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['graphIds'],
        message: 'Investigation graph timeline graph IDs must be unique.',
      });
    }
  });

export const EntityInvestigationGraphTimelineQuerySchema = z
  .object({
    ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']),
    chainId: z.string().trim().min(1).max(128),
    subjectId: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const EntityInvestigationGraphTimelineParamsSchema = z
  .object({ timelineId: z.string().regex(/^eit_[0-9a-f]{24}$/) })
  .strict();

export const FlapPancakeV2ReconciliationRequestSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
    quoteInputs: z
      .array(
        z
          .string()
          .trim()
          .max(128)
          .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      )
      .min(1)
      .max(8),
    tokenInputs: z
      .array(
        z
          .string()
          .trim()
          .max(128)
          .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
      )
      .min(1)
      .max(8),
  })
  .strict();

export const DiscrepancyAuditRequestSchema = z
  .object({
    checks: z.array(DiscrepancyCheckInputSchema).max(1_000),
    metadata: AnalysisMetadataSchema,
  })
  .strict();

export const AtomicQuantitySchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const PositiveAtomicQuantitySchema = AtomicQuantitySchema.refine(
  (value) => BigInt(value) > 0n,
  {
    message: 'Quantity must be greater than zero.',
  },
);

export const PoolSchema = z
  .object({
    id: z.string().min(1),
    baseReserve: AtomicQuantitySchema,
    quoteReserve: AtomicQuantitySchema,
    virtualBaseReserve: AtomicQuantitySchema.optional(),
    virtualQuoteReserve: AtomicQuantitySchema.optional(),
    feeBps: AtomicQuantitySchema.refine((value) => BigInt(value) <= 10_000n, {
      message: 'feeBps must be at most 10000.',
    }),
    sellEnabled: z.boolean(),
    maxSellQuantity: PositiveAtomicQuantitySchema.optional(),
    evidenceIds: z.array(z.string().min(1)).min(1),
  })
  .superRefine((pool, context) => {
    if (BigInt(pool.baseReserve) + BigInt(pool.virtualBaseReserve ?? '0') === 0n) {
      context.addIssue({
        code: 'custom',
        path: ['baseReserve'],
        message: 'Effective base reserve must be greater than zero.',
      });
    }
    if (BigInt(pool.quoteReserve) + BigInt(pool.virtualQuoteReserve ?? '0') === 0n) {
      context.addIssue({
        code: 'custom',
        path: ['quoteReserve'],
        message: 'Effective quote reserve must be greater than zero.',
      });
    }
  });

export const RvRequestSchema = z.object({
  pool: PoolSchema,
  inputQuantity: PositiveAtomicQuantitySchema,
  metadata: AnalysisMetadataSchema,
});

export const ExitRaceRequestSchema = z.object({
  pool: PoolSchema,
  participants: z
    .array(z.object({ id: z.string().min(1), inputQuantity: PositiveAtomicQuantitySchema }))
    .min(1)
    .max(100),
  order: z.enum(['SEQUENTIAL', 'RANDOM']),
  seed: z.number().int().safe(),
  iterations: z.number().int().min(1).max(10_000).optional(),
  metadata: AnalysisMetadataSchema,
});
