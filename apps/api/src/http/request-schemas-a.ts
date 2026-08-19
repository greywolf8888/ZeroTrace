import { z } from 'zod';
import {
  FLAP_HISTORY_DEFAULT_CHUNK_SIZE,
  FLAP_HISTORY_MAX_CHUNKS,
  FLAP_HISTORY_MAX_RANGE_BLOCKS,
  FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_CHUNKS,
} from '@zerotrace/platform-adapters';

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(512),
  ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']).optional(),
  chainId: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const LabelIntelligenceIdentityQuerySchema = z
  .object({
    ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']),
    chainId: z.string().trim().min(1).max(128),
    subjectType: z.enum([
      'ADDRESS',
      'ACCOUNT',
      'WALLET',
      'CONTRACT',
      'PROGRAM',
      'TRANSACTION',
      'BLOCK',
      'OUTPOINT',
      'TOKEN',
      'POOL',
      'CLUSTER',
      'ENTITY',
      'UNKNOWN',
    ]),
    normalizedIdentifier: z.string().trim().min(1).max(512),
  })
  .strict();

export const LabelIntelligenceReportParamsSchema = z.object({
  reportId: z.string().regex(/^lir_[0-9a-f]{24}$/),
});

export const LedgerRecordParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(['EVM', 'BITCOIN', 'SOLANA'])),
  type: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(['TRANSACTION', 'BLOCK', 'OUTPOINT'])),
  id: z.string().trim().min(1).max(512),
});

export const LedgerRecordQuerySchema = z.object({
  chainId: z.string().trim().min(1).max(128).optional(),
});

export const SolanaTransactionReportParamsSchema = z.object({
  signature: z
    .string()
    .trim()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
});

export const SolanaTransactionReportByIdParamsSchema = SolanaTransactionReportParamsSchema.extend({
  reportId: z.string().regex(/^str_[0-9a-f]{24}$/),
});

export const SolanaDealerCampaignReportParamsSchema = z.object({
  reportId: z.string().regex(/^sdc_[0-9a-f]{24}$/),
});

export const SolanaDealerCampaignMintParamsSchema = z.object({
  mint: z
    .string()
    .trim()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
});

export const BitcoinForensicGraphReportParamsSchema = z.object({
  reportId: z.string().regex(/^bfg_[0-9a-f]{24}$/),
});

export const BitcoinForensicGraphRootParamsSchema = z.object({
  txid: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/),
});

export const BitcoinForensicGraphRequestSchema = z
  .object({
    transactionIds: z
      .array(
        z
          .string()
          .trim()
          .regex(/^[0-9a-fA-F]{64}$/),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const normalized = value.transactionIds.map((txid) => txid.toLowerCase());
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: 'custom',
        path: ['transactionIds'],
        message: 'Bitcoin forensic graph transaction IDs must be unique.',
      });
    }
  });

export const ActionSemanticsReportLookupQuerySchema = z
  .object({
    ledger: z
      .string()
      .transform((value) => value.toUpperCase())
      .pipe(z.enum(['EVM', 'BITCOIN', 'SOLANA'])),
    chainId: z.string().trim().min(1).max(128),
    transactionId: z.string().trim().min(1).max(512),
  })
  .strict();

export const ActionSemanticsReportParamsSchema = z.object({
  reportId: z.string().regex(/^asr_[0-9a-f]{24}$/),
});

export const ClaimDeclarationReportParamsSchema = z.object({
  reportId: z.string().regex(/^cdr_[0-9a-f]{24}$/),
});

export const ClaimDeclarationReportLookupQuerySchema = z
  .object({
    assetId: z
      .string()
      .trim()
      .regex(/^eip155:[1-9]\d*:erc20:0x[0-9a-fA-F]{40}$/),
    documentHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();

export const ClaimRuleReviewReportParamsSchema = z.object({
  reportId: z.string().regex(/^crr_[0-9a-f]{24}$/),
});

export const ClaimRuleReviewReportLookupQuerySchema = z
  .object({
    assetId: z
      .string()
      .trim()
      .regex(/^eip155:[1-9]\d*:erc20:0x[0-9a-fA-F]{40}$/),
    declarationReportId: z
      .string()
      .regex(/^cdr_[0-9a-f]{24}$/)
      .optional(),
    draftId: z
      .string()
      .regex(/^cld_[0-9a-f]{24}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.declarationReportId === undefined) !== (value.draftId === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['draftId'],
        message: 'declarationReportId and draftId must be supplied together.',
      });
    }
  });

export const ClaimVerificationReportParamsSchema = z.object({
  reportId: z.string().regex(/^cvr_[0-9a-f]{24}$/),
});

export const ClaimVerificationReportLookupQuerySchema = z
  .object({
    ruleId: z
      .string()
      .regex(/^clr_[0-9a-f]{24}$/)
      .optional(),
    assetId: z
      .string()
      .trim()
      .regex(/^eip155:[1-9]\d*:erc20:0x[0-9a-fA-F]{40}$/)
      .optional(),
  })
  .strict()
  .refine((value) => value.ruleId !== undefined || value.assetId !== undefined, {
    message: 'ruleId or assetId is required.',
  });

export const LaunchInspectionParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  token: z.string().trim().min(1).max(128),
});

export const LaunchInspectionQuerySchema = z.object({
  chainId: z.literal('eip155:56'),
  platform: z.literal('flap').optional(),
  blockNumber: z
    .string()
    .regex(/^(?:0|[1-9]\d*)$/)
    .optional(),
});

export const ClaimReportParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  token: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/),
  address: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/),
});

export const ClaimReportByIdParamsSchema = ClaimReportParamsSchema.extend({
  reportId: z.string().regex(/^ecr_[0-9a-f]{24}$/),
});

export const ClaimReportQuerySchema = z.object({
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
});

export const EvmControlSurfaceParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  subject: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/),
});

export const ControlCampaignTokenParamsSchema = z.object({
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export const ControlCampaignBackfillAliasParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

export const UnsignedBlockRequestSchema = z
  .union([
    z.string().regex(/^(?:0|[1-9]\d*)$/),
    z.number().int().nonnegative().refine(Number.isSafeInteger, 'Block number is too large.'),
  ])
  .transform((value) => String(value));

export const ControlCampaignBackfillRequestSchema = z
  .object({
    fromBlock: UnsignedBlockRequestSchema,
    toBlock: UnsignedBlockRequestSchema,
  })
  .strict();

export const ControlCampaignMonitorRequestSchema = z
  .object({
    initialFromBlock: UnsignedBlockRequestSchema,
    windowBlocks: z
      .number()
      .int()
      .refine(Number.isSafeInteger, 'windowBlocks is too large.')
      .min(1)
      .max(1_000_000)
      .optional(),
    everySeconds: z.number().int().min(30).max(86_400).optional(),
  })
  .strict();

export const ControlCampaignParamsSchema = z.object({
  campaignId: z.string().regex(/^cc_[0-9a-f]{24}$/),
});

export const ControlCampaignMonitorParamsSchema = z.object({
  monitorId: z.string().regex(/^cps_[0-9a-f]{24}$/),
});

export const ForensicCaseParamsSchema = z.object({
  caseId: z.string().regex(/^fcb_cc_[0-9a-f]{24}$/),
});

export const ForensicCaseCreateSchema = z
  .object({
    campaignId: z.string().regex(/^cc_[0-9a-f]{24}$/),
  })
  .strict();

export const FundingSettlementReportParamsSchema = z.object({
  reportId: z.string().regex(/^fsr_[0-9a-f]{24}$/),
});

export const FundingSettlementRangeQuerySchema = z
  .object({
    fromBlock: z.string().regex(/^(?:0|[1-9]\d*)$/),
    toBlock: z.string().regex(/^(?:0|[1-9]\d*)$/),
  })
  .strict()
  .superRefine((value, context) => {
    if (BigInt(value.toBlock) < BigInt(value.fromBlock)) {
      context.addIssue({
        code: 'custom',
        path: ['toBlock'],
        message: 'Funding Settlement range must not end before it begins.',
      });
    }
  });

export const ControlCampaignEvidenceItemParamsSchema = z.object({
  itemId: z.string().regex(/^cei_[0-9a-f]{24}$/),
});

export const ControlCampaignEventParamsSchema = z.object({
  eventId: z.string().regex(/^be_[0-9a-f]{24}$/),
});

export const ControlCampaignListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const ControlCampaignGraphQuerySchema = z.object({
  layer: z.enum(['control', 'funding', 'token', 'settlement']).default('control'),
});
export const SolanaControlSurfaceParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('SOLANA')),
  subject: z
    .string()
    .trim()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
});
export const ControlSurfaceParamsSchema = z.union([
  EvmControlSurfaceParamsSchema,
  SolanaControlSurfaceParamsSchema,
]);

export const ControlSurfaceByIdParamsSchema = z.union([
  EvmControlSurfaceParamsSchema.extend({ reportId: z.string().regex(/^ecs_[0-9a-f]{24}$/) }),
  SolanaControlSurfaceParamsSchema.extend({ reportId: z.string().regex(/^scs_[0-9a-f]{24}$/) }),
]);

export const ControlSurfaceQuerySchema = z.object({
  chainId: z.union([z.string().regex(/^eip155:[1-9]\d*$/), z.literal('solana-mainnet')]),
});

export const ControlSurfaceInspectSchema = ControlSurfaceQuerySchema.extend({
  blockNumber: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .optional(),
});

export const ControlSurfaceListQuerySchema = z.union([
  ControlSurfaceQuerySchema.extend({
    ledger: z
      .string()
      .transform((value) => value.toUpperCase())
      .pipe(z.literal('EVM')),
    subject: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
  }),
  z.object({
    ledger: z
      .string()
      .transform((value) => value.toUpperCase())
      .pipe(z.literal('SOLANA')),
    chainId: z.literal('solana-mainnet'),
    subject: z
      .string()
      .trim()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  }),
]);

export const ClaimBurnParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  token: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/),
});

export const ClaimBurnRequestSchema = z.object({
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  blockNumber: z.string().regex(/^[1-9]\d*$/),
  maxTransfers: z.number().int().min(1).max(25_000).optional(),
});

export const ClaimBurnPromotionParamsSchema = ClaimBurnParamsSchema.extend({
  scanId: z.uuid(),
});

export const ClaimSupplyContinuityParamsSchema = ClaimBurnParamsSchema.extend({
  scanId: z.uuid(),
});

export const ClaimBurnDiscoveryRequestSchema = z
  .object({
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    fromBlock: z.string().regex(/^(0|[1-9]\d*)$/),
    toBlock: z.string().regex(/^[1-9]\d*$/),
    maxBlocksPerRequest: z.number().int().min(1).max(1_000_000).optional(),
    maxTransfers: z.number().int().min(1).max(100_000).optional(),
    maxCandidates: z.number().int().min(1).max(10_000).optional(),
  })
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    if (toBlock < fromBlock) {
      context.addIssue({
        code: 'custom',
        path: ['toBlock'],
        message: 'Burn candidate range must be ordered.',
      });
    } else if (toBlock - fromBlock + 1n > 5_000_000n) {
      context.addIssue({
        code: 'custom',
        path: ['toBlock'],
        message: 'Burn candidate range may contain at most 5000000 blocks.',
      });
    }
  });

export const PensionCandidateReportByIdParamsSchema = ClaimBurnParamsSchema.extend({
  reportId: z.string().regex(/^pcr_[0-9a-f]{24}$/),
});

export const PensionCandidateDiscoveryRequestSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    fromBlock: z.string().regex(/^(0|[1-9]\d*)$/),
    toBlock: z.string().regex(/^[1-9]\d*$/),
    shareUnitAtomic: z
      .string()
      .regex(/^[1-9]\d*$/)
      .max(96),
    minimumExactUnitDeposits: z.number().int().min(1).max(100_000),
    minimumUniqueExactUnitDepositors: z.number().int().min(1).max(100_000),
    maximumCandidates: z.number().int().min(1).max(1_000),
    maxBlocksPerRequest: z.number().int().min(1).max(1_000_000).optional(),
    maxRequests: z.number().int().min(1).max(10_000).optional(),
    maxTransfers: z.number().int().min(1).max(1_000_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const fromBlock = BigInt(value.fromBlock);
    const toBlock = BigInt(value.toBlock);
    if (toBlock < fromBlock) {
      context.addIssue({
        code: 'custom',
        path: ['toBlock'],
        message: 'Pension candidate range must be ordered.',
      });
    } else if (toBlock - fromBlock + 1n > 5_000_000n) {
      context.addIssue({
        code: 'custom',
        path: ['toBlock'],
        message: 'Pension candidate range may contain at most 5000000 blocks.',
      });
    }
  });

export const FlapEventTransactionParamsSchema = LaunchInspectionParamsSchema.extend({
  transactionHash: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{64}$/),
});

export const FlapEventTransactionQuerySchema = z.object({
  chainId: z.literal('eip155:56'),
  platform: z.literal('flap').optional(),
});

export const FlapEventHistoryQuerySchema = FlapEventTransactionQuerySchema.extend({
  fromBlock: z
    .string()
    .max(32)
    .regex(/^(?:0|[1-9]\d*)$/),
  toBlock: z
    .string()
    .max(32)
    .regex(/^(?:0|[1-9]\d*)$/),
  chunkSize: z.coerce.number().int().min(1).max(10_000).optional(),
}).superRefine((query, context) => {
  const fromBlock = BigInt(query.fromBlock);
  const toBlock = BigInt(query.toBlock);
  if (toBlock < fromBlock) {
    context.addIssue({ code: 'custom', path: ['toBlock'], message: 'toBlock precedes fromBlock.' });
  } else if (toBlock - fromBlock + 1n > BigInt(FLAP_HISTORY_MAX_RANGE_BLOCKS)) {
    context.addIssue({
      code: 'custom',
      path: ['toBlock'],
      message: `History range exceeds ${FLAP_HISTORY_MAX_RANGE_BLOCKS} blocks.`,
    });
  } else {
    const chunkSize = BigInt(query.chunkSize ?? FLAP_HISTORY_DEFAULT_CHUNK_SIZE);
    const chunkCount = (toBlock - fromBlock + chunkSize) / chunkSize;
    if (chunkCount > BigInt(FLAP_HISTORY_MAX_CHUNKS)) {
      context.addIssue({
        code: 'custom',
        path: ['chunkSize'],
        message: `History query exceeds ${FLAP_HISTORY_MAX_CHUNKS} chunks.`,
      });
    }
  }
});

export const FlapHistoryProjectionParamsSchema = LaunchInspectionParamsSchema.extend({
  scanId: z.string().uuid(),
});

export const FlapHistoryProjectionPageQuerySchema = FlapEventTransactionQuerySchema.extend({
  afterBlock: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const FlapTokenOriginQuerySchema = FlapEventTransactionQuerySchema.extend({
  fromBlock: z
    .string()
    .max(32)
    .regex(/^(?:0|[1-9]\d*)$/),
  toBlock: z
    .string()
    .max(32)
    .regex(/^(?:0|[1-9]\d*)$/),
  chunkSize: z.coerce.number().int().min(1).max(FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE).optional(),
}).superRefine((query, context) => {
  const fromBlock = BigInt(query.fromBlock);
  const toBlock = BigInt(query.toBlock);
  if (toBlock < fromBlock) {
    context.addIssue({ code: 'custom', path: ['toBlock'], message: 'toBlock precedes fromBlock.' });
  } else if (toBlock - fromBlock + 1n > BigInt(FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE)) {
    context.addIssue({
      code: 'custom',
      path: ['toBlock'],
      message: `Synchronous origin range exceeds ${FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE} blocks.`,
    });
  } else {
    const selectedChunkSize = BigInt(query.chunkSize ?? FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE);
    const chunkCount = (toBlock - fromBlock + selectedChunkSize) / selectedChunkSize;
    if (chunkCount > BigInt(FLAP_TOKEN_ORIGIN_MAX_CHUNKS)) {
      context.addIssue({
        code: 'custom',
        path: ['chunkSize'],
        message: `Origin query exceeds ${FLAP_TOKEN_ORIGIN_MAX_CHUNKS} chunks.`,
      });
    }
  }
});

export const FlapSellQuoteRequestSchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z.string().trim().min(1).max(128),
    inputQuantity: z.string().regex(/^(?:0|[1-9]\d*)$/),
    blockNumber: z
      .string()
      .regex(/^(?:0|[1-9]\d*)$/)
      .optional(),
  })
  .strict();

export const ClaimDeclarationParseRequestSchema = z
  .object({
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
    assetId: z
      .string()
      .trim()
      .regex(/^eip155:[1-9]\d*:erc20:0x[0-9a-fA-F]{40}$/),
    text: z.string().trim().min(1).max(100_000),
    sourceUri: z
      .url()
      .max(2_048)
      .refine((value) => /^https?:\/\//i.test(value), {
        message: 'Claim declaration sourceUri must use HTTP(S).',
      })
      .optional(),
    auditWindow: z
      .object({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
      })
      .refine((window) => Date.parse(window.from) <= Date.parse(window.to), {
        message: 'Audit window must not end before it begins.',
      })
      .optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.assetId.startsWith(`${input.chainId}:`)) {
      context.addIssue({
        code: 'custom',
        path: ['assetId'],
        message: 'Claim declaration assetId must belong to the requested EVM chain.',
      });
    }
  });
