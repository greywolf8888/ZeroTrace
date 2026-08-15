import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { Counter, Registry, collectDefaultMetrics } from 'prom-client';
import { z, ZodError } from 'zod';

import { ProviderError } from '@zerotrace/chain-adapters';
import {
  BitcoinForensicGraphCaptureError,
  captureBitcoinForensicGraph,
} from './bitcoin-forensic-graph.js';
import { SolanaDealerCaptureError, captureSolanaDealerCampaign } from './solana-dealer.js';
import { defineCaptureSchedule } from '@zerotrace/capture-scheduler';
import { parseEvmClaimDeclaration, reviewClaimDeclarationDraft } from '@zerotrace/claim-audit';
import {
  auditDiscrepancies,
  DISCREPANCY_MODEL_VERSION,
  resolveSourceOperators,
} from '@zerotrace/data-quality';
import {
  canonicalizeEntityRelationshipInput,
  ENTITY_RELATIONSHIP_MODEL_VERSION,
  ENTITY_RELATIONSHIP_TIMELINE_MODEL_VERSION,
  ENTITY_INVESTIGATION_GRAPH_MODEL_VERSION,
  ENTITY_INVESTIGATION_GRAPH_TIMELINE_MODEL_VERSION,
  buildEntityInvestigationGraph,
  buildEntityInvestigationGraphTimeline,
  buildEntityRelationshipTimeline,
  resolveEntityRelationship,
  traverseEntityInvestigationGraph,
} from '@zerotrace/entity-engine';
import { createEvidence, hashPayload } from '@zerotrace/evidence';
import type { EvidenceNode } from '@zerotrace/evidence';
import {
  ForensicCaseBundleError,
  buildForensicCaseBundle,
  caseIdForCampaign,
} from '@zerotrace/forensic-evidence';
import { classifyIdentifier } from '@zerotrace/identifiers';
import {
  buildLabelIntelligenceCore,
  LABEL_INTELLIGENCE_MODEL_VERSION,
} from '@zerotrace/label-engine';
import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  FLAP_EVENT_MODEL_VERSION,
  FLAP_HISTORY_DEFAULT_CHUNK_SIZE,
  FLAP_HISTORY_MAX_CHUNKS,
  FLAP_HISTORY_MAX_RANGE_BLOCKS,
  FLAP_HISTORY_MODEL_VERSION,
  FLAP_LIFETIME_MATERIALIZATION_SOURCE,
  FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_CHUNK_SIZE,
  FLAP_TOKEN_ORIGIN_MAX_CHUNKS,
  FLAP_TOKEN_ORIGIN_MODEL_VERSION,
  LAUNCHPAD_PROTOCOL_REGISTRY,
  PLATFORM_REGISTRY,
  discoverErc20BurnCandidates,
  discoverEvmPensionCandidates,
  discoverFlapEventHistory,
  inspectFlapEventTransaction,
  observeEvmClaimBurnBlock,
  observeErc20Decimals,
  inspectFlapTokenOrigin,
  inspectFlapTokenOriginRestartSafe,
  inspectFlapToken,
  inspectEvmControlSurface,
  inspectSolanaControlSurface,
  quoteFlapPancakeV2BuyScenarios,
  quoteFlapPancakeV2SellScenarios,
  quoteFlapPensionEntryScenarios,
  reconcileFlapPancakeV2Market,
  quoteFlapSell,
  replayErc20BurnPromotionResult,
  replayErc20SupplyContinuityResult,
  type InspectFlapTokenOriginOptions,
} from '@zerotrace/platform-adapters';
import { quoteConstantProductExit, simulateExitRace } from '@zerotrace/rv';
import {
  ActionSemanticsReportStorageError,
  ClaimDeclarationReportStorageError,
  ClaimRuleReviewReportStorageError,
  ClaimReportStorageError,
  ClaimVerificationReportStorageError,
  ControlCampaignReportStorageError,
  ControlSurfaceReportStorageError,
  EntityRelationshipReportStorageError,
  EntityRelationshipTimelineStorageError,
  EntityInvestigationGraphStorageError,
  EntityInvestigationGraphTimelineStorageError,
  AgeInvestigationGraphProjectionError,
  FlapHistoryProjectionError,
  FlapLifetimeHeadError,
  FlapPensionEntryReportStorageError,
  FundingSettlementReportStorageError,
  CaptureScheduleStorageError,
  ForensicCampaignAlertStorageError,
  IntelligenceSearchStorageError,
  LabelIntelligenceStorageError,
  PensionCandidateReportStorageError,
  SemanticCheckpointError,
  SolanaTransactionReportStorageError,
  SolanaDealerCampaignReportStorageError,
  BitcoinForensicGraphReportStorageError,
  StorageError,
  type ObjectStoreHealth,
  type RawFactStorageHealth,
  type StorageHealth,
  type StoredSolanaTransactionReport,
  type StoredControlCampaignReport,
  type AgeInvestigationGraphProjectionResult,
} from '@zerotrace/storage';
import {
  AnalysisMetadataSchema,
  DiscrepancyCheckInputSchema,
  EntityRelationshipInputSchema,
  EntityRelationshipReportSchema,
  EntityRelationshipTimelineReportSchema,
  EntityInvestigationGraphReportSchema,
  EntityInvestigationGraphTimelineReportSchema,
  FlapEventHistoryProjectionSchema,
  FlapLifetimeMaterializationSchema,
  LabelIntelligenceReportSchema,
  LabelIntelligenceRequestSchema,
  SolanaTransactionIntelligenceReportSchema,
  SolanaDealerCampaignRequestSchema,
  knownValue,
  unavailableValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type Evidence,
  type ControlCampaignBundle,
  TokenHistoryBackfillParametersSchema,
  TokenLiveCaptureParametersSchema,
  type ForensicCampaignAlert,
  type KnowledgeValue,
  type Ledger,
  ClaimExpectedActionSchema,
  ClaimWalletRoleSchema,
} from '@zerotrace/schemas';

import type { AppConfig } from './config.js';
import {
  queryBitcoinBlock,
  queryBitcoinAddress,
  queryBitcoinOutpoint,
  queryBitcoinTransaction,
  queryEvmBlock,
  queryEvmTransaction,
  querySolanaBlock,
  querySolanaTransaction,
} from './ledger-query.js';
import { createRuntime, type AppRuntime } from './runtime.js';

const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(512),
  ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']).optional(),
  chainId: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const LabelIntelligenceIdentityQuerySchema = z
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

const LabelIntelligenceReportParamsSchema = z.object({
  reportId: z.string().regex(/^lir_[0-9a-f]{24}$/),
});

const LedgerRecordParamsSchema = z.object({
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

const LedgerRecordQuerySchema = z.object({
  chainId: z.string().trim().min(1).max(128).optional(),
});

const SolanaTransactionReportParamsSchema = z.object({
  signature: z
    .string()
    .trim()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
});

const SolanaTransactionReportByIdParamsSchema = SolanaTransactionReportParamsSchema.extend({
  reportId: z.string().regex(/^str_[0-9a-f]{24}$/),
});

const SolanaDealerCampaignReportParamsSchema = z.object({
  reportId: z.string().regex(/^sdc_[0-9a-f]{24}$/),
});

const SolanaDealerCampaignMintParamsSchema = z.object({
  mint: z
    .string()
    .trim()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
});

const BitcoinForensicGraphReportParamsSchema = z.object({
  reportId: z.string().regex(/^bfg_[0-9a-f]{24}$/),
});

const BitcoinForensicGraphRootParamsSchema = z.object({
  txid: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/),
});

const BitcoinForensicGraphRequestSchema = z
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

const ActionSemanticsReportLookupQuerySchema = z
  .object({
    ledger: z
      .string()
      .transform((value) => value.toUpperCase())
      .pipe(z.enum(['EVM', 'BITCOIN', 'SOLANA'])),
    chainId: z.string().trim().min(1).max(128),
    transactionId: z.string().trim().min(1).max(512),
  })
  .strict();

const ActionSemanticsReportParamsSchema = z.object({
  reportId: z.string().regex(/^asr_[0-9a-f]{24}$/),
});

const ClaimDeclarationReportParamsSchema = z.object({
  reportId: z.string().regex(/^cdr_[0-9a-f]{24}$/),
});

const ClaimDeclarationReportLookupQuerySchema = z
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

const ClaimRuleReviewReportParamsSchema = z.object({
  reportId: z.string().regex(/^crr_[0-9a-f]{24}$/),
});

const ClaimRuleReviewReportLookupQuerySchema = z
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

const ClaimVerificationReportParamsSchema = z.object({
  reportId: z.string().regex(/^cvr_[0-9a-f]{24}$/),
});

const ClaimVerificationReportLookupQuerySchema = z
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

const LaunchInspectionParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  token: z.string().trim().min(1).max(128),
});

const LaunchInspectionQuerySchema = z.object({
  chainId: z.literal('eip155:56'),
  platform: z.literal('flap').optional(),
  blockNumber: z
    .string()
    .regex(/^(?:0|[1-9]\d*)$/)
    .optional(),
});

const ClaimReportParamsSchema = z.object({
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

const ClaimReportByIdParamsSchema = ClaimReportParamsSchema.extend({
  reportId: z.string().regex(/^ecr_[0-9a-f]{24}$/),
});

const ClaimReportQuerySchema = z.object({
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
});

const EvmControlSurfaceParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  subject: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/),
});

const ControlCampaignTokenParamsSchema = z.object({
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

const ControlCampaignBackfillAliasParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  token: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});

const UnsignedBlockRequestSchema = z
  .union([
    z.string().regex(/^(?:0|[1-9]\d*)$/),
    z.number().int().nonnegative().refine(Number.isSafeInteger, 'Block number is too large.'),
  ])
  .transform((value) => String(value));

const ControlCampaignBackfillRequestSchema = z
  .object({
    fromBlock: UnsignedBlockRequestSchema,
    toBlock: UnsignedBlockRequestSchema,
  })
  .strict();

const ControlCampaignMonitorRequestSchema = z
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

const ControlCampaignParamsSchema = z.object({
  campaignId: z.string().regex(/^cc_[0-9a-f]{24}$/),
});

const ControlCampaignMonitorParamsSchema = z.object({
  monitorId: z.string().regex(/^cps_[0-9a-f]{24}$/),
});

const ForensicCaseParamsSchema = z.object({
  caseId: z.string().regex(/^fcb_cc_[0-9a-f]{24}$/),
});

const ForensicCaseCreateSchema = z
  .object({
    campaignId: z.string().regex(/^cc_[0-9a-f]{24}$/),
  })
  .strict();

const FundingSettlementReportParamsSchema = z.object({
  reportId: z.string().regex(/^fsr_[0-9a-f]{24}$/),
});

const FundingSettlementRangeQuerySchema = z
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

const ControlCampaignEvidenceItemParamsSchema = z.object({
  itemId: z.string().regex(/^cei_[0-9a-f]{24}$/),
});

const ControlCampaignEventParamsSchema = z.object({
  eventId: z.string().regex(/^be_[0-9a-f]{24}$/),
});

const ControlCampaignListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ControlCampaignGraphQuerySchema = z.object({
  layer: z.enum(['control', 'funding', 'token', 'settlement']).default('control'),
});
const SolanaControlSurfaceParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('SOLANA')),
  subject: z
    .string()
    .trim()
    .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
});
const ControlSurfaceParamsSchema = z.union([
  EvmControlSurfaceParamsSchema,
  SolanaControlSurfaceParamsSchema,
]);

const ControlSurfaceByIdParamsSchema = z.union([
  EvmControlSurfaceParamsSchema.extend({ reportId: z.string().regex(/^ecs_[0-9a-f]{24}$/) }),
  SolanaControlSurfaceParamsSchema.extend({ reportId: z.string().regex(/^scs_[0-9a-f]{24}$/) }),
]);

const ControlSurfaceQuerySchema = z.object({
  chainId: z.union([z.string().regex(/^eip155:[1-9]\d*$/), z.literal('solana-mainnet')]),
});

const ControlSurfaceInspectSchema = ControlSurfaceQuerySchema.extend({
  blockNumber: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .optional(),
});

const ControlSurfaceListQuerySchema = z.union([
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

const ClaimBurnParamsSchema = z.object({
  ledger: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('EVM')),
  token: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{40}$/),
});

const ClaimBurnRequestSchema = z.object({
  chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  blockNumber: z.string().regex(/^[1-9]\d*$/),
  maxTransfers: z.number().int().min(1).max(25_000).optional(),
});

const ClaimBurnPromotionParamsSchema = ClaimBurnParamsSchema.extend({
  scanId: z.uuid(),
});

const ClaimSupplyContinuityParamsSchema = ClaimBurnParamsSchema.extend({
  scanId: z.uuid(),
});

const ClaimBurnDiscoveryRequestSchema = z
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

const PensionCandidateReportByIdParamsSchema = ClaimBurnParamsSchema.extend({
  reportId: z.string().regex(/^pcr_[0-9a-f]{24}$/),
});

const PensionCandidateDiscoveryRequestSchema = z
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

const FlapEventTransactionParamsSchema = LaunchInspectionParamsSchema.extend({
  transactionHash: z
    .string()
    .trim()
    .regex(/^0x[0-9a-fA-F]{64}$/),
});

const FlapEventTransactionQuerySchema = z.object({
  chainId: z.literal('eip155:56'),
  platform: z.literal('flap').optional(),
});

const FlapEventHistoryQuerySchema = FlapEventTransactionQuerySchema.extend({
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

const FlapHistoryProjectionParamsSchema = LaunchInspectionParamsSchema.extend({
  scanId: z.string().uuid(),
});

const FlapHistoryProjectionPageQuerySchema = FlapEventTransactionQuerySchema.extend({
  afterBlock: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const FlapTokenOriginQuerySchema = FlapEventTransactionQuerySchema.extend({
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

const FlapSellQuoteRequestSchema = z
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

const ClaimDeclarationParseRequestSchema = z
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

const ReviewedClaimRuleValuesRequestSchema = z
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

const ClaimRuleReviewRequestSchema = z
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

const Erc20DecimalsObservationRequestSchema = z
  .object({
    chainId: z.string().regex(/^eip155:[1-9]\d*$/),
  })
  .strict();

const FlapPancakeV2BuyScenarioRequestSchema = z
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

const FlapPancakeV2SellScenarioRequestSchema = z
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

const FlapPancakeV2PensionEntryRequestSchema = z
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

const FlapPensionEntryReportQuerySchema = z
  .object({
    chainId: z.literal('eip155:56'),
    platform: z.literal('flap').optional(),
    token: z
      .string()
      .trim()
      .regex(/^0x[0-9a-fA-F]{40}$/),
  })
  .strict();

const FlapPensionEntryReportParamsSchema = z
  .object({ reportId: z.string().regex(/^per_[0-9a-f]{24}$/) })
  .strict();

const EntityRelationshipReportQuerySchema = z
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

const EntityRelationshipReportParamsSchema = z
  .object({ reportId: z.string().regex(/^erh_[0-9a-f]{24}$/) })
  .strict();

const EntityRelationshipTimelineMaterializeSchema = EntityRelationshipReportQuerySchema.safeExtend({
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

const EntityRelationshipTimelineParamsSchema = z
  .object({ timelineId: z.string().regex(/^ert_[0-9a-f]{24}$/) })
  .strict();

const EntityInvestigationGraphMaterializeSchema = z
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

const EntityInvestigationGraphQuerySchema = z
  .object({
    ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']),
    chainId: z.string().trim().min(1).max(128),
    subjectId: z.string().trim().min(1).max(512).optional(),
    seedSubjectId: z.string().trim().min(1).max(512).optional(),
    maxDepth: z.coerce.number().int().min(0).max(3).default(2),
    maxNodes: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

const EntityInvestigationGraphParamsSchema = z
  .object({ graphId: z.string().regex(/^eig_[0-9a-f]{24}$/) })
  .strict();

const EntityInvestigationGraphTimelineMaterializeSchema = z
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

const EntityInvestigationGraphTimelineQuerySchema = z
  .object({
    ledger: z.enum(['EVM', 'BITCOIN', 'SOLANA']),
    chainId: z.string().trim().min(1).max(128),
    subjectId: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

const EntityInvestigationGraphTimelineParamsSchema = z
  .object({ timelineId: z.string().regex(/^eit_[0-9a-f]{24}$/) })
  .strict();

const FlapPancakeV2ReconciliationRequestSchema = z
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

const DiscrepancyAuditRequestSchema = z
  .object({
    checks: z.array(DiscrepancyCheckInputSchema).max(1_000),
    metadata: AnalysisMetadataSchema,
  })
  .strict();

const AtomicQuantitySchema = z.string().regex(/^(0|[1-9]\d*)$/);
const PositiveAtomicQuantitySchema = AtomicQuantitySchema.refine((value) => BigInt(value) > 0n, {
  message: 'Quantity must be greater than zero.',
});

const PoolSchema = z
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

const RvRequestSchema = z.object({
  pool: PoolSchema,
  inputQuantity: PositiveAtomicQuantitySchema,
  metadata: AnalysisMetadataSchema,
});

const ExitRaceRequestSchema = z.object({
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

function errorResponse(request: FastifyRequest, code: string, message: string, retryable: boolean) {
  return { error: { code, message, requestId: request.id, retryable } };
}

function emptyMetadata(modelVersion: string, confidence = 0): AnalysisMetadata {
  return {
    snapshot: null,
    dataCoverage: 0,
    sourceCoverage: 0,
    historyCoverage: 0,
    simulationCoverage: 0,
    freshness: null,
    sourceSet: [],
    modelVersion,
    confidence,
    evidenceIds: [],
  };
}

function solanaTransactionReportResponse(
  record: StoredSolanaTransactionReport,
  replayed: boolean,
  liveRefresh:
    ReturnType<typeof unavailableValue> | ReturnType<typeof knownValue<boolean>> = knownValue(true),
) {
  return {
    ...record.report,
    durableReport: {
      id: record.id,
      resultHash: record.resultHash,
      createdAt: record.createdAt,
      capturedAt: record.capturedAt,
      replayed,
      liveRefresh,
    },
  };
}

function controlCampaignResponse(record: StoredControlCampaignReport, replayed = false) {
  return {
    ...record.bundle,
    durableReport: {
      id: record.id,
      resultHash: record.resultHash,
      createdAt: record.createdAt,
      capturedAt: record.capturedAt,
      replayed,
      liveRefresh: replayed
        ? unknownValue('NOT_QUERIED', 'Replay is provider-free.')
        : unknownValue('NOT_QUERIED', 'No live monitor refresh was requested.'),
    },
  };
}

async function getEvidenceNode(runtime: AppRuntime, id: string) {
  return runtime.evidenceLedger.get(id) ?? runtime.evidenceRepository?.get(id);
}

function forensicCaseRootEvidenceIds(campaign: ControlCampaignBundle): string[] {
  return [
    ...campaign.campaign.metadata.evidenceIds,
    ...campaign.clusterVersion.membershipEvidenceIds,
    ...campaign.memberships.flatMap((membership) => membership.evidenceIds),
    ...campaign.positions.flatMap((position) => [
      ...position.positionEvidenceIds,
      ...position.membershipEvidenceIds,
    ]),
    ...campaign.behaviorEvents.flatMap((event) => [
      ...event.supportingEvidenceIds,
      ...event.contradictingEvidenceIds,
      ...event.featureVector.flatMap((feature) => feature.evidenceIds),
    ]),
    ...campaign.evidenceItems.flatMap((item) => [item.evidenceId, ...item.parentEvidenceIds]),
    ...campaign.evidenceLine.evidenceIds,
  ]
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .sort();
}

async function forensicCaseEvidenceClosure(
  runtime: AppRuntime,
  campaign: ControlCampaignBundle,
): Promise<EvidenceNode[]> {
  const nodes = new Map<string, EvidenceNode>();
  for (const rootId of forensicCaseRootEvidenceIds(campaign)) {
    const drilled =
      runtime.evidenceRepository === undefined
        ? runtime.evidenceLedger.drilldown(rootId)
        : await runtime.evidenceRepository.drilldown(rootId);
    for (const node of drilled) nodes.set(node.evidence.id, node);
  }
  return [...nodes.values()];
}

async function forensicCaseBundleForCampaign(
  runtime: AppRuntime,
  record: StoredControlCampaignReport,
) {
  const evidenceNodes = await forensicCaseEvidenceClosure(runtime, record.bundle);
  return buildForensicCaseBundle({
    campaign: record.bundle,
    evidenceNodes,
    gitCommit: process.env.GIT_COMMIT ?? null,
  });
}

function forensicCaseBundleError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: ForensicCaseBundleError,
) {
  return reply.code(422).send({
    status: unknownValue('INSUFFICIENT_DATA', error.message),
    metadata: emptyMetadata('forensic-case-bundle-v1'),
    forensicCode: error.code,
    error: errorResponse(request, `FORENSIC_${error.code}`, error.message, false).error,
  });
}

async function addEvidence(
  runtime: AppRuntime,
  evidence: Evidence,
  sourceEvidenceIds: readonly string[] = [],
  snapshot?: AnalysisSnapshot,
): Promise<Evidence> {
  const existing = await getEvidenceNode(runtime, evidence.id);
  if (existing !== undefined) {
    const normalizedSources = uniqueEvidenceIds(sourceEvidenceIds).sort();
    if (
      hashPayload(existing.evidence) !== hashPayload(evidence) ||
      hashPayload(existing.sourceEvidenceIds) !== hashPayload(normalizedSources)
    ) {
      throw new StorageError(
        'EVIDENCE_CONFLICT',
        'Existing Evidence conflicts with the canonical observation.',
      );
    }
    if (hashPayload(existing.snapshot ?? null) !== hashPayload(snapshot ?? null)) {
      throw new StorageError('SNAPSHOT_CONFLICT', 'Existing Evidence uses a different Snapshot.');
    }
    return existing.evidence;
  }
  const stored = await runtime.evidenceRepository?.put(evidence, sourceEvidenceIds, snapshot);
  if (sourceEvidenceIds.every((id) => runtime.evidenceLedger.get(id) !== undefined)) {
    runtime.evidenceLedger.add(evidence, sourceEvidenceIds, snapshot);
  }
  return stored?.evidence ?? evidence;
}

function uniqueEvidenceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function uniqueSourceIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function canonicalSubjectPair(subjectA: string, subjectB: string): [string, string] {
  return subjectA < subjectB ? [subjectA, subjectB] : [subjectB, subjectA];
}

function evidenceSourceId(ids: readonly string[]): string {
  return uniqueSourceIds(ids).join('|');
}

function snapshotSourceIds(snapshot: AnalysisSnapshot): string[] {
  return Object.keys(snapshot.providerVersions);
}

async function missingEvidenceIds(runtime: AppRuntime, ids: readonly string[]): Promise<string[]> {
  const unique = uniqueEvidenceIds(ids);
  const nodes = await Promise.all(unique.map((id) => getEvidenceNode(runtime, id)));
  return unique.filter((_id, index) => nodes[index] === undefined);
}

function snapshotPosition(snapshot: AnalysisSnapshot): {
  blockOrSlot: string;
  finality: string;
} {
  switch (snapshot.ledger) {
    case 'EVM':
      return { blockOrSlot: snapshot.blockNumber, finality: snapshot.finality };
    case 'BITCOIN':
      return { blockOrSlot: snapshot.height, finality: snapshot.finality };
    case 'SOLANA':
      return { blockOrSlot: snapshot.slot, finality: snapshot.commitment };
  }
}

async function incompatibleEvidenceIds(
  runtime: AppRuntime,
  ids: readonly string[],
  snapshot: AnalysisSnapshot,
): Promise<string[]> {
  const position = snapshotPosition(snapshot);
  const unique = uniqueEvidenceIds(ids);
  const nodes = await Promise.all(unique.map((id) => getEvidenceNode(runtime, id)));
  return unique.filter((_id, index) => {
    const node = nodes[index];
    if (node === undefined) return false;
    if (
      node.evidence.ledger !== snapshot.ledger ||
      node.evidence.chainId !== snapshot.chainId ||
      node.evidence.blockOrSlot !== position.blockOrSlot
    ) {
      return true;
    }
    return node.snapshot === undefined || hashPayload(node.snapshot) !== hashPayload(snapshot);
  });
}

async function addDerivedAnalysisEvidence(
  runtime: AppRuntime,
  snapshot: AnalysisSnapshot,
  sourceEvidenceIds: readonly string[],
  source: string,
  locator: string,
  payload: unknown,
  summary: string,
): Promise<Evidence> {
  const position = snapshotPosition(snapshot);
  return addEvidence(
    runtime,
    createEvidence({
      ledger: snapshot.ledger,
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source,
      locator,
      payload,
      blockOrSlot: position.blockOrSlot,
      finality: position.finality,
      summary,
      sourceEvidenceIds,
    }),
    sourceEvidenceIds,
    snapshot,
  );
}

function rejectUngroundedAnalysis(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
  evidenceIds: readonly string[] = [],
  evidenceIssue: 'MISSING' | 'SNAPSHOT_INCOMPATIBLE' = 'MISSING',
) {
  return reply.code(422).send({
    ...errorResponse(request, 'UNGROUNDED_ANALYSIS', message, false),
    evidenceIssue: { kind: evidenceIssue, evidenceIds: [...evidenceIds] },
  });
}

function bindRequestAbort(
  request: FastifyRequest,
  reply: FastifyReply,
): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const socket = request.raw.socket;
  const disconnectPoll = setInterval(() => {
    if (request.raw.aborted || socket?.destroyed || reply.raw.destroyed) abort();
  }, 250);
  disconnectPoll.unref?.();
  request.raw.once('aborted', abort);
  socket?.once('close', abort);
  reply.raw.once('close', abort);
  return {
    signal: controller.signal,
    cleanup: () => {
      request.raw.removeListener('aborted', abort);
      socket?.removeListener('close', abort);
      reply.raw.removeListener('close', abort);
      clearInterval(disconnectPoll);
    },
  };
}

function capabilityNotImplemented(
  request: FastifyRequest,
  reply: FastifyReply,
  capability: string,
) {
  return reply.code(501).send({
    capability,
    status: unknownValue(
      'NOT_IMPLEMENTED',
      'The production adapter is not implemented in this release.',
    ),
    metadata: emptyMetadata(`${capability}-v0`),
    error: errorResponse(
      request,
      'CAPABILITY_NOT_IMPLEMENTED',
      `${capability} is not implemented.`,
      false,
    ).error,
  });
}

function parseHexQuantity(value: string, field: string): string {
  if (!/^0x[0-9a-fA-F]+$/.test(value))
    throw new ProviderError('INVALID_RESPONSE', `Invalid ${field}.`);
  return BigInt(value).toString();
}

export interface CreateAppOptions {
  config: AppConfig;
  runtime?: AppRuntime;
  logger?: boolean;
}

class CorsOriginError extends Error {
  constructor() {
    super('Origin is not allowed.');
    this.name = 'CorsOriginError';
  }
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const runtime = options.runtime ?? createRuntime(options.config);
  const ownsRuntime = options.runtime === undefined;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : options.config.environment === 'development'
          ? {
              level: options.config.logLevel,
              transport: { target: 'pino-pretty', options: { colorize: true } },
            }
          : { level: options.config.logLevel },
    bodyLimit: 1_000_000,
    requestTimeout: options.config.requestTimeoutMs,
    trustProxy: false,
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (origin === undefined || options.config.corsOrigins.includes(origin)) callback(null, true);
      else callback(new CorsOriginError(), false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ZeroTrace Read-only Intelligence API',
        version: '0.1.0',
        description:
          'Evidence-first EVM, Bitcoin, and Solana intelligence. No transaction broadcasting.',
      },
      tags: [
        { name: 'system', description: 'Health, capabilities, and provider state' },
        { name: 'intelligence', description: 'Read-only intelligence queries' },
        { name: 'analysis', description: 'Deterministic evidence-backed analysis' },
      ],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const metricsRegistry = new Registry();
  collectDefaultMetrics({ register: metricsRegistry, prefix: 'zerotrace_' });
  const requests = new Counter({
    name: 'zerotrace_http_requests_total',
    help: 'ZeroTrace HTTP requests by method, route, and status.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [metricsRegistry],
  });
  app.addHook('onResponse', (request, reply, done) => {
    requests.inc({
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      status: String(reply.statusCode),
    });
    done();
  });
  if (ownsRuntime && runtime.close !== undefined) {
    app.addHook('onClose', runtime.close);
  }

  let healthCache:
    | { expiresAt: number; value: Awaited<ReturnType<AppRuntime['providerRegistry']['health']>> }
    | undefined;
  const providerHealth = async () => {
    if (healthCache !== undefined && healthCache.expiresAt > Date.now()) return healthCache.value;
    const value = await runtime.providerRegistry.health();
    healthCache = { expiresAt: Date.now() + options.config.healthCacheTtlMs, value };
    return value;
  };
  type RuntimeStorageHealth =
    | StorageHealth
    | Awaited<ReturnType<NonNullable<AppRuntime['semanticCheckpoints']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['flapHistoryProjection']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['flapLifetimeHeads']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['claimReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['claimDeclarationReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['claimRuleReviewReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['claimVerificationReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['controlSurfaces']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['solanaControlSurfaces']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['solanaTransactionReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['solanaDealerReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['bitcoinForensicGraphReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['actionSemanticsReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['pensionCandidateReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['pensionEntryReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['entityRelationshipReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['entityRelationshipTimelines']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['entityInvestigationGraphs']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['entityInvestigationGraphTimelines']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['controlCampaignReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['forensicCampaignAlerts']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['fundingSettlementReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['intelligenceSearch']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['labelIntelligenceReports']>['health']>>
    | Awaited<ReturnType<NonNullable<AppRuntime['captureSchedules']>['health']>>
    | {
        status: 'EPHEMERAL';
        backend: 'MEMORY';
        durable: false;
        checkedAt: string;
      };
  let storageCache: { expiresAt: number; value: RuntimeStorageHealth } | undefined;
  const storageHealth = async (): Promise<RuntimeStorageHealth> => {
    if (storageCache !== undefined && storageCache.expiresAt > Date.now()) {
      return storageCache.value;
    }
    let value: RuntimeStorageHealth;
    if (runtime.evidenceRepository === undefined) {
      value = {
        status: 'EPHEMERAL',
        backend: 'MEMORY',
        durable: false,
        checkedAt: new Date().toISOString(),
      };
    } else {
      const [
        evidence,
        semanticCheckpoints,
        flapHistoryProjection,
        flapLifetimeHeads,
        claimReports,
        claimDeclarationReports,
        claimRuleReviewReports,
        claimVerificationReports,
        controlSurfaces,
        solanaControlSurfaces,
        solanaTransactionReports,
        solanaDealerReports,
        bitcoinForensicGraphReports,
        actionSemanticsReports,
        pensionCandidateReports,
        pensionEntryReports,
        entityRelationshipReports,
        entityRelationshipTimelines,
        entityInvestigationGraphs,
        entityInvestigationGraphTimelines,
        controlCampaignReports,
        forensicCampaignAlerts,
        fundingSettlementReports,
        intelligenceSearch,
        labelIntelligenceReports,
        captureSchedules,
      ] = await Promise.all([
        runtime.evidenceRepository.health(),
        runtime.semanticCheckpoints?.health(),
        runtime.flapHistoryProjection?.health(),
        runtime.flapLifetimeHeads?.health(),
        runtime.claimReports?.health(),
        runtime.claimDeclarationReports?.health(),
        runtime.claimRuleReviewReports?.health(),
        runtime.claimVerificationReports?.health(),
        runtime.controlSurfaces?.health(),
        runtime.solanaControlSurfaces?.health(),
        runtime.solanaTransactionReports?.health(),
        runtime.solanaDealerReports?.health(),
        runtime.bitcoinForensicGraphReports?.health(),
        runtime.actionSemanticsReports?.health(),
        runtime.pensionCandidateReports?.health(),
        runtime.pensionEntryReports?.health(),
        runtime.entityRelationshipReports?.health(),
        runtime.entityRelationshipTimelines?.health(),
        runtime.entityInvestigationGraphs?.health(),
        runtime.entityInvestigationGraphTimelines?.health(),
        runtime.controlCampaignReports?.health(),
        runtime.forensicCampaignAlerts?.health(),
        runtime.fundingSettlementReports?.health(),
        runtime.intelligenceSearch?.health(),
        runtime.labelIntelligenceReports?.health(),
        runtime.captureSchedules?.health(),
      ]);
      value =
        [
          evidence,
          semanticCheckpoints,
          flapHistoryProjection,
          flapLifetimeHeads,
          claimReports,
          claimDeclarationReports,
          claimRuleReviewReports,
          claimVerificationReports,
          controlSurfaces,
          solanaControlSurfaces,
          solanaTransactionReports,
          solanaDealerReports,
          bitcoinForensicGraphReports,
          actionSemanticsReports,
          pensionCandidateReports,
          pensionEntryReports,
          entityRelationshipReports,
          entityRelationshipTimelines,
          entityInvestigationGraphs,
          entityInvestigationGraphTimelines,
          controlCampaignReports,
          forensicCampaignAlerts,
          fundingSettlementReports,
          intelligenceSearch,
          labelIntelligenceReports,
          captureSchedules,
        ].find((component) => component?.status === 'DOWN') ?? evidence;
    }
    storageCache = { expiresAt: Date.now() + options.config.healthCacheTtlMs, value };
    return value;
  };
  type UnconfiguredStorageHealth = {
    status: 'UNCONFIGURED';
    backend: 'CLICKHOUSE' | 'POSTGRES' | 'S3_COMPATIBLE';
    durable: true;
    checkedAt: string;
  };
  type IngestionStorageHealth = {
    status: 'UP' | 'DOWN' | 'PARTIAL' | 'UNCONFIGURED';
    configured: number;
    required: 3;
    checkedAt: string;
    rawFacts: RawFactStorageHealth | UnconfiguredStorageHealth;
    checkpoints:
      | Awaited<ReturnType<NonNullable<AppRuntime['ingestionStorage']['checkpoints']>['health']>>
      | UnconfiguredStorageHealth;
    artifacts: ObjectStoreHealth | UnconfiguredStorageHealth;
  };
  let ingestionStorageCache: { expiresAt: number; value: IngestionStorageHealth } | undefined;
  const ingestionStorageHealth = async (): Promise<IngestionStorageHealth> => {
    if (ingestionStorageCache !== undefined && ingestionStorageCache.expiresAt > Date.now()) {
      return ingestionStorageCache.value;
    }
    const checkedAt = new Date().toISOString();
    const unconfigured = (
      backend: UnconfiguredStorageHealth['backend'],
    ): UnconfiguredStorageHealth => ({
      status: 'UNCONFIGURED',
      backend,
      durable: true,
      checkedAt,
    });
    const [rawFacts, checkpoints, artifacts] = await Promise.all([
      runtime.ingestionStorage.rawFacts?.health() ?? unconfigured('CLICKHOUSE'),
      runtime.ingestionStorage.checkpoints?.health() ?? unconfigured('POSTGRES'),
      runtime.ingestionStorage.artifacts?.health() ?? unconfigured('S3_COMPATIBLE'),
    ]);
    const components = [rawFacts, checkpoints, artifacts];
    const configured = components.filter((component) => component.status !== 'UNCONFIGURED').length;
    const status =
      configured === 0
        ? 'UNCONFIGURED'
        : components.some((component) => component.status === 'DOWN')
          ? 'DOWN'
          : configured === components.length
            ? 'UP'
            : 'PARTIAL';
    const value: IngestionStorageHealth = {
      status,
      configured,
      required: 3,
      checkedAt,
      rawFacts,
      checkpoints,
      artifacts,
    };
    ingestionStorageCache = {
      expiresAt: Date.now() + options.config.healthCacheTtlMs,
      value,
    };
    return value;
  };
  type EphemeralDataQualityStorageHealth = {
    status: 'EPHEMERAL';
    backend: 'MEMORY';
    durable: false;
    checkedAt: string;
  };
  type RuntimeDataQualityHealth = {
    status: 'UP' | 'PARTIAL' | 'INSUFFICIENT_SOURCES' | 'UNCONFIGURED' | 'DEGRADED' | 'DOWN';
    durable: boolean;
    checkedAt: string;
    configuredSources: Readonly<Record<string, number>>;
    results: Awaited<ReturnType<AppRuntime['dataQuality']['inspectAll']>>;
    storage:
      | Awaited<ReturnType<NonNullable<AppRuntime['dataQualityStorage']>['health']>>
      | EphemeralDataQualityStorageHealth;
    errorCode?: string;
  };
  let dataQualityCache: { expiresAt: number; value: RuntimeDataQualityHealth } | undefined;
  const dataQualityHealth = async (): Promise<RuntimeDataQualityHealth> => {
    if (dataQualityCache !== undefined && dataQualityCache.expiresAt > Date.now()) {
      return dataQualityCache.value;
    }
    const checkedAt = new Date().toISOString();
    const configuredSources = runtime.dataQuality.configuredSources();
    const storage =
      runtime.dataQualityStorage === undefined
        ? ({
            status: 'EPHEMERAL',
            backend: 'MEMORY',
            durable: false,
            checkedAt,
          } as const)
        : await runtime.dataQualityStorage.health();
    let value: RuntimeDataQualityHealth;
    try {
      if (storage.status === 'DOWN') {
        value = {
          status: 'DOWN',
          durable: storage.durable,
          checkedAt,
          configuredSources,
          results: [],
          storage,
          ...(storage.errorCode === undefined ? {} : { errorCode: storage.errorCode }),
        };
      } else {
        const results = await runtime.dataQuality.inspectAll();
        const configuredTotal = Object.values(configuredSources).reduce(
          (total, count) => total + count,
          0,
        );
        const disagreement = results.some(
          (result) => result.status === 'DISAGREEMENT' || result.alerts.length > 0,
        );
        const agreementCount = results.filter((result) => result.status === 'AGREEMENT').length;
        const status = disagreement
          ? 'DEGRADED'
          : configuredTotal === 0
            ? 'UNCONFIGURED'
            : agreementCount === results.length
              ? 'UP'
              : agreementCount > 0
                ? 'PARTIAL'
                : 'INSUFFICIENT_SOURCES';
        value = {
          status,
          durable: runtime.dataQuality.durable,
          checkedAt,
          configuredSources,
          results,
          storage,
        };
      }
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        typeof (error as Record<string, unknown>).code === 'string' &&
        /^[A-Z0-9_:-]{1,160}$/.test((error as Record<string, unknown>).code as string)
          ? ((error as Record<string, unknown>).code as string)
          : 'DATA_QUALITY_CHECK_FAILED';
      value = {
        status: 'DOWN',
        durable: runtime.dataQuality.durable,
        checkedAt,
        configuredSources,
        results: [],
        storage,
        errorCode: code,
      };
    }
    dataQualityCache = {
      expiresAt: Date.now() + options.config.healthCacheTtlMs,
      value,
    };
    return value;
  };

  const graphProjectionHealth = async () =>
    runtime.ageInvestigationGraphProjection === undefined
      ? ({
          status: 'UNCONFIGURED' as const,
          backend: 'APACHE_AGE' as const,
          durable: true as const,
          checkedAt: new Date().toISOString(),
          graphName: 'zerotrace_investigation' as const,
        } as const)
      : runtime.ageInvestigationGraphProjection.health();

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof CorsOriginError) {
      return reply
        .code(403)
        .send(errorResponse(request, 'CORS_ORIGIN_DENIED', error.message, false));
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        ...errorResponse(request, 'INVALID_REQUEST', 'Request validation failed.', false),
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    if (error instanceof ProviderError) {
      const status =
        error.code === 'METHOD_NOT_ALLOWED' ? 400 : error.code === 'INVALID_RESPONSE' ? 502 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof SolanaDealerCaptureError) {
      const status =
        error.code === 'SOLANA_DEALER_CAPTURE_INVALID'
          ? 400
          : error.code === 'SOLANA_DEALER_CAPTURE_NO_SOURCE'
            ? 503
            : 502;
      return reply.code(status).send(errorResponse(request, error.code, error.message, false));
    }
    if (error instanceof BitcoinForensicGraphCaptureError) {
      const status =
        error.code === 'BITCOIN_FORENSIC_GRAPH_INVALID_REQUEST'
          ? 400
          : error.code === 'BITCOIN_FORENSIC_GRAPH_UNCONFIRMED'
            ? 409
            : 502;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof StorageError) {
      return reply
        .code(503)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof CaptureScheduleStorageError) {
      const status =
        error.code === 'CAPTURE_SCHEDULER_INVALID'
          ? 400
          : error.code === 'CAPTURE_SCHEDULER_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ForensicCampaignAlertStorageError) {
      const status = error.code === 'FORENSIC_ALERT_STORAGE_CONFLICT' ? 409 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FlapHistoryProjectionError) {
      const status = error.code === 'FLAP_HISTORY_PROJECTION_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FlapLifetimeHeadError) {
      const status = error.code === 'FLAP_LIFETIME_HEAD_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ClaimReportStorageError) {
      const status = error.code === 'CLAIM_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ClaimDeclarationReportStorageError) {
      const status =
        error.code === 'CLAIM_DECLARATION_REPORT_INVALID'
          ? 400
          : error.code === 'CLAIM_DECLARATION_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ClaimRuleReviewReportStorageError) {
      const status =
        error.code === 'CLAIM_RULE_REVIEW_REPORT_INVALID'
          ? 400
          : error.code === 'CLAIM_RULE_REVIEW_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ClaimVerificationReportStorageError) {
      const status =
        error.code === 'CLAIM_VERIFICATION_REPORT_INVALID'
          ? 400
          : error.code === 'CLAIM_VERIFICATION_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ControlSurfaceReportStorageError) {
      const status = error.code === 'CONTROL_SURFACE_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof SolanaTransactionReportStorageError) {
      const status = error.code === 'SOLANA_TRANSACTION_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof SolanaDealerCampaignReportStorageError) {
      const status =
        error.code === 'SOLANA_DEALER_REPORT_INVALID'
          ? 400
          : error.code === 'SOLANA_DEALER_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof BitcoinForensicGraphReportStorageError) {
      const status =
        error.code === 'BITCOIN_FORENSIC_GRAPH_INVALID'
          ? 400
          : error.code === 'BITCOIN_FORENSIC_GRAPH_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ActionSemanticsReportStorageError) {
      const status = error.code === 'ACTION_SEMANTICS_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof PensionCandidateReportStorageError) {
      const status = error.code === 'PENSION_CANDIDATE_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FlapPensionEntryReportStorageError) {
      const status = error.code === 'FLAP_PENSION_ENTRY_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof EntityRelationshipReportStorageError) {
      const status = error.code === 'ENTITY_RELATIONSHIP_REPORT_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof EntityRelationshipTimelineStorageError) {
      const status = error.code === 'ENTITY_RELATIONSHIP_TIMELINE_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof EntityInvestigationGraphStorageError) {
      const status = error.code === 'ENTITY_INVESTIGATION_GRAPH_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof EntityInvestigationGraphTimelineStorageError) {
      const status = error.code === 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof ControlCampaignReportStorageError) {
      const status =
        error.code === 'CONTROL_CAMPAIGN_REPORT_INVALID'
          ? 400
          : error.code === 'CONTROL_CAMPAIGN_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof FundingSettlementReportStorageError) {
      const status =
        error.code === 'FUNDING_SETTLEMENT_REPORT_INVALID'
          ? 400
          : error.code === 'FUNDING_SETTLEMENT_REPORT_CONFLICT'
            ? 409
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof LabelIntelligenceStorageError) {
      const status = error.code === 'LABEL_INTELLIGENCE_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof AgeInvestigationGraphProjectionError) {
      const status = error.code === 'AGE_PROJECTION_INVALID' ? 400 : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    if (error instanceof SemanticCheckpointError) {
      const status =
        error.code === 'SEMANTIC_CHECKPOINT_INVALID'
          ? 400
          : error.code === 'SEMANTIC_CHECKPOINT_NOT_FOUND'
            ? 404
            : 503;
      return reply
        .code(status)
        .send(errorResponse(request, error.code, error.message, error.retryable));
    }
    const internalError = error instanceof Error ? error : new Error('Unknown thrown value');
    request.log.error(
      { message: internalError.message, name: internalError.name },
      'request failed',
    );
    return reply
      .code(500)
      .send(errorResponse(request, 'INTERNAL_ERROR', 'Internal server error.', false));
  });

  app.get('/health/live', { schema: { tags: ['system'] } }, async () => ({
    status: 'UP',
    service: 'zerotrace-api',
    version: '0.1.0',
    readOnly: true,
    checkedAt: new Date().toISOString(),
  }));

  app.get('/health/ready', { schema: { tags: ['system'] } }, async (_request, reply) => {
    const [providers, storage, graphProjection] = await Promise.all([
      providerHealth(),
      storageHealth(),
      graphProjectionHealth(),
    ]);
    const serviceReady = storage.status !== 'DOWN';
    const status =
      providers.some((provider) => provider.status === 'UP') && serviceReady ? 'UP' : 'DEGRADED';
    return reply.code(serviceReady ? 200 : 503).send({
      status,
      service: 'zerotrace-api',
      readOnly: true,
      providers,
      storage,
      graphProjection,
      checkedAt: new Date().toISOString(),
    });
  });

  app.get('/health', { schema: { tags: ['system'] } }, async () => {
    const [providers, storage, ingestionStorage, dataQuality, graphProjection] = await Promise.all([
      providerHealth(),
      storageHealth(),
      ingestionStorageHealth(),
      dataQualityHealth(),
      graphProjectionHealth(),
    ]);
    return {
      status:
        providers.some((provider) => provider.status === 'UP') &&
        storage.status !== 'DOWN' &&
        ingestionStorage.status !== 'DOWN' &&
        !['DOWN', 'DEGRADED'].includes(dataQuality.status)
          ? 'UP'
          : 'DEGRADED',
      service: 'zerotrace-api',
      readOnly: true,
      providers,
      storage,
      ingestionStorage,
      dataQuality,
      graphProjection,
      checkedAt: new Date().toISOString(),
    };
  });

  app.get('/metrics', { schema: { hide: true } }, async (_request, reply) => {
    reply.header('content-type', metricsRegistry.contentType);
    return metricsRegistry.metrics();
  });

  app.get('/api/v1/data-quality/anchors', { schema: { tags: ['system'] } }, async () =>
    dataQualityHealth(),
  );

  const dataQualityConfiguredSources = runtime.dataQuality.configuredSources();
  const dataQualityReady = Object.values(dataQualityConfiguredSources).some(
    (count) => count >= options.config.dataQualityMinSources,
  );
  const bscReconciliationSources =
    runtime.evmSourceAdapters?.get(56)?.map((adapter) => adapter.sourceId) ?? [];
  const bscOperatorResolution = resolveSourceOperators(bscReconciliationSources);
  const bscReconciliationStatus =
    bscReconciliationSources.length < options.config.dataQualityMinSources
      ? 'TWO_BSC_ENDPOINTS_REQUIRED'
      : bscOperatorResolution.independence.state !== 'known'
        ? 'IMPLEMENTED_OPERATOR_REGISTRY_INCOMPLETE'
        : bscOperatorResolution.independence.value
          ? 'IMPLEMENTED_OPERATOR_INDEPENDENCE_CONFIGURED'
          : 'IMPLEMENTED_SAME_OPERATOR_INCONCLUSIVE';

  app.get('/api/v1/capabilities', { schema: { tags: ['system'] } }, async () => ({
    readOnly: true,
    core: [
      { id: 'canonical-schemas', status: 'IMPLEMENTED' },
      {
        id: 'evidence-ledger',
        status:
          runtime.evidenceRepository === undefined
            ? 'IMPLEMENTED_EPHEMERAL'
            : 'IMPLEMENTED_DURABLE',
        detail:
          runtime.evidenceRepository === undefined
            ? 'POSTGRES_URL is absent; Evidence is process-local.'
            : 'PostgreSQL append-only Evidence and Snapshot persistence is configured.',
      },
      {
        id: 'control-campaign-p0',
        status:
          runtime.controlCampaignReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PROVIDER_FREE_REPLAY',
        detail:
          'Token Flow, candidate screening, conserved Cluster Positions, Behavior Events, deterministic Campaign bundles, Evidence-bound alerts, and provider-free Campaign/SSE replay are wired from immutable PostgreSQL reports. Real token-history discovery and provider-backed backfill are wired; calibration and independent acceptance remain explicit pending boundaries.',
      },
      {
        id: 'global-intelligence-search',
        status:
          runtime.intelligenceSearch === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_EXACT_PROJECTION',
        detail:
          'Exact identifier, registered label, and label-category lookup projects immutable Evidence-bound reports plus registered Entity memberships from PostgreSQL. Symbol/ticker, platform/project lexical lookup, complete Subject Registry coverage, and semantic checkpoint indexing remain explicit gaps. An empty projection never means that a subject does not exist on-chain.',
      },
      {
        id: 'label-intelligence',
        status:
          runtime.labelIntelligenceReports === undefined || runtime.evidenceRepository === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_OBSERVATION_SNAPSHOT',
        detail:
          'Materializes all registered observations for one ledger-scoped Subject into an immutable Label Snapshot with source-priority review order, freshness states, preserved conflicts, conservative Service Hub suppression and terminal Evidence. Labels never merge Entities, risk labels never imply common control, and same text never merges subjects across chains. External label-source adapters and complete registry coverage remain pending.',
      },
      {
        id: 'evm-current-state',
        status: runtime.evmAdapters.size > 0 ? 'IMPLEMENTED' : 'PROVIDER_REQUIRED',
      },
      {
        id: 'bitcoin-esplora',
        status: runtime.bitcoinAdapter === undefined ? 'PROVIDER_REQUIRED' : 'IMPLEMENTED',
      },
      {
        id: 'solana-current-state',
        status: runtime.solanaAdapter === undefined ? 'PROVIDER_REQUIRED' : 'IMPLEMENTED',
      },
      {
        id: 'typed-ledger-query',
        status:
          runtime.evmAdapters.size > 0 &&
          runtime.bitcoinAdapter !== undefined &&
          runtime.solanaAdapter !== undefined
            ? 'IMPLEMENTED'
            : 'PROVIDERS_PARTIALLY_CONFIGURED',
        detail:
          'Read-only EVM transaction/block, Bitcoin address/transaction/block/outpoint, and Solana transaction/slot queries use strict provider-response validation and bind observations to Evidence plus replayable Snapshots. Bitcoin transactions add conservative common-input/change candidates with CoinJoin/Payjoin/service suppression and no automatic entity merge. Solana transactions normalize legacy/v0 messages, loaded ALT accounts, signer/writable flags, outer/CPI instructions, official System/SPL/Token-2022 core asset-flow semantics and recorded SOL/SPL balance effects while preserving missing owners, extension state and metadata as Unknown. Null, pending, mempool, and provider failures remain distinct.',
      },
      {
        id: 'flap-bsc-inspection',
        status: runtime.evmAdapters.has(56)
          ? 'PARTIALLY_IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'Versioned read-only Flap Portal V8Safe/V6/V5 decoding binds deployment metadata, bytecode, raw state, normalized launch fields, Snapshot, and Evidence. Transaction-local TokenCreated/configuration/migration decoding is available separately; automatic history discovery, tax/vault internals, migration/LP control analysis, and complete realizable value remain pending.',
      },
      {
        id: 'flap-event-transaction',
        status: runtime.evmAdapters.has(56)
          ? 'IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'A caller-supplied Flap transaction hash is decoded against the versioned Portal event interface at its exact block. Creation defaults remain source-tagged, unavailable curve internals remain Unknown, and migration facts carry receipt/log/derived Evidence. Chain-wide discovery remains pending.',
      },
      {
        id: 'flap-bounded-event-history',
        status: runtime.evmAdapters.has(56)
          ? 'IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'Bounded Portal log ranges use the finalized SQD BSC stream when configured, with strict RPC-log fallback, then decode by token and replay exact RPC receipts/block hashes. Requested-range coverage is distinct from token-lifetime coverage, which remains Unknown until deployment-origin indexing is continuous.',
      },
      {
        id: 'flap-event-history-projection',
        status:
          runtime.semanticCheckpoints === undefined || runtime.flapHistoryProjection === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A one-shot worker with separately configured SQD/BSC read providers projects wider finalized ranges as immutable bounded segments, persists each segment before cursor advancement, and resumes one exact pending segment after interruption. This API replays stored scan-ID pages without providers. Requested-range completion does not imply continuous token-lifetime coverage.',
      },
      {
        id: 'erc20-burn-candidate-promotion',
        status:
          runtime.semanticCheckpoints === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_INDEPENDENT_VALIDATION',
        detail:
          'A read-only BSC worker checkpoints complete zero-address event segments only after every candidate has an exact-block totalSupply/Transfer conservation certificate. Scan-ID API/UI replay uses PostgreSQL only, rejects corrupt state, and keeps silent supply-change detection Unknown.',
      },
      {
        id: 'evm-pension-behavior-candidate-discovery',
        status:
          runtime.evidenceRepository === undefined || runtime.pensionCandidateReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : !runtime.evmAdapters.has(56)
              ? 'BSC_PROVIDER_REQUIRED'
              : runtime.sqdBscLogReader === undefined
                ? 'SQD_PROVIDER_REQUIRED'
                : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A caller-supplied, versioned share-unit/depositor policy scans a complete finalized BSC ERC-20 Transfer range, emits only behavioral wallet candidates, and persists an immutable Evidence-linked report for provider-free replay. Official pension role, participant exit policy and dividend execution remain Unknown until independent source and flow Evidence support them.',
      },
      {
        id: 'flap-pension-entry-economics',
        status:
          runtime.evidenceRepository === undefined ||
          runtime.pensionCandidateReports === undefined ||
          runtime.pensionEntryReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : !runtime.evmAdapters.has(56)
              ? 'BSC_PROVIDER_REQUIRED'
              : 'IMPLEMENTED_PENDING_PINNED_FORK_EXECUTION',
        detail:
          'A durable pension-behavior candidate is joined to same-Snapshot Pancake V2 buy scenarios to calculate modeled whole-share capacity, remainder and average acquisition cost across input sizes, then stored as an immutable content-addressed Scenario Report for provider-free replay. The non-zero destination remains custody rather than supply burn; actual receipt, transfer tax/swapback, irreversibility and dividend execution remain Unknown.',
      },
      {
        id: 'erc20-supply-continuity',
        status:
          runtime.semanticCheckpoints === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : (runtime.evmSourceAdapters?.get(56)?.length ?? 0) < 2
              ? 'IMPLEMENTED_DURABLE_INCONCLUSIVE_SOURCE_COVERAGE'
              : 'IMPLEMENTED_DURABLE_OPERATOR_REGISTRY_GATED',
        detail:
          'A read-only BSC worker samples ERC-20 totalSupply at every finalized block transition with EIP-1898 canonical block-hash calls, compares every configured source exactly, and reconciles each supply change against complete same-block mint/burn Transfer Evidence before checkpoint advancement. Verified status additionally requires two officially registered operators; completed scan replay is provider-free.',
      },
      {
        id: 'flap-lifetime-materialization',
        status:
          runtime.semanticCheckpoints === undefined || runtime.flapHistoryProjection === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A one-shot worker composes official SQD dataset-start metadata, unique Flap deployment origin, and immutable origin-to-target event history at one exact finalized BSC Snapshot. Lifetime coverage is Known only when every child proof is complete; this API replays the composite checkpoint by scan ID without contacting providers.',
      },
      {
        id: 'flap-lifetime-heads',
        status:
          runtime.semanticCheckpoints === undefined ||
          runtime.flapHistoryProjection === undefined ||
          runtime.flapLifetimeHeads === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A continuous read-only worker reconciles a finalized BSC endpoint quorum, accepts one exact INITIAL lifetime materialization, then appends only Evidence-proven continuous deltas. A finalized conflict triggers all-source historical verification, append-only suffix invalidation and safe replay from the newest verified ancestor; unavailable or disagreeing sources cannot choose a branch. The latest accepted state replays without providers; forced real-reorg and independent-operator acceptance remain pending.',
      },
      {
        id: 'flap-token-origin',
        status: !runtime.evmAdapters.has(56)
          ? 'BSC_PROVIDER_REQUIRED'
          : runtime.sqdBscCreationReader === undefined
            ? 'SQD_PROVIDER_REQUIRED'
            : runtime.semanticCheckpoints === undefined
              ? 'IMPLEMENTED_EPHEMERAL_PENDING_REAL_CHAIN_VALIDATION'
              : 'IMPLEMENTED_DURABLE_PENDING_REAL_CHAIN_VALIDATION',
        detail:
          'A synchronous, range-limited finalized SQD create-trace search validates multi-response continuation metadata and rebinds a unique result to the exact BSC receipt, TokenCreated event, and Snapshot. When PostgreSQL is configured, every bounded chunk and terminal result resumes through immutable semantic checkpoints. Empty bounded ranges produce negative Evidence but never imply lifetime absence; the continuous lifetime scheduler composes this primitive only after exact coverage.',
      },
      {
        id: 'flap-bsc-sell-preview',
        status: runtime.evmAdapters.has(56)
          ? 'PARTIALLY_IMPLEMENTED_PENDING_REAL_CHAIN_VALIDATION'
          : 'BSC_PROVIDER_REQUIRED',
        detail:
          'Read-only Portal previewSell produces a fixed-block, provider-observed quote with Evidence. Non-tradable, migrated, unsupported, excessive-input, and provider-failure states never become zero proceeds.',
      },
      {
        id: 'cross-source-anchor-reconciliation',
        status: dataQualityReady
          ? runtime.dataQuality.durable
            ? 'IMPLEMENTED_DURABLE_PENDING_INDEPENDENT_VALIDATION'
            : 'IMPLEMENTED_EPHEMERAL_PENDING_INDEPENDENT_VALIDATION'
          : 'INDEPENDENT_PROVIDERS_REQUIRED',
        detail:
          'Common-position anchor comparison, continuity checks, reorg alerts, and explicit disagreement states are wired. Endpoint operator independence is not inferred from hostnames.',
      },
      {
        id: 'typed-discrepancy-audit',
        status: 'IMPLEMENTED_DETERMINISTIC',
        detail:
          'Evidence-grounded same-Snapshot comparisons enforce zero mismatch for exact state, exact-decimal typed budgets for derived/quote/aggregate values, warning bands, coverage gates, and Unknown exclusion from numeric denominators.',
      },
      {
        id: 'flap-pancake-v2-multi-source-reconciliation',
        status: bscReconciliationStatus,
        detail:
          'Each reconciled BSC endpoint independently reruns the complete Flap/Pancake V2 market, buy and sell certificate at one agreed finalized block. Exact state and typed 0.50% market/RV budgets fail closed; source independence becomes Known only for endpoints matched by the versioned official operator registry.',
      },
      {
        id: 'evm-control-surface',
        status:
          runtime.controlSurfaces === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : runtime.evmAdapters.size === 0
              ? 'EVM_PROVIDER_REQUIRED'
              : runtime.evmSourceVerification === undefined
                ? 'IMPLEMENTED_STANDARD_SURFACE_SOURCE_PROVIDER_OPTIONAL'
                : 'IMPLEMENTED_STANDARD_AND_SOURCE_SURFACE',
        detail:
          'Finalized multi-source EVM inspection covers exact ERC-1167 bytecode, EIP-1967 implementation/admin/beacon slots, ERC-173 owner(), registered Safe owners/threshold, and Snapshot-bound runtime logic code. Optional Sourcify V2 metadata is accepted only on exact bytecode equality; declared ABI mutations stay separate from effective rights. Reports and Evidence replay without providers. Effective custom authorization, history, and controller recursion remain pending.',
      },
      {
        id: 'solana-control-surface',
        status:
          runtime.solanaControlSurfaces === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : runtime.solanaAdapter === undefined
              ? 'SOLANA_PROVIDER_REQUIRED'
              : 'IMPLEMENTED_TOKEN_PROGRAM_AND_LOADER_V3',
        detail:
          'One finalized-slot account set is decoded with official SPL Token and Token-2022 codecs, including base authorities, classic multisig thresholds, extension authorities, and loader-v3 ProgramData upgrade authority. Reports replay without providers. Squads configuration, Anchor IDL, verifiable builds, authority history, and recursive controllers remain explicit Unknown.',
      },
      {
        id: 'solana-transaction-semantic-replay',
        status:
          runtime.solanaTransactionReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : runtime.solanaAdapter === undefined
              ? 'IMPLEMENTED_PROVIDER_FREE_REPLAY_ONLY'
              : 'IMPLEMENTED_DURABLE_LIVE_AND_REPLAY',
        detail:
          'Finalized Solana transaction semantics, official core asset flows, exact token reconciliation and their complete Evidence set are stored as immutable content-addressed reports. Latest/exact replay remains available without a provider and is explicitly marked as replayed.',
      },
      {
        id: 'action-semantics',
        status:
          runtime.actionSemanticsReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_PROVIDER_FREE_REPLAY',
        detail:
          'Chain-neutral EVM, Bitcoin and Solana action primitives persist as immutable content-addressed reports with canonical transaction identities, exact Snapshot-bound Evidence closure and non-derived source provenance. Latest/exact reads never contact a provider; the durable capture scheduler and Token History backfill binding are separate from the action report surface. There is no public report-write endpoint.',
      },
      {
        id: 'claim-declaration-replay',
        status:
          runtime.claimDeclarationReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_SOURCE_DOCUMENT_REPLAY',
        detail:
          'Submitted EVM declarations retain the exact source document as a content-addressed Snapshot, deterministic extraction coverage, direct source and terminal Evidence, and an immutable report. Exact/latest reads do not contact a provider. Source authenticity, independent corroboration, chain verification and non-EVM declaration normalization remain explicit Unknown or pending.',
      },
      {
        id: 'claim-rule-review-replay',
        status:
          runtime.claimRuleReviewReports === undefined ||
          runtime.claimDeclarationReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_EXPECTED_RULE_REVIEW',
        detail:
          'Human-confirmed or overridden declaration fields materialize immutable Expected Claim rules with exact source/review Evidence and provider-free replay. Claim truth, reviewer authority, chain verification and confidence remain explicitly Unknown until separate deterministic observation and audit stages complete.',
      },
      {
        id: 'claim-verification-observation',
        status:
          runtime.claimVerificationReports === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_BSC_CAPTURE_AND_REPLAY',
        detail:
          'The generic CLAIM_ACTIONS capture handler binds one reviewed EVM rule revision to a bounded finalized BSC range, captures source/destination custody and ERC-20 transfer Evidence under one terminal Snapshot, and persists an immutable verification report. Action Semantics, complete custody history, source independence and claim authenticity remain explicit Unknown until their dedicated adapters and coverage are available.',
      },
      {
        id: 'finalized-historical-ingestion',
        status:
          runtime.ingestionStorage.rawFacts !== undefined &&
          runtime.ingestionStorage.checkpoints !== undefined &&
          runtime.ingestionStorage.artifacts !== undefined
            ? 'IMPLEMENTED_DURABLE'
            : Object.values(runtime.ingestionStorage).some((value) => value !== undefined)
              ? 'STORAGE_PARTIALLY_CONFIGURED'
              : 'STORAGE_REQUIRED',
        detail:
          'Restart-safe SQD finalized blocks, transactions, EVM logs/traces/state diffs, Bitcoin inputs/outputs, and Solana instructions/logs/balances/token balances/rewards are implemented with durable provenance. Anchor continuity/reorg detection is wired separately; semantic transfers, protocol decoding, and non-EVM continuous handlers remain pending.',
      },
      {
        id: 'durable-capture-scheduling',
        status:
          runtime.captureSchedules === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : 'IMPLEMENTED_DURABLE_CLAIM_TOKEN_HISTORY_AND_MONITOR_HANDLERS',
        detail:
          'Generic EVM/Bitcoin/Solana read-only schedules use deterministic occurrence IDs, exclusive expiring leases, bounded retries and immutable attempts. CLAIM_ACTIONS and TOKEN_HISTORY_BACKFILL have production handler bindings; Token Live Capture persists restart-safe Token History, Funding/Settlement, Control Campaign, Evidence-bound alerts, and provider-free SSE replay. Temporal/NATS adapters and non-EVM handlers remain pending.',
      },
      {
        id: 'entity-evidence-fusion',
        status:
          runtime.evidenceRepository === undefined ||
          runtime.entityRelationshipReports === undefined ||
          runtime.entityRelationshipTimelines === undefined ||
          runtime.entityInvestigationGraphs === undefined ||
          runtime.entityInvestigationGraphTimelines === undefined
            ? 'DURABLE_STORAGE_REQUIRED'
            : runtime.ageInvestigationGraphProjection === undefined
              ? 'IMPLEMENTED_DURABLE_TEMPORAL_INVESTIGATION_GRAPH'
              : 'IMPLEMENTED_DURABLE_TEMPORAL_GRAPH_WITH_AGE_PROJECTION',
        detail:
          'Evidence-weighted pair scoring emits immutable Snapshot-bound hypotheses and pair timelines. Exact-Snapshot graph reports now compose into cross-Snapshot investigation timelines with explicit pair/request-scope deltas, parent-linked continuity, retained Unknown/negative/service states, provider-free replay, and no inferred membership or relationship termination. Apache AGE remains an optional rebuildable exact-Snapshot acceleration index; PostgreSQL reports are authoritative. Analyst overrides, protocol-scale relationship extraction and real-world calibration remain pending.',
      },
      { id: 'constant-product-rv', status: 'IMPLEMENTED_DETERMINISTIC' },
      { id: 'shared-liquidity-exit-race', status: 'IMPLEMENTED_DETERMINISTIC' },
    ],
    boundaries: {
      transactionSigning: 'FORBIDDEN',
      transactionBroadcasting: 'FORBIDDEN',
      privateKeyStorage: 'FORBIDDEN',
    },
  }));

  app.get('/api/v1/chains', { schema: { tags: ['system'] } }, async () => ({
    chains: [
      {
        ledger: 'EVM',
        chainId: `eip155:${options.config.ethereumChainId}`,
        name: 'Ethereum',
        configured: runtime.evmAdapters.has(options.config.ethereumChainId),
      },
      {
        ledger: 'EVM',
        chainId: `eip155:${options.config.bscChainId}`,
        name: 'BNB Smart Chain',
        configured: runtime.evmAdapters.has(options.config.bscChainId),
      },
      {
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        name: 'Bitcoin',
        configured: runtime.bitcoinAdapter !== undefined,
      },
      {
        ledger: 'SOLANA',
        chainId: 'solana-mainnet',
        name: 'Solana',
        configured: runtime.solanaAdapter !== undefined,
      },
    ],
  }));

  app.get('/api/v1/platforms', { schema: { tags: ['system'] } }, async () => ({
    platforms: PLATFORM_REGISTRY,
    launchpadRegistry: LAUNCHPAD_PROTOCOL_REGISTRY,
    gmgnConfigured: options.config.gmgnConfigured,
  }));

  app.get('/api/v1/search', { schema: { tags: ['intelligence'] } }, async (request) => {
    const query = SearchQuerySchema.parse(request.query);
    const result = classifyIdentifier(query.q, {
      ...(query.ledger === undefined ? {} : { ledger: query.ledger }),
      ...(query.chainId === undefined ? {} : { chainId: query.chainId }),
    });
    let durableResults;
    if (runtime.intelligenceSearch === undefined) {
      durableResults = unavailableValue(
        'STORAGE_UNCONFIGURED',
        'POSTGRES_URL is absent; only deterministic local identifier classification was executed.',
      );
    } else {
      try {
        durableResults = knownValue(
          await runtime.intelligenceSearch.search({
            query: query.q,
            ...(query.ledger === undefined ? {} : { ledger: query.ledger }),
            ...(query.chainId === undefined ? {} : { chainId: query.chainId }),
            ...(query.limit === undefined ? {} : { limit: query.limit }),
          }),
        );
      } catch (error) {
        if (!(error instanceof IntelligenceSearchStorageError)) throw error;
        durableResults = unavailableValue(
          'STORAGE_DOWN',
          `${error.code}: ${error.message} Local identifier classification remains available.`,
        );
      }
    }
    const durableMatches = durableResults.state === 'known' ? durableResults.value.matches : [];
    const matchConfidences = durableMatches.flatMap((match) =>
      match.analysisConfidence.state === 'known' ? [match.analysisConfidence.value] : [],
    );
    const resultConfidences = [
      ...result.candidates.map((candidate) => candidate.confidence),
      ...matchConfidences,
    ];
    const resultConfidence =
      resultConfidences.length === 0
        ? unknownValue(
            'INSUFFICIENT_DATA',
            'No classified identifier or confidence-bearing durable match was found in the declared scope.',
          )
        : knownValue(Math.max(...resultConfidences));
    const terminalEvidenceIds =
      durableResults.state === 'known' ? durableResults.value.terminalEvidenceIds : [];
    const sourceSet = [
      'local-checksum-and-structure',
      ...(durableResults.state === 'known' ? ['postgres-durable-intelligence-search-v1'] : []),
    ].sort();
    const executionCoverage = durableResults.state === 'known' ? 1 : 0.5;
    return {
      ...result,
      durableResults,
      resultConfidence,
      coverage: {
        scope: 'IDENTIFIER_CLASSIFICATION_AND_DURABLE_EXACT_PROJECTION_V1',
        identifierClassification: knownValue(true),
        durableProjection:
          durableResults.state === 'known'
            ? knownValue(true)
            : unavailableValue(durableResults.reason, durableResults.detail),
        gaps: {
          tokenSymbolTickerLookup: unknownValue(
            'NOT_IMPLEMENTED',
            'A verified token-symbol registry is not indexed yet.',
          ),
          platformProjectLexicalLookup: unknownValue(
            'NOT_IMPLEMENTED',
            'Platform and project names are not yet resolved by this exact-match projection.',
          ),
          completeSubjectRegistry: unknownValue(
            'NOT_IMPLEMENTED',
            'Not every report subject has a durable Subject Registry binding yet.',
          ),
          semanticCheckpointIndex: unknownValue(
            'NOT_IMPLEMENTED',
            'Semantic checkpoint payloads are not included in this projection version.',
          ),
        },
      },
      absenceSemantics: 'NO_DURABLE_MATCH_IS_NOT_ONCHAIN_NONEXISTENCE' as const,
      metadata: {
        ...emptyMetadata(
          'global-intelligence-search-v0.1.0',
          resultConfidence.state === 'known' ? resultConfidence.value : executionCoverage,
        ),
        dataCoverage: executionCoverage,
        sourceCoverage: executionCoverage,
        freshness: new Date().toISOString(),
        sourceSet,
        evidenceIds: terminalEvidenceIds,
      },
    };
  });

  app.post('/api/v1/labels/reports', { schema: { tags: ['analysis'] } }, async (request, reply) => {
    const input = LabelIntelligenceRequestSchema.parse(request.body);
    if (
      runtime.evidenceRepository === undefined ||
      runtime.labelIntelligenceReports === undefined
    ) {
      return reply
        .code(503)
        .send(
          errorResponse(
            request,
            'DURABLE_STORAGE_REQUIRED',
            'Label Intelligence requires durable Subject, Label observation, Evidence and report storage.',
            false,
          ),
        );
    }
    const observationSet = await runtime.labelIntelligenceReports.loadObservationSet(input);
    if (observationSet === undefined) {
      return reply
        .code(404)
        .send(
          errorResponse(
            request,
            'LABEL_SUBJECT_NOT_FOUND',
            'No exact ledger-scoped Subject Registry binding exists for this identifier.',
            false,
          ),
        );
    }
    if (observationSet.observations.length === 0) {
      return reply
        .code(422)
        .send(
          errorResponse(
            request,
            'LABEL_OBSERVATIONS_REQUIRED',
            'The Subject Registry row exists, but it has no durable Label observations to materialize.',
            false,
          ),
        );
    }
    const canonicalRequest = LabelIntelligenceRequestSchema.parse({
      ...input,
      normalizedIdentifier: observationSet.subject.normalizedIdentifier,
      asOf: new Date(input.asOf).toISOString(),
    });
    const result = buildLabelIntelligenceCore({
      subject: observationSet.subject,
      observations: observationSet.observations,
      request: canonicalRequest,
    });
    const sourceEvidenceIds = result.metadata.evidenceIds;
    const sourceNodes = await Promise.all(
      sourceEvidenceIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
    );
    if (sourceNodes.some((node) => node === undefined)) {
      return reply
        .code(503)
        .send(
          errorResponse(
            request,
            'DURABLE_EVIDENCE_INCOMPLETE',
            'A registered Label observation references unavailable durable Evidence.',
            true,
          ),
        );
    }
    const sourceEvidence = sourceNodes.map((node) => node?.evidence as Evidence);
    const incompatibleEvidenceIds = sourceEvidence
      .filter(
        (evidence) =>
          evidence.ledger !== result.subject.ledger || evidence.chainId !== result.subject.chainId,
      )
      .map((evidence) => evidence.id);
    if (incompatibleEvidenceIds.length > 0) {
      return rejectUngroundedAnalysis(
        request,
        reply,
        'Label observation Evidence is not scoped to the requested ledger and chain.',
        incompatibleEvidenceIds,
        'SNAPSHOT_INCOMPATIBLE',
      );
    }
    const locator = [
      'label-intelligence',
      result.subject.ledger,
      result.subject.chainId,
      result.subject.id,
      result.snapshot.id,
    ].join(':');
    const terminal = await addEvidence(
      runtime,
      createEvidence({
        ledger: result.subject.ledger,
        chainId: result.subject.chainId,
        kind: 'DERIVED_FEATURE',
        source: `zerotrace:${LABEL_INTELLIGENCE_MODEL_VERSION}`,
        locator,
        payload: { request: canonicalRequest, result },
        observedAt: canonicalRequest.asOf,
        finality: 'label-observation-set',
        summary:
          'Immutable Label observation-set review with preserved conflicts and non-merging safety rules.',
        sourceEvidenceIds,
      }),
      sourceEvidenceIds,
    );
    const resultWithTerminal = {
      ...result,
      metadata: {
        ...result.metadata,
        evidenceIds: uniqueEvidenceIds([...result.metadata.evidenceIds, terminal.id]).sort(),
      },
    };
    const report = LabelIntelligenceReportSchema.parse({
      schemaVersion: 'label-intelligence-report-v1',
      result: resultWithTerminal,
      terminalEvidenceId: terminal.id,
      evidence: [...sourceEvidence, terminal].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    });
    const record = await runtime.labelIntelligenceReports.put(report);
    return { replayed: false, record };
  });

  app.get(
    '/api/v1/labels/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const input = LabelIntelligenceIdentityQuerySchema.parse(request.query);
      const repository = runtime.labelIntelligenceReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'LABEL_INTELLIGENCE_UNAVAILABLE',
              'Durable Label Intelligence report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(input);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'LABEL_INTELLIGENCE_REPORT_NOT_FOUND',
              'No durable Label Intelligence report exists for this ledger-scoped Subject.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/labels/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LabelIntelligenceReportParamsSchema.parse(request.params);
      const repository = runtime.labelIntelligenceReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'LABEL_INTELLIGENCE_UNAVAILABLE',
              'Durable Label Intelligence report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'LABEL_INTELLIGENCE_REPORT_NOT_FOUND',
              'The durable Label Intelligence report does not exist.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/subjects/:ledger/:id',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = request.params as { ledger: string; id: string };
      const query = request.query as { chainId?: string };
      const ledger = params.ledger.toUpperCase();
      if (!['EVM', 'BITCOIN', 'SOLANA'].includes(ledger)) {
        return reply
          .code(400)
          .send(errorResponse(request, 'INVALID_LEDGER', 'Unsupported ledger.', false));
      }
      const classification = classifyIdentifier(params.id, {
        ledger: ledger as Ledger,
        ...(query.chainId === undefined ? {} : { chainId: query.chainId }),
      });
      const subject = classification.candidates.find((candidate) => candidate.type === 'ADDRESS');
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              'A checksum-valid or structurally valid address is required.',
              false,
            ),
          );
      }

      if (ledger === 'EVM') {
        const numericChainId = Number(
          (query.chainId ?? `eip155:${options.config.ethereumChainId}`).replace(/^eip155:/, ''),
        );
        const adapter = runtime.evmAdapters.get(numericChainId);
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata('evm-subject-v0.1.0'),
          });
        }
        const snapshot = await adapter.createSnapshot();
        const blockTag = `0x${BigInt(snapshot.blockNumber).toString(16)}`;
        const [balanceObservation, codeObservation] = await Promise.all([
          adapter.getBalanceObservation(subject.normalizedId, blockTag),
          adapter.getCodeObservation(subject.normalizedId, blockTag),
        ]);
        const balanceHex = balanceObservation.value;
        const code = codeObservation.value;
        const observationSources = {
          balance: balanceObservation.endpointId,
          code: codeObservation.endpointId,
        };
        const stateSourceIds = uniqueSourceIds(Object.values(observationSources));
        const sourceSet = uniqueSourceIds([...snapshotSourceIds(snapshot), ...stateSourceIds]);
        const payload = {
          balanceHex,
          code,
          blockTag,
          blockHash: snapshot.blockHash,
          observationSources,
        };
        const evidence = await addEvidence(
          runtime,
          createEvidence({
            ledger: 'EVM',
            chainId: snapshot.chainId,
            kind: 'ACCOUNT_STATE',
            source: evidenceSourceId(stateSourceIds),
            locator: `address:${subject.normalizedId}@${snapshot.blockNumber}`,
            payload,
            blockOrSlot: snapshot.blockNumber,
            finality: snapshot.finality,
            summary: 'EVM native balance and bytecode at the snapshot block.',
          }),
          [],
          snapshot,
        );
        const metadata: AnalysisMetadata = {
          snapshot,
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: snapshot.capturedAt,
          sourceSet,
          modelVersion: 'evm-subject-v0.1.0',
          confidence: 1,
          evidenceIds: [evidence.id],
        };
        return {
          subject,
          facts: {
            nativeBalanceAtomic: knownValue(parseHexQuantity(balanceHex, 'EVM balance')),
            accountKind: knownValue(code === '0x' ? 'EOA' : 'CONTRACT'),
          },
          metadata,
          evidence: [evidence],
        };
      }

      if (ledger === 'BITCOIN') {
        const adapter = runtime.bitcoinAdapter;
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata('btc-subject-v0.1.0'),
          });
        }
        return queryBitcoinAddress(adapter, subject, (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        );
      }

      const adapter = runtime.solanaAdapter;
      if (adapter === undefined) {
        return reply.code(503).send({
          subject,
          facts: unavailableValue('PROVIDER_UNCONFIGURED'),
          metadata: emptyMetadata('solana-subject-v0.1.0'),
        });
      }
      const snapshot = await adapter.createSnapshot();
      const accountObservation = await adapter.getAccountInfoObservation(
        subject.normalizedId,
        Number(snapshot.slot),
      );
      const response = accountObservation.value;
      const value = response.value;
      const sourceSet = uniqueSourceIds([
        ...snapshotSourceIds(snapshot),
        accountObservation.endpointId,
      ]);
      const payload = {
        response,
        snapshotSlot: snapshot.slot,
        snapshotBlockhash: snapshot.blockhash,
        observationSource: accountObservation.endpointId,
      };
      const evidence = await addEvidence(
        runtime,
        createEvidence({
          ledger: 'SOLANA',
          chainId: snapshot.chainId,
          kind: 'ACCOUNT_STATE',
          source: accountObservation.endpointId,
          locator: `account:${subject.normalizedId}@${snapshot.slot}`,
          payload,
          blockOrSlot: snapshot.slot,
          finality: snapshot.commitment,
          summary: 'Solana account state with a minimum snapshot slot.',
        }),
        [],
        snapshot,
      );
      const account = value ?? undefined;
      return {
        subject,
        facts: {
          exists: knownValue(account !== undefined),
          lamports:
            account === undefined
              ? unknownValue('INSUFFICIENT_DATA', 'The account does not exist at this Snapshot.')
              : knownValue(account.lamports),
          owner:
            account === undefined || typeof account.owner !== 'string'
              ? unknownValue('INSUFFICIENT_DATA')
              : knownValue(account.owner),
          executable:
            account === undefined || typeof account.executable !== 'boolean'
              ? unknownValue('INSUFFICIENT_DATA')
              : knownValue(account.executable),
        },
        metadata: {
          snapshot,
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: snapshot.capturedAt,
          sourceSet,
          modelVersion: 'solana-subject-v0.1.0',
          confidence: 1,
          evidenceIds: [evidence.id],
        },
        evidence: [evidence],
      };
    },
  );

  app.get(
    '/api/v1/ledger/SOLANA/TRANSACTION/:signature/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = SolanaTransactionReportParamsSchema.parse(request.params);
      const repository = runtime.solanaTransactionReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_TRANSACTION_REPORT_UNAVAILABLE',
              'Durable Solana transaction report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(params.signature);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'SOLANA_TRANSACTION_REPORT_NOT_FOUND',
              'No durable Solana transaction report exists for this signature.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/ledger/SOLANA/TRANSACTION/:signature/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = SolanaTransactionReportByIdParamsSchema.parse(request.params);
      const repository = runtime.solanaTransactionReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_TRANSACTION_REPORT_UNAVAILABLE',
              'Durable Solana transaction report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined || record.signature !== params.signature) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'SOLANA_TRANSACTION_REPORT_NOT_FOUND',
              'The durable Solana transaction report was not found for this signature.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.post(
    '/api/v1/solana/dealer-campaigns',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const body = SolanaDealerCampaignRequestSchema.parse(request.body);
      const requestAbort = bindRequestAbort(request, reply);
      const source = runtime.sqdSolanaSource;
      const adapter = runtime.solanaAdapter;
      if (source === undefined || adapter === undefined) {
        requestAbort.cleanup();
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_DEALER_CAPTURE_NO_SOURCE',
              'A finalized Solana RPC adapter and SQD solana-mainnet source are required for dealer capture.',
              false,
            ),
          );
      }
      try {
        const result = await captureSolanaDealerCampaign({
          ...body,
          source,
          adapter,
          signal: requestAbort.signal,
          writeEvidence: async (evidence, sourceEvidenceIds = [], snapshot) => {
            if (requestAbort.signal.aborted) {
              throw new ProviderError('TIMEOUT', 'Solana dealer capture was aborted.', {
                retryable: false,
              });
            }
            const stored = await addEvidence(runtime, evidence, sourceEvidenceIds, snapshot);
            if (requestAbort.signal.aborted) {
              throw new ProviderError('TIMEOUT', 'Solana dealer capture was aborted.', {
                retryable: false,
              });
            }
            return stored;
          },
        });
        const durableReport = await runtime.solanaDealerReports?.put(result.report);
        if (result.report.campaign !== null) {
          await runtime.controlCampaignReports?.put(result.report.campaign);
          for (const alert of result.report.alerts) {
            await runtime.forensicCampaignAlerts?.put(alert);
          }
        }
        return {
          replayed: false,
          durable: durableReport !== undefined,
          record: durableReport ?? null,
          report: result.report,
          sourceSummary: result.sourceSummary,
          candidateCount: result.candidateCount,
          truncated: result.truncated,
        };
      } finally {
        requestAbort.cleanup();
      }
    },
  );

  app.get(
    '/api/v1/solana/dealer-campaigns/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = SolanaDealerCampaignReportParamsSchema.parse(request.params);
      const repository = runtime.solanaDealerReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_DEALER_REPORT_UNAVAILABLE',
              'Durable Solana dealer campaign report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'SOLANA_DEALER_REPORT_NOT_FOUND',
              'The durable Solana dealer campaign report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/solana/mints/:mint/dealer-campaigns/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = SolanaDealerCampaignMintParamsSchema.parse(request.params);
      const repository = runtime.solanaDealerReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SOLANA_DEALER_REPORT_UNAVAILABLE',
              'Durable Solana dealer campaign report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(params.mint);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'SOLANA_DEALER_REPORT_NOT_FOUND',
              'No durable Solana dealer campaign report exists for this mint.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.post(
    '/api/v1/bitcoin/forensic-graphs',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const body = BitcoinForensicGraphRequestSchema.parse(request.body);
      const adapter = runtime.bitcoinAdapter;
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'BITCOIN_FORENSIC_GRAPH_PROVIDER_UNCONFIGURED',
              'A Bitcoin Esplora adapter is required for forensic graph capture.',
              false,
            ),
          );
      }
      const result = await captureBitcoinForensicGraph({
        adapter,
        request: body,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
      });
      const durableReport = await runtime.bitcoinForensicGraphReports?.put(result.report);
      return {
        replayed: false,
        durable: durableReport !== undefined,
        record: durableReport ?? null,
        report: result.report,
        sourceSummary: result.sourceSummary,
        capturedEvidence: result.evidence.map((item) => item.id),
      };
    },
  );

  app.get(
    '/api/v1/bitcoin/forensic-graphs/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = BitcoinForensicGraphReportParamsSchema.parse(request.params);
      const repository = runtime.bitcoinForensicGraphReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
              'Durable Bitcoin forensic graph storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'BITCOIN_FORENSIC_GRAPH_NOT_FOUND',
              'The durable Bitcoin forensic graph was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/bitcoin/transactions/:txid/forensic-graphs/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = BitcoinForensicGraphRootParamsSchema.parse(request.params);
      const repository = runtime.bitcoinForensicGraphReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
              'Durable Bitcoin forensic graph storage is not configured.',
              false,
            ),
          );
      }
      const record = (await repository.list({ rootTxid: params.txid, limit: 1 }))[0];
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'BITCOIN_FORENSIC_GRAPH_NOT_FOUND',
              'No durable Bitcoin forensic graph exists for this transaction.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/actions/semantics/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ActionSemanticsReportLookupQuerySchema.parse(request.query);
      const repository = runtime.actionSemanticsReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ACTION_SEMANTICS_REPORT_UNAVAILABLE',
              'Durable Action Semantics report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(query);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ACTION_SEMANTICS_REPORT_NOT_FOUND',
              'No durable Action Semantics report exists for this transaction.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/actions/semantics/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ActionSemanticsReportParamsSchema.parse(request.params);
      const repository = runtime.actionSemanticsReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ACTION_SEMANTICS_REPORT_UNAVAILABLE',
              'Durable Action Semantics report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ACTION_SEMANTICS_REPORT_NOT_FOUND',
              'The durable Action Semantics report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/ledger/:ledger/:type/:id',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LedgerRecordParamsSchema.parse(request.params);
      const query = LedgerRecordQuerySchema.parse(request.query);
      if (params.type === 'OUTPOINT' && params.ledger !== 'BITCOIN') {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'UNSUPPORTED_IDENTIFIER_TYPE',
              'Outpoints are only supported on Bitcoin.',
              false,
            ),
          );
      }
      const canonicalNonEvmChainId =
        params.ledger === 'BITCOIN'
          ? 'bitcoin-mainnet'
          : params.ledger === 'SOLANA'
            ? 'solana-mainnet'
            : undefined;
      if (
        query.chainId !== undefined &&
        canonicalNonEvmChainId !== undefined &&
        query.chainId !== canonicalNonEvmChainId
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_CHAIN_ID',
              `${params.ledger} queries require chainId=${canonicalNonEvmChainId}.`,
              false,
            ),
          );
      }
      const requestedChainId =
        params.ledger === 'EVM'
          ? (query.chainId ?? `eip155:${options.config.ethereumChainId}`)
          : params.ledger === 'BITCOIN'
            ? 'bitcoin-mainnet'
            : 'solana-mainnet';
      const classification = classifyIdentifier(params.id, {
        ledger: params.ledger,
        type: params.type,
        chainId: requestedChainId,
      });
      const subject = classification.candidates.find(
        (candidate) => candidate.ledger === params.ledger && candidate.type === params.type,
      );
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              `A structurally valid ${params.ledger} ${params.type.toLowerCase()} identifier is required.`,
              false,
            ),
          );
      }
      const writeEvidence = (
        evidence: Evidence,
        sourceEvidenceIds: readonly string[] = [],
        snapshot?: AnalysisSnapshot,
      ) => addEvidence(runtime, evidence, sourceEvidenceIds, snapshot);

      if (params.ledger === 'EVM') {
        const match = /^eip155:([1-9]\d*)$/.exec(requestedChainId);
        const numericChainId = match === null ? Number.NaN : Number(match[1]);
        if (!Number.isSafeInteger(numericChainId)) {
          return reply
            .code(400)
            .send(errorResponse(request, 'INVALID_CHAIN_ID', 'Invalid EIP-155 chain ID.', false));
        }
        const adapter = runtime.evmAdapters.get(numericChainId);
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata(`evm-${params.type.toLowerCase()}-query-v0.1.0`),
          });
        }
        return params.type === 'BLOCK'
          ? queryEvmBlock(adapter, subject, writeEvidence)
          : queryEvmTransaction(adapter, subject, writeEvidence);
      }

      if (params.ledger === 'BITCOIN') {
        const adapter = runtime.bitcoinAdapter;
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata(`bitcoin-${params.type.toLowerCase()}-query-v0.1.0`),
          });
        }
        if (params.type === 'BLOCK') return queryBitcoinBlock(adapter, subject, writeEvidence);
        if (params.type === 'OUTPOINT') {
          return queryBitcoinOutpoint(adapter, subject, writeEvidence);
        }
        return queryBitcoinTransaction(adapter, subject, writeEvidence);
      }

      const adapter = runtime.solanaAdapter;
      if (params.type === 'BLOCK') {
        if (adapter === undefined) {
          return reply.code(503).send({
            subject,
            facts: unavailableValue('PROVIDER_UNCONFIGURED'),
            metadata: emptyMetadata('solana-block-query-v0.1.0'),
          });
        }
        return querySolanaBlock(adapter, subject, writeEvidence);
      }

      const repository = runtime.solanaTransactionReports;
      if (adapter === undefined) {
        const record = await repository?.latest(subject.normalizedId);
        if (record !== undefined) {
          return solanaTransactionReportResponse(
            record,
            true,
            unavailableValue(
              'PROVIDER_UNCONFIGURED',
              'The immutable report was replayed because no live Solana provider is configured.',
            ),
          );
        }
        return reply.code(503).send({
          subject,
          facts: unavailableValue('PROVIDER_UNCONFIGURED'),
          metadata: emptyMetadata('solana-transaction-query-v1.1.0'),
        });
      }

      try {
        const result = await querySolanaTransaction(adapter, subject, writeEvidence);
        const parsed = SolanaTransactionIntelligenceReportSchema.safeParse(result);
        if (
          !parsed.success ||
          repository === undefined ||
          runtime.evidenceRepository === undefined
        ) {
          return result;
        }
        const record = await repository.put(parsed.data);
        return solanaTransactionReportResponse(record, false);
      } catch (error) {
        if (!(error instanceof ProviderError) || repository === undefined) throw error;
        const record = await repository.latest(subject.normalizedId);
        if (record === undefined) throw error;
        return solanaTransactionReportResponse(
          record,
          true,
          unavailableValue(
            error.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : 'PROVIDER_DOWN',
            `Live refresh failed with ${error.code}; the immutable report was replayed without changing its Snapshot.`,
          ),
        );
      }
    },
  );

  app.get(
    '/api/v1/evidence/:id',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const node = await getEvidenceNode(runtime, id);
      if (node === undefined)
        return reply
          .code(404)
          .send(errorResponse(request, 'EVIDENCE_NOT_FOUND', 'Evidence was not found.', false));
      return node;
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LaunchInspectionParamsSchema.parse(request.params);
      const query = LaunchInspectionQuerySchema.parse(request.query);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        return reply.code(503).send({
          platform: 'flap',
          token: params.token,
          platformMatch: unavailableValue('PROVIDER_UNCONFIGURED'),
          launch: null,
          metadata: emptyMetadata('flap-inspector-v0.1.0'),
        });
      }
      return inspectFlapToken({
        adapter,
        token: params.token,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(query.blockNumber === undefined ? {} : { blockNumber: query.blockNumber }),
      });
    },
  );

  app.get(
    '/api/v1/evidence/:id/drilldown',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const nodes =
        runtime.evidenceRepository === undefined
          ? runtime.evidenceLedger.drilldown(id)
          : await runtime.evidenceRepository.drilldown(id);
      if (nodes.length === 0)
        return reply
          .code(404)
          .send(errorResponse(request, 'EVIDENCE_NOT_FOUND', 'Evidence was not found.', false));
      return { rootEvidenceId: id, nodes };
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/events/:transactionHash',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = FlapEventTransactionParamsSchema.parse(request.params);
      FlapEventTransactionQuerySchema.parse(request.query);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        return reply.code(503).send({
          platform: 'flap',
          token: params.token,
          transactionHash: params.transactionHash,
          platformMatch: unavailableValue(
            'PROVIDER_UNCONFIGURED',
            'A BNB Smart Chain read-only provider is required.',
          ),
          transactionKind: null,
          creation: null,
          staged: null,
          configuration: null,
          migration: null,
          decodedEventNames: [],
          unrecognizedPortalLogCount: null,
          metadata: emptyMetadata(FLAP_EVENT_MODEL_VERSION),
          evidence: [],
        });
      }
      return inspectFlapEventTransaction({
        adapter,
        token: params.token,
        transactionHash: params.transactionHash,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
      });
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/history',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LaunchInspectionParamsSchema.parse(request.params);
      const query = FlapEventHistoryQuerySchema.parse(request.query);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        const chunkSize = query.chunkSize ?? FLAP_HISTORY_DEFAULT_CHUNK_SIZE;
        const fromBlock = BigInt(query.fromBlock);
        const toBlock = BigInt(query.toBlock);
        const range = toBlock >= fromBlock ? toBlock - fromBlock + 1n : 0n;
        return reply.code(503).send({
          platform: 'flap',
          token: params.token,
          requestedRange: {
            fromBlock: query.fromBlock,
            toBlock: query.toBlock,
            chunkSize,
            chunkCount:
              range === 0n ? 0 : Number((range + BigInt(chunkSize) - 1n) / BigInt(chunkSize)),
          },
          requestedRangeCoverage: 0,
          lifetimeCoverage: unavailableValue(
            'PROVIDER_UNCONFIGURED',
            'A BNB Smart Chain read-only provider is required.',
          ),
          chronology: [],
          transactions: [],
          unrecognizedPortalLogCount: null,
          metadata: emptyMetadata(FLAP_HISTORY_MODEL_VERSION),
          evidence: [],
        });
      }
      return discoverFlapEventHistory({
        adapter,
        ...(runtime.sqdBscLogReader === undefined ? {} : { logReader: runtime.sqdBscLogReader }),
        token: params.token,
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(query.chunkSize === undefined ? {} : { chunkSize: query.chunkSize }),
      });
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/history/projections/:scanId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = FlapHistoryProjectionParamsSchema.parse(request.params);
      const query = FlapHistoryProjectionPageQuerySchema.parse(request.query);
      const classification = classifyIdentifier(params.token, {
        ledger: 'EVM',
        type: 'ADDRESS',
        chainId: 'eip155:56',
      });
      const subject = classification.candidates.find(
        (candidate) => candidate.ledger === 'EVM' && candidate.type === 'ADDRESS',
      );
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              'A structurally valid EVM token address is required.',
              false,
            ),
          );
      }
      const checkpoints = runtime.semanticCheckpoints;
      const projection = runtime.flapHistoryProjection;
      if (checkpoints === undefined || projection === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_HISTORY_PROJECTION_UNAVAILABLE',
              'Durable Flap history projection storage is not configured.',
              false,
            ),
          );
      }
      const run = await checkpoints.get(params.scanId);
      if (
        run === undefined ||
        run.scanType !== 'FLAP_EVENT_HISTORY' ||
        run.source !== 'sqd:binance-mainnet' ||
        run.ledger !== 'EVM' ||
        run.chainId !== 'eip155:56' ||
        run.subject !== subject.normalizedId.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_HISTORY_PROJECTION_NOT_FOUND',
              'The requested Flap history projection was not found.',
              false,
            ),
          );
      }
      let terminalResult = null;
      if (run.status === 'REQUESTED_RANGE_COMPLETE') {
        const state =
          typeof run.state === 'object' && run.state !== null && !Array.isArray(run.state)
            ? run.state
            : undefined;
        const parsed = FlapEventHistoryProjectionSchema.safeParse(state?.result);
        if (!parsed.success) {
          throw new FlapHistoryProjectionError(
            'FLAP_HISTORY_PROJECTION_CONFLICT',
            'Completed Flap history projection terminal state is invalid.',
            { cause: parsed.error },
          );
        }
        terminalResult = parsed.data;
      }
      const stored = await projection.listSegments(run.id, {
        ...(query.afterBlock === undefined ? {} : { afterBlock: query.afterBlock }),
        limit: query.limit + 1,
      });
      const hasMore = stored.length > query.limit;
      const segments = stored.slice(0, query.limit);
      const last = segments.at(-1);
      const requestedBlocks = run.toBlock - run.fromBlock + 1;
      const completedBlocks = Math.max(0, Math.min(requestedBlocks, run.nextBlock - run.fromBlock));
      return {
        scan: {
          id: run.id,
          status: run.status,
          source: run.source,
          chainId: run.chainId,
          token: run.subject,
          requestedRange: {
            fromBlock: String(run.fromBlock),
            toBlock: String(run.toBlock),
            segmentSize: run.chunkSize,
          },
          nextBlock: String(run.nextBlock),
          requestedRangeCoverage: completedBlocks / requestedBlocks,
          evidenceIds: [...run.evidenceIds],
          lastErrorCode: run.lastErrorCode,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          completedAt: run.completedAt,
          terminalResult,
        },
        page: {
          afterBlock: query.afterBlock ?? null,
          limit: query.limit,
          hasMore,
          nextAfterBlock: hasMore && last !== undefined ? last.fromBlock : null,
        },
        segments,
      };
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/history/lifetime/heads/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LaunchInspectionParamsSchema.parse(request.params);
      FlapEventTransactionQuerySchema.parse(request.query);
      const classification = classifyIdentifier(params.token, {
        ledger: 'EVM',
        type: 'ADDRESS',
        chainId: 'eip155:56',
      });
      const subject = classification.candidates.find(
        (candidate) => candidate.ledger === 'EVM' && candidate.type === 'ADDRESS',
      );
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              'A structurally valid EVM token address is required.',
              false,
            ),
          );
      }
      const heads = runtime.flapLifetimeHeads;
      if (heads === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_LIFETIME_HEAD_UNAVAILABLE',
              'Durable Flap lifetime head storage is not configured.',
              false,
            ),
          );
      }
      const head = await heads.latestHead('eip155:56', subject.normalizedId.toLowerCase());
      if (head === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_LIFETIME_HEAD_NOT_FOUND',
              'No accepted Flap lifetime head exists for this token.',
              false,
            ),
          );
      }
      return { head };
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/history/lifetime/materializations/:scanId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = FlapHistoryProjectionParamsSchema.parse(request.params);
      FlapEventTransactionQuerySchema.parse(request.query);
      const classification = classifyIdentifier(params.token, {
        ledger: 'EVM',
        type: 'ADDRESS',
        chainId: 'eip155:56',
      });
      const subject = classification.candidates.find(
        (candidate) => candidate.ledger === 'EVM' && candidate.type === 'ADDRESS',
      );
      if (subject === undefined) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_IDENTIFIER',
              'A structurally valid EVM token address is required.',
              false,
            ),
          );
      }
      const checkpoints = runtime.semanticCheckpoints;
      if (checkpoints === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_LIFETIME_MATERIALIZATION_UNAVAILABLE',
              'Durable Flap lifetime materialization storage is not configured.',
              false,
            ),
          );
      }
      const run = await checkpoints.get(params.scanId);
      if (
        run === undefined ||
        run.scanType !== 'FLAP_LIFETIME_MATERIALIZATION' ||
        run.source !== FLAP_LIFETIME_MATERIALIZATION_SOURCE ||
        run.ledger !== 'EVM' ||
        run.chainId !== 'eip155:56' ||
        run.subject !== subject.normalizedId.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_LIFETIME_MATERIALIZATION_NOT_FOUND',
              'The requested Flap lifetime materialization was not found.',
              false,
            ),
          );
      }
      let terminalResult = null;
      if (run.status === 'REQUESTED_RANGE_COMPLETE') {
        const state =
          typeof run.state === 'object' && run.state !== null && !Array.isArray(run.state)
            ? run.state
            : undefined;
        const parsed = FlapLifetimeMaterializationSchema.safeParse(state?.result);
        if (!parsed.success) {
          throw new SemanticCheckpointError(
            'SEMANTIC_CHECKPOINT_CONFLICT',
            'Completed Flap lifetime materialization terminal state is invalid.',
            { cause: parsed.error },
          );
        }
        terminalResult = parsed.data;
      }
      const requestedBlocks = run.toBlock - run.fromBlock + 1;
      const completedBlocks = Math.max(0, Math.min(requestedBlocks, run.nextBlock - run.fromBlock));
      return {
        scan: {
          id: run.id,
          status: run.status,
          source: run.source,
          chainId: run.chainId,
          token: run.subject,
          dataset: 'binance-mainnet',
          datasetStartBlock: String(run.fromBlock),
          targetBlock: String(run.toBlock),
          nextBlock: String(run.nextBlock),
          requestedRangeCoverage: completedBlocks / requestedBlocks,
          evidenceIds: [...run.evidenceIds],
          lastErrorCode: run.lastErrorCode,
          startedAt: run.startedAt,
          updatedAt: run.updatedAt,
          completedAt: run.completedAt,
          terminalResult,
        },
      };
    },
  );

  app.get(
    '/api/v1/launches/:ledger/:token/origin',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = LaunchInspectionParamsSchema.parse(request.params);
      const query = FlapTokenOriginQuerySchema.parse(request.query);
      const adapter = runtime.evmAdapters.get(56);
      const creationReader = runtime.sqdBscCreationReader;
      if (adapter === undefined || creationReader === undefined) {
        const detail =
          adapter === undefined
            ? 'A BNB Smart Chain read-only provider is required.'
            : 'The finalized SQD BSC source is required for contract-creation trace discovery.';
        return reply.code(503).send({
          platform: 'flap',
          token: params.token,
          searchedRange: {
            fromBlock: query.fromBlock,
            toBlock: query.toBlock,
            chunkSize: query.chunkSize ?? FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE,
            chunkCount: Number(
              (BigInt(query.toBlock) -
                BigInt(query.fromBlock) +
                BigInt(query.chunkSize ?? FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE)) /
                BigInt(query.chunkSize ?? FLAP_TOKEN_ORIGIN_DEFAULT_CHUNK_SIZE),
            ),
          },
          searchedRangeCoverage: 0,
          origin: unavailableValue('PROVIDER_UNCONFIGURED', detail),
          lifetimeCoverage: unavailableValue('PROVIDER_UNCONFIGURED', detail),
          observedCreationCount: 0,
          metadata: emptyMetadata(FLAP_TOKEN_ORIGIN_MODEL_VERSION),
          evidence: [],
        });
      }
      const originOptions: InspectFlapTokenOriginOptions = {
        adapter,
        creationReader,
        token: params.token,
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(query.chunkSize === undefined ? {} : { chunkSize: query.chunkSize }),
      };
      return runtime.semanticCheckpoints === undefined
        ? inspectFlapTokenOrigin(originOptions)
        : inspectFlapTokenOriginRestartSafe({
            ...originOptions,
            checkpoints: runtime.semanticCheckpoints,
          });
    },
  );

  app.post('/api/v1/rv/flap-sell', { schema: { tags: ['analysis'] } }, async (request, reply) => {
    const input = FlapSellQuoteRequestSchema.parse(request.body);
    const adapter = runtime.evmAdapters.get(56);
    if (adapter === undefined) {
      const unavailable = unavailableValue(
        'PROVIDER_UNCONFIGURED',
        'A BNB Smart Chain read-only provider is required.',
      );
      return reply.code(503).send({
        platform: 'flap',
        token: input.token,
        quoteAsset: unavailable,
        quote: {
          inputQuantity: input.inputQuantity,
          nominalValue: unavailable,
          realizableValue: unavailable,
          averageExitPrice: unavailable,
          priceImpactBps: unavailable,
          totalFeeBps: unavailable,
          route: [],
          metadata: emptyMetadata('flap-preview-sell-v0.1.0'),
        },
        evidence: [],
      });
    }
    return quoteFlapSell({
      adapter,
      token: input.token,
      inputQuantity: input.inputQuantity,
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
        addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
      ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
    });
  });

  app.post(
    '/api/v1/rv/flap-pancake-v2-buy-scenarios',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPancakeV2BuyScenarioRequestSchema.parse(request.body);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        const detail = 'A BNB Smart Chain read-only provider is required.';
        return reply.code(503).send({
          platform: 'flap',
          token: input.token.toLowerCase(),
          market: unavailableValue('PROVIDER_UNCONFIGURED', detail),
          scenarios: [],
          validation: {
            status: 'NOT_RUN',
            deterministicToleranceBps: '10',
            evaluatedScenarioCount: 0,
            failedScenarioCount: 0,
          },
          pensionSinkTreatment: unknownValue(
            'INSUFFICIENT_DATA',
            'Sending tokens to a wallet is not a burn; custody and execution Evidence are unavailable.',
          ),
          terminalEvidenceId: null,
          metadata: emptyMetadata('flap-pancake-v2-pool-buy-scenarios-v0.1.0'),
          evidence: [],
        });
      }
      return quoteFlapPancakeV2BuyScenarios({
        adapter,
        token: input.token,
        quoteInputs: input.quoteInputs,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
      });
    },
  );

  app.post(
    '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPancakeV2PensionEntryRequestSchema.parse(request.body);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A BNB Smart Chain read-only provider is required for pension-entry economics.',
              true,
            ),
          );
      }
      if (
        runtime.evidenceRepository === undefined ||
        runtime.pensionCandidateReports === undefined ||
        runtime.pensionEntryReports === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_STORAGE_REQUIRED',
              'Pension-entry economics require durable Evidence, pension-candidate and Scenario Report storage.',
              false,
            ),
          );
      }
      const token = input.token.toLowerCase();
      const record =
        input.pensionReportId === undefined
          ? await runtime.pensionCandidateReports.latest(token)
          : await runtime.pensionCandidateReports.get(input.pensionReportId);
      if (
        record === undefined ||
        record.chainId !== input.chainId ||
        record.tokenAddress !== token
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_NOT_FOUND',
              'No matching durable BSC pension candidate report was found.',
              false,
            ),
          );
      }
      const selectedCandidate =
        input.pensionWallet === undefined
          ? record.report.candidates.length === 1
            ? record.report.candidates[0]
            : undefined
          : record.report.candidates.find(
              (candidate) => candidate.address === input.pensionWallet?.toLowerCase(),
            );
      if (selectedCandidate === undefined) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_SELECTION_REQUIRED',
              'Select one wallet contained in the referenced report; omission is allowed only when the report has exactly one candidate.',
              false,
            ),
          );
      }
      const evidenceNodes = await Promise.all(
        record.evidenceIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
      );
      if (evidenceNodes.some((node) => node === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_EVIDENCE_INCOMPLETE',
              'The pension candidate report references unavailable durable Evidence.',
              false,
            ),
          );
      }
      const result = await quoteFlapPensionEntryScenarios({
        adapter,
        token,
        quoteInputs: input.quoteInputs,
        pensionWallet: selectedCandidate.address,
        behaviorReportId: record.id,
        behaviorResultHash: record.resultHash,
        behaviorReport: record.report,
        behaviorEvidence: evidenceNodes.map((node) => node?.evidence as Evidence),
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
      });
      const stored = await runtime.pensionEntryReports.put(result);
      return {
        ...result,
        durableReport: {
          id: stored.id,
          resultHash: stored.resultHash,
          createdAt: stored.createdAt,
        },
      };
    },
  );

  app.get(
    '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPensionEntryReportQuerySchema.parse(request.query);
      const repository = runtime.pensionEntryReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
              'Durable Flap pension entry Scenario Report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(input.token.toLowerCase());
      if (
        record === undefined ||
        record.chainId !== input.chainId ||
        record.tokenAddress !== input.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_PENSION_ENTRY_REPORT_NOT_FOUND',
              'No durable Flap pension entry Scenario Report exists for this token.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/rv/flap-pancake-v2-pension-entry-scenarios/reports/:reportId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPensionEntryReportQuerySchema.parse(request.query);
      const params = FlapPensionEntryReportParamsSchema.parse(request.params);
      const repository = runtime.pensionEntryReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
              'Durable Flap pension entry Scenario Report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (
        record === undefined ||
        record.chainId !== input.chainId ||
        record.tokenAddress !== input.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FLAP_PENSION_ENTRY_REPORT_NOT_FOUND',
              'The durable Flap pension entry Scenario Report was not found for this BSC token.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.post(
    '/api/v1/rv/flap-pancake-v2-sell-scenarios',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPancakeV2SellScenarioRequestSchema.parse(request.body);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        const detail = 'A BNB Smart Chain read-only provider is required.';
        return reply.code(503).send({
          platform: 'flap',
          token: input.token.toLowerCase(),
          market: unavailableValue('PROVIDER_UNCONFIGURED', detail),
          scenarios: [],
          validation: {
            status: 'NOT_RUN',
            deterministicToleranceBps: '10',
            evaluatedScenarioCount: 0,
            failedScenarioCount: 0,
          },
          executionCapacity: unknownValue(
            'NOT_QUERIED',
            'Pinned-fork sell-capacity validation requires a configured BNB Smart Chain provider.',
          ),
          terminalEvidenceId: null,
          metadata: emptyMetadata('flap-pancake-v2-pool-sell-scenarios-v0.1.0'),
          evidence: [],
        });
      }
      return quoteFlapPancakeV2SellScenarios({
        adapter,
        token: input.token,
        tokenInputs: input.tokenInputs,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
      });
    },
  );

  app.post(
    '/api/v1/rv/flap-pancake-v2-reconciliation',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = FlapPancakeV2ReconciliationRequestSchema.parse(request.body);
      const sourceAdapters = runtime.evmSourceAdapters?.get(56) ?? [];
      if (sourceAdapters.length < options.config.dataQualityMinSources) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'MULTIPLE_BSC_ENDPOINTS_REQUIRED',
              `At least ${options.config.dataQualityMinSources} separately configured BSC endpoints are required.`,
              true,
            ),
          );
      }
      const anchorReconciliation = await runtime.dataQuality.inspect('EVM', 'eip155:56');
      if (anchorReconciliation.status !== 'AGREEMENT') {
        const unavailable = ['UNAVAILABLE', 'INSUFFICIENT_SOURCES'].includes(
          anchorReconciliation.status,
        );
        return reply.code(unavailable ? 503 : 409).send({
          ...errorResponse(
            request,
            `ANCHOR_${anchorReconciliation.status}`,
            'BSC endpoints did not establish one common finalized block identity.',
            unavailable,
          ),
          anchorReconciliation,
        });
      }
      return reconcileFlapPancakeV2Market({
        sourceAdapters,
        anchorReconciliation,
        token: input.token,
        quoteInputs: input.quoteInputs,
        tokenInputs: input.tokenInputs,
        deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
      });
    },
  );

  app.post(
    '/api/v1/data-quality/discrepancies',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = DiscrepancyAuditRequestSchema.parse(request.body);
      if (input.checks.length === 0) return auditDiscrepancies(input.checks, input.metadata);
      const snapshot = input.metadata.snapshot;
      if (snapshot === null) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Discrepancy comparisons require a target ledger Snapshot.',
        );
      }
      const sourceEvidenceIds = uniqueEvidenceIds([
        ...input.metadata.evidenceIds,
        ...input.checks.flatMap((check) => [
          ...check.actual.evidenceIds,
          ...check.reference.evidenceIds,
          ...(check.sourceIndependenceEvidenceIds ?? []),
          ...(check.explanationEvidenceIds ?? []),
        ]),
      ]);
      if (sourceEvidenceIds.length === 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'A non-empty discrepancy audit requires at least one source Evidence node.',
        );
      }
      const missingIds = await missingEvidenceIds(runtime, sourceEvidenceIds);
      if (missingIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Discrepancy source or explanation Evidence is not present in the evidence ledger.',
          missingIds,
        );
      }
      const incompatibleIds = await incompatibleEvidenceIds(runtime, sourceEvidenceIds, snapshot);
      if (incompatibleIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Discrepancy Evidence is not anchored to the target Snapshot.',
          incompatibleIds,
          'SNAPSHOT_INCOMPATIBLE',
        );
      }
      const result = auditDiscrepancies(input.checks, input.metadata);
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        snapshot,
        sourceEvidenceIds,
        DISCREPANCY_MODEL_VERSION,
        `data-quality:discrepancy-audit:${hashPayload(input.checks)}`,
        { input, result },
        'Typed same-Snapshot discrepancy and error-budget audit.',
      );
      return {
        ...result,
        checks: result.checks.map((check) => ({
          ...check,
          evidenceIds: uniqueEvidenceIds([...check.evidenceIds, derived.id]),
        })),
        metadata: {
          ...result.metadata,
          evidenceIds: uniqueEvidenceIds([...result.metadata.evidenceIds, derived.id]),
        },
        evidence: [derived],
      };
    },
  );

  app.post(
    '/api/v1/entities/resolve',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      let input = canonicalizeEntityRelationshipInput(
        EntityRelationshipInputSchema.parse(request.body),
      );
      if (input.features.length === 0) return resolveEntityRelationship(input);
      const snapshot = input.metadata.snapshot;
      if (snapshot === null) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Entity conclusions with features require a ledger snapshot.',
        );
      }
      if (
        runtime.evidenceRepository === undefined ||
        runtime.entityRelationshipReports === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_STORAGE_REQUIRED',
              'Entity relationship hypotheses require durable Evidence and report storage.',
              false,
            ),
          );
      }
      const sourceEvidenceIds = uniqueEvidenceIds([
        ...input.metadata.evidenceIds,
        ...input.features.map((feature) => feature.evidenceId),
      ]).sort();
      const missingIds = await missingEvidenceIds(runtime, sourceEvidenceIds);
      if (missingIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Entity feature evidence is not present in the evidence ledger.',
          missingIds,
        );
      }
      const incompatibleIds = await incompatibleEvidenceIds(runtime, sourceEvidenceIds, snapshot);
      if (incompatibleIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Entity evidence is not anchored to the requested ledger snapshot.',
          incompatibleIds,
          'SNAPSHOT_INCOMPATIBLE',
        );
      }
      const sourceNodes = await Promise.all(
        sourceEvidenceIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
      );
      if (sourceNodes.some((node) => node === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_EVIDENCE_INCOMPLETE',
              'Entity relationship source Evidence became unavailable before persistence.',
              true,
            ),
          );
      }
      const sourceEvidence = sourceNodes.map((node) => node?.evidence as Evidence);
      input = canonicalizeEntityRelationshipInput({
        ...input,
        metadata: {
          ...input.metadata,
          evidenceIds: sourceEvidenceIds,
          sourceSet: uniqueSourceIds(sourceEvidence.map((evidence) => evidence.source)),
        },
      });
      const result = resolveEntityRelationship(input);
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        snapshot,
        sourceEvidenceIds,
        `zerotrace:${ENTITY_RELATIONSHIP_MODEL_VERSION}`,
        'entity-relationship:' + input.subjectA + ':' + input.subjectB,
        { input, result },
        'Evidence-weighted controller, coordination, and independence inference.',
      );
      const resultWithTerminal = {
        ...result,
        metadata: {
          ...result.metadata,
          evidenceIds: uniqueSourceIds([...result.metadata.evidenceIds, derived.id]),
        },
      };
      const evidence = [...sourceEvidence, derived].sort((left, right) =>
        left.id.localeCompare(right.id),
      );
      const report = EntityRelationshipReportSchema.parse({
        schemaVersion: 'entity-relationship-report-v1',
        automaticOwnershipMergeAllowed: false,
        input,
        result: resultWithTerminal,
        terminalEvidenceId: derived.id,
        evidence,
      });
      const stored = await runtime.entityRelationshipReports.put(report);
      return {
        ...resultWithTerminal,
        automaticOwnershipMergeAllowed: false,
        terminalEvidenceId: derived.id,
        evidence,
        durableReport: {
          id: stored.id,
          resultHash: stored.resultHash,
          createdAt: stored.createdAt,
          replayed: false,
        },
      };
    },
  );

  app.get(
    '/api/v1/entities/relationships/reports/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipReportQuerySchema.parse(request.query);
      const repository = runtime.entityRelationshipReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
              'Durable Entity relationship report storage is not configured.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const record = await repository.latest({
        ledger: input.ledger,
        chainId: input.chainId,
        subjectA,
        subjectB,
      });
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_REPORT_NOT_FOUND',
              'No durable Entity relationship hypothesis report exists for this pair.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/entities/relationships/reports/:reportId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipReportQuerySchema.parse(request.query);
      const params = EntityRelationshipReportParamsSchema.parse(request.params);
      const repository = runtime.entityRelationshipReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
              'Durable Entity relationship report storage is not configured.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const record = await repository.get(params.reportId);
      if (
        record === undefined ||
        record.ledger !== input.ledger ||
        record.chainId !== input.chainId ||
        record.subjectA !== subjectA ||
        record.subjectB !== subjectB
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_REPORT_NOT_FOUND',
              'The durable Entity relationship hypothesis report was not found for this pair.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.post(
    '/api/v1/entities/relationships/timelines/materialize',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipTimelineMaterializeSchema.parse(request.body);
      if (
        runtime.evidenceRepository === undefined ||
        runtime.entityRelationshipReports === undefined ||
        runtime.entityRelationshipTimelines === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
              'Durable Evidence, relationship report, and timeline storage are required.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const records = await runtime.entityRelationshipReports.history({
        ledger: input.ledger,
        chainId: input.chainId,
        subjectA,
        subjectB,
        ...(input.fromPosition === undefined ? {} : { fromPosition: input.fromPosition }),
        ...(input.toPosition === undefined ? {} : { toPosition: input.toPosition }),
        limit: 1_001,
      });
      if (records.length > 1_000) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_TOO_LARGE',
              'The requested range contains more than 1,000 reports; provide a narrower position range.',
              false,
            ),
          );
      }
      if (records.length < 2) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_INSUFFICIENT_REPORTS',
              'At least two durable relationship reports are required to materialize a timeline.',
              false,
            ),
          );
      }
      const terminalEvidenceIds = records.map((record) => record.terminalEvidenceId).sort();
      const terminalNodes = await Promise.all(
        terminalEvidenceIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
      );
      if (terminalNodes.some((node) => node === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_EVIDENCE_INCOMPLETE',
              'A relationship report terminal Evidence node is unavailable.',
              true,
            ),
          );
      }
      const timeline = buildEntityRelationshipTimeline({
        ledger: input.ledger,
        chainId: input.chainId,
        subjectA,
        subjectB,
        reports: records.map((record) => ({
          observation: {
            reportId: record.id,
            resultHash: record.resultHash,
            snapshot: record.report.result.metadata.snapshot,
            classification: record.report.result.classification,
            sameControllerProbability: record.report.result.sameControllerProbability,
            coordinationProbability: record.report.result.coordinationProbability,
            independenceProbability: record.report.result.independenceProbability,
            serviceSuppressionApplied: record.report.result.serviceSuppressionApplied,
            terminalEvidenceId: record.terminalEvidenceId,
            capturedAt: record.capturedAt,
          },
          metadata: record.report.result.metadata,
        })),
      });
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        timeline.metadata.snapshot,
        terminalEvidenceIds,
        `zerotrace:${ENTITY_RELATIONSHIP_TIMELINE_MODEL_VERSION}`,
        `entity-relationship-timeline:${subjectA}:${subjectB}:${timeline.request.fromPosition}:${timeline.request.toPosition}`,
        { timeline },
        'Durable relationship evolution across persisted Snapshot hypotheses; chain-position continuity remains explicit Unknown.',
      );
      const evidence = [...terminalNodes.map((node) => node?.evidence as Evidence), derived].sort(
        (left, right) => left.id.localeCompare(right.id),
      );
      const report = EntityRelationshipTimelineReportSchema.parse({
        schemaVersion: 'entity-relationship-timeline-report-v1',
        automaticOwnershipMergeAllowed: false,
        timeline,
        terminalEvidenceId: derived.id,
        evidence,
      });
      const stored = await runtime.entityRelationshipTimelines.put(report);
      return { replayed: false, record: stored };
    },
  );

  app.get(
    '/api/v1/entities/relationships/timelines/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipReportQuerySchema.parse(request.query);
      const repository = runtime.entityRelationshipTimelines;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
              'Durable Entity relationship timeline storage is not configured.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const record = await repository.latest({
        ledger: input.ledger,
        chainId: input.chainId,
        subjectA,
        subjectB,
      });
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_NOT_FOUND',
              'No durable Entity relationship timeline exists for this pair.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/entities/relationships/timelines/:timelineId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityRelationshipReportQuerySchema.parse(request.query);
      const params = EntityRelationshipTimelineParamsSchema.parse(request.params);
      const repository = runtime.entityRelationshipTimelines;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
              'Durable Entity relationship timeline storage is not configured.',
              false,
            ),
          );
      }
      const [subjectA, subjectB] = canonicalSubjectPair(input.subjectA, input.subjectB);
      const record = await repository.get(params.timelineId);
      if (
        record === undefined ||
        record.ledger !== input.ledger ||
        record.chainId !== input.chainId ||
        record.subjectA !== subjectA ||
        record.subjectB !== subjectB
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_RELATIONSHIP_TIMELINE_NOT_FOUND',
              'The durable Entity relationship timeline was not found for this pair.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.post(
    '/api/v1/entities/investigation-graphs/materialize',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphMaterializeSchema.parse(request.body);
      if (
        runtime.evidenceRepository === undefined ||
        runtime.entityRelationshipReports === undefined ||
        runtime.entityRelationshipTimelines === undefined ||
        runtime.entityInvestigationGraphs === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
              'Durable Evidence, relationship reports, timelines, and graph report storage are required.',
              false,
            ),
          );
      }
      const timelineIds = [...input.timelineIds].sort();
      const records = await Promise.all(
        timelineIds.map((timelineId) => runtime.entityRelationshipTimelines?.get(timelineId)),
      );
      const missingTimelineIds = timelineIds.filter((_, index) => records[index] === undefined);
      if (missingTimelineIds.length > 0) {
        return reply.code(404).send({
          ...errorResponse(
            request,
            'ENTITY_RELATIONSHIP_TIMELINE_NOT_FOUND',
            'At least one requested durable relationship timeline was not found.',
            false,
          ),
          timelineIds: missingTimelineIds,
        });
      }
      const storedTimelines = records.map((record) => record!);
      if (
        storedTimelines.some(
          (record) => record.ledger !== input.ledger || record.chainId !== input.chainId,
        )
      ) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_IDENTITY_MISMATCH',
              'Every requested timeline must use the requested ledger and chain.',
              false,
            ),
          );
      }
      const snapshotHashes = new Set(
        storedTimelines.map((record) => hashPayload(record.report.timeline.metadata.snapshot)),
      );
      if (snapshotHashes.size !== 1) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_SNAPSHOT_MISMATCH',
              'Every requested timeline must terminate at the same exact Snapshot.',
              false,
            ),
          );
      }
      const relationshipPairs = storedTimelines.map(
        (record) => `${record.subjectA}\u0000${record.subjectB}`,
      );
      if (new Set(relationshipPairs).size !== relationshipPairs.length) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_DUPLICATE_PAIR',
              'An investigation graph may include only one timeline for each canonical subject pair.',
              false,
            ),
          );
      }
      const latestRelationshipReports = await Promise.all(
        storedTimelines.map((record) => {
          const latestReportId = record.report.timeline.observations.at(-1)?.reportId;
          return latestReportId === undefined
            ? undefined
            : runtime.entityRelationshipReports?.get(latestReportId);
        }),
      );
      if (latestRelationshipReports.some((record) => record === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_RELATIONSHIP_REPORT_INCOMPLETE',
              'A timeline terminal relationship report is unavailable.',
              true,
            ),
          );
      }
      const terminalEvidenceIds = storedTimelines.map((record) => record.terminalEvidenceId).sort();
      const terminalNodes = await Promise.all(
        terminalEvidenceIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
      );
      if (terminalNodes.some((node) => node === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_EVIDENCE_INCOMPLETE',
              'A relationship timeline terminal Evidence node is unavailable.',
              true,
            ),
          );
      }
      const graph = buildEntityInvestigationGraph({
        sources: storedTimelines.map((record, index) => {
          const relationship = latestRelationshipReports[index]!;
          return {
            timelineId: record.id,
            resultHash: record.resultHash,
            terminalEvidenceId: record.terminalEvidenceId,
            timeline: record.report.timeline,
            ...(relationship.report.input.subjectAIsService === undefined
              ? {}
              : { subjectAIsService: relationship.report.input.subjectAIsService }),
            ...(relationship.report.input.subjectBIsService === undefined
              ? {}
              : { subjectBIsService: relationship.report.input.subjectBIsService }),
          };
        }),
      });
      const snapshot = graph.metadata.snapshot;
      const graphPosition =
        snapshot.ledger === 'EVM'
          ? snapshot.blockNumber
          : snapshot.ledger === 'BITCOIN'
            ? snapshot.height
            : snapshot.slot;
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        snapshot,
        terminalEvidenceIds,
        `zerotrace:${ENTITY_INVESTIGATION_GRAPH_MODEL_VERSION}`,
        `entity-investigation-graph:${graph.request.ledger}:${graph.request.chainId}:${graphPosition}:${graph.request.timelineSetHash}`,
        { graph },
        'Exact-Snapshot investigation graph projection with distinct controller, coordination, service-suppression, negative, and Unknown semantics.',
      );
      const evidence = [...terminalNodes.map((node) => node?.evidence as Evidence), derived].sort(
        (left, right) => left.id.localeCompare(right.id),
      );
      const report = EntityInvestigationGraphReportSchema.parse({
        schemaVersion: 'entity-investigation-graph-report-v1',
        sourceOfTruth: 'DURABLE_ENTITY_RELATIONSHIP_TIMELINES',
        automaticOwnershipMergeAllowed: false,
        graph,
        terminalEvidenceId: derived.id,
        evidence,
      });
      const stored = await runtime.entityInvestigationGraphs.put(report);
      let ageProjection: KnowledgeValue<AgeInvestigationGraphProjectionResult>;
      if (runtime.ageInvestigationGraphProjection === undefined) {
        ageProjection = unavailableValue(
          'PROVIDER_UNCONFIGURED',
          'AGE_URL is absent; the authoritative PostgreSQL graph report remains available.',
        );
      } else {
        try {
          ageProjection = knownValue(await runtime.ageInvestigationGraphProjection.project(stored));
        } catch (error) {
          const reason =
            error instanceof AgeInvestigationGraphProjectionError
              ? error.code === 'AGE_PROJECTION_NOT_INITIALIZED'
                ? 'EXECUTION_BLOCKED'
                : error.code === 'AGE_PROJECTION_CONFLICT'
                  ? 'CONFLICTING_SOURCES'
                  : 'PROVIDER_DOWN'
              : 'PROVIDER_DOWN';
          ageProjection = unavailableValue(
            reason,
            'The optional Apache AGE index was not updated; the authoritative PostgreSQL graph report remains available.',
          );
        }
      }
      return { replayed: false, record: stored, ageProjection };
    },
  );

  app.get(
    '/api/v1/entities/investigation-graphs/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphQuerySchema.parse(request.query);
      const repository = runtime.entityInvestigationGraphs;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
              'Durable Entity investigation graph storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest({
        ledger: input.ledger,
        chainId: input.chainId,
        ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
      });
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_NOT_FOUND',
              'No durable Entity investigation graph exists for this identity.',
              false,
            ),
          );
      }
      const seedSubjectId = input.seedSubjectId ?? input.subjectId;
      if (
        seedSubjectId !== undefined &&
        !record.report.graph.nodes.some((node) => node.subjectId === seedSubjectId)
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_SEED_NOT_FOUND',
              'The traversal seed is not present in this investigation graph.',
              false,
            ),
          );
      }
      return {
        replayed: true,
        record,
        ...(seedSubjectId === undefined
          ? {}
          : {
              subgraph: traverseEntityInvestigationGraph(record.report.graph, {
                seedSubjectId,
                maxDepth: input.maxDepth,
                maxNodes: input.maxNodes,
              }),
            }),
      };
    },
  );

  app.get(
    '/api/v1/entities/investigation-graphs/:graphId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphQuerySchema.parse(request.query);
      const params = EntityInvestigationGraphParamsSchema.parse(request.params);
      const repository = runtime.entityInvestigationGraphs;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
              'Durable Entity investigation graph storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.graphId);
      if (
        record === undefined ||
        record.ledger !== input.ledger ||
        record.chainId !== input.chainId ||
        (input.subjectId !== undefined && !record.subjectIds.includes(input.subjectId))
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_NOT_FOUND',
              'The durable Entity investigation graph was not found for this identity.',
              false,
            ),
          );
      }
      const seedSubjectId = input.seedSubjectId ?? input.subjectId;
      if (
        seedSubjectId !== undefined &&
        !record.report.graph.nodes.some((node) => node.subjectId === seedSubjectId)
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_SEED_NOT_FOUND',
              'The traversal seed is not present in this investigation graph.',
              false,
            ),
          );
      }
      return {
        replayed: true,
        record,
        ...(seedSubjectId === undefined
          ? {}
          : {
              subgraph: traverseEntityInvestigationGraph(record.report.graph, {
                seedSubjectId,
                maxDepth: input.maxDepth,
                maxNodes: input.maxNodes,
              }),
            }),
      };
    },
  );

  app.post(
    '/api/v1/entities/investigation-graph-timelines/materialize',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphTimelineMaterializeSchema.parse(request.body);
      if (
        runtime.evidenceRepository === undefined ||
        runtime.entityInvestigationGraphs === undefined ||
        runtime.entityInvestigationGraphTimelines === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
              'Durable Evidence, investigation graph, and graph timeline storage are required.',
              false,
            ),
          );
      }
      const records = await Promise.all(
        input.graphIds.map((graphId) => runtime.entityInvestigationGraphs?.get(graphId)),
      );
      const missingGraphIds = input.graphIds.filter((_, index) => records[index] === undefined);
      if (missingGraphIds.length > 0) {
        return reply.code(404).send({
          ...errorResponse(
            request,
            'ENTITY_INVESTIGATION_GRAPH_NOT_FOUND',
            'At least one requested durable investigation graph was not found.',
            false,
          ),
          graphIds: missingGraphIds,
        });
      }
      const storedGraphs = records.map((record) => record!);
      if (
        storedGraphs.some(
          (record) => record.ledger !== input.ledger || record.chainId !== input.chainId,
        )
      ) {
        return reply
          .code(422)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_IDENTITY_MISMATCH',
              'Every requested investigation graph must use the requested ledger and chain.',
              false,
            ),
          );
      }
      const graphTerminalIds = storedGraphs.map((record) => record.terminalEvidenceId).sort();
      const graphTerminalNodes = await Promise.all(
        graphTerminalIds.map((evidenceId) => runtime.evidenceRepository?.get(evidenceId)),
      );
      if (graphTerminalNodes.some((node) => node === undefined)) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_EVIDENCE_INCOMPLETE',
              'An investigation graph terminal Evidence node is unavailable.',
              true,
            ),
          );
      }
      const timeline = buildEntityInvestigationGraphTimeline({
        sources: storedGraphs.map((record) => ({
          graphId: record.id,
          resultHash: record.resultHash,
          terminalEvidenceId: record.terminalEvidenceId,
          graph: record.report.graph,
        })),
      });
      const snapshot = timeline.metadata.snapshot;
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        snapshot,
        timeline.metadata.evidenceIds,
        `zerotrace:${ENTITY_INVESTIGATION_GRAPH_TIMELINE_MODEL_VERSION}`,
        `entity-investigation-graph-timeline:${timeline.request.ledger}:${timeline.request.chainId}:${timeline.request.fromPosition}-${timeline.request.toPosition}:${timeline.request.graphSetHash}`,
        { timeline },
        'Cross-Snapshot investigation graph timeline with explicit continuity, request-scope deltas, and no automatic membership or relationship termination.',
      );
      const evidence = [
        ...graphTerminalNodes.map((node) => node?.evidence as Evidence),
        derived,
      ].sort((left, right) => left.id.localeCompare(right.id));
      const report = EntityInvestigationGraphTimelineReportSchema.parse({
        schemaVersion: 'entity-investigation-graph-timeline-report-v1',
        sourceOfTruth: 'DURABLE_ENTITY_INVESTIGATION_GRAPHS',
        automaticOwnershipMergeAllowed: false,
        automaticEntityMembershipMutationAllowed: false,
        relationshipTerminationInferenceAllowed: false,
        timeline,
        terminalEvidenceId: derived.id,
        evidence,
      });
      const stored = await runtime.entityInvestigationGraphTimelines.put(report);
      return { replayed: false, record: stored };
    },
  );

  app.get(
    '/api/v1/entities/investigation-graph-timelines/latest',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphTimelineQuerySchema.parse(request.query);
      const repository = runtime.entityInvestigationGraphTimelines;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
              'Durable Entity investigation graph timeline storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest({
        ledger: input.ledger,
        chainId: input.chainId,
        ...(input.subjectId === undefined ? {} : { subjectId: input.subjectId }),
      });
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_NOT_FOUND',
              'No durable Entity investigation graph timeline exists for this identity.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/entities/investigation-graph-timelines/:timelineId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = EntityInvestigationGraphTimelineQuerySchema.parse(request.query);
      const params = EntityInvestigationGraphTimelineParamsSchema.parse(request.params);
      const repository = runtime.entityInvestigationGraphTimelines;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
              'Durable Entity investigation graph timeline storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.timelineId);
      if (
        record === undefined ||
        record.ledger !== input.ledger ||
        record.chainId !== input.chainId ||
        (input.subjectId !== undefined && !record.subjectIds.includes(input.subjectId))
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'ENTITY_INVESTIGATION_GRAPH_TIMELINE_NOT_FOUND',
              'The durable Entity investigation graph timeline was not found for this identity.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.post(
    '/api/v1/rv/constant-product',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = RvRequestSchema.parse(request.body);
      if (input.metadata.snapshot === null) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Realizable-value calculations require a ledger snapshot.',
        );
      }
      const sourceEvidenceIds = uniqueEvidenceIds([
        ...input.metadata.evidenceIds,
        ...input.pool.evidenceIds,
      ]);
      const missingIds = await missingEvidenceIds(runtime, sourceEvidenceIds);
      if (missingIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Pool-state evidence is not present in the evidence ledger.',
          missingIds,
        );
      }
      const incompatibleIds = await incompatibleEvidenceIds(
        runtime,
        sourceEvidenceIds,
        input.metadata.snapshot,
      );
      if (incompatibleIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Pool-state evidence is not anchored to the requested ledger snapshot.',
          incompatibleIds,
          'SNAPSHOT_INCOMPATIBLE',
        );
      }
      const result = quoteConstantProductExit(input);
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        input.metadata.snapshot,
        sourceEvidenceIds,
        'zerotrace-rv-engine@0.1.0',
        'rv:constant-product:' + input.pool.id,
        { input, result },
        'Deterministic constant-product realizable-value calculation.',
      );
      return {
        ...result,
        metadata: {
          ...result.metadata,
          evidenceIds: uniqueEvidenceIds([...result.metadata.evidenceIds, derived.id]),
        },
        evidence: [derived],
      };
    },
  );

  app.post(
    '/api/v1/scenarios/exit-race',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const input = ExitRaceRequestSchema.parse(request.body);
      if (input.metadata.snapshot === null) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Exit-race scenarios require a ledger snapshot.',
        );
      }
      const sourceEvidenceIds = uniqueEvidenceIds([
        ...input.metadata.evidenceIds,
        ...input.pool.evidenceIds,
      ]);
      const missingIds = await missingEvidenceIds(runtime, sourceEvidenceIds);
      if (missingIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Scenario evidence is not present in the evidence ledger.',
          missingIds,
        );
      }
      const incompatibleIds = await incompatibleEvidenceIds(
        runtime,
        sourceEvidenceIds,
        input.metadata.snapshot,
      );
      if (incompatibleIds.length > 0) {
        return rejectUngroundedAnalysis(
          request,
          reply,
          'Scenario evidence is not anchored to the requested ledger snapshot.',
          incompatibleIds,
          'SNAPSHOT_INCOMPATIBLE',
        );
      }
      const result = simulateExitRace(input);
      const derived = await addDerivedAnalysisEvidence(
        runtime,
        input.metadata.snapshot,
        sourceEvidenceIds,
        'zerotrace-scenario-engine@0.1.0',
        'scenario:exit-race:' + input.pool.id + ':' + String(input.seed),
        { input, result },
        'Deterministic shared-liquidity exit-race scenario.',
      );
      return {
        ...result,
        evidenceIds: uniqueEvidenceIds([...result.evidenceIds, derived.id]),
        metadata: {
          ...input.metadata,
          evidenceIds: uniqueEvidenceIds([...sourceEvidenceIds, derived.id]),
        },
        evidence: [derived],
      };
    },
  );

  app.post(
    '/api/v1/claims/declarations/parse',
    { schema: { tags: ['intelligence'] } },
    async (request) => {
      const input = ClaimDeclarationParseRequestSchema.parse(request.body);
      const result = parseEvmClaimDeclaration({
        text: input.text,
        chainId: input.chainId,
        assetId: input.assetId,
        source: 'api:user-submitted-claim-declaration',
        observedAt: new Date().toISOString(),
        ...(input.sourceUri === undefined ? {} : { sourceUri: input.sourceUri }),
        ...(input.auditWindow === undefined ? {} : { auditWindow: input.auditWindow }),
      });
      const evidence = await addEvidence(runtime, result.evidence);
      const terminalEvidence = await addEvidence(runtime, result.terminalEvidence, [evidence.id]);
      const report = { ...result, evidence, terminalEvidence };
      const stored = await runtime.claimDeclarationReports?.put(report);
      return {
        ...report,
        durableReport:
          stored === undefined
            ? unknownValue(
                'STORAGE_UNCONFIGURED',
                'The declaration report and Evidence are available only for this process because durable PostgreSQL storage is not configured.',
              )
            : knownValue({
                id: stored.id,
                resultHash: stored.resultHash,
                createdAt: stored.createdAt,
              }),
      };
    },
  );

  app.get(
    '/api/v1/claims/declarations/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ClaimDeclarationReportLookupQuerySchema.parse(request.query);
      const repository = runtime.claimDeclarationReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_UNAVAILABLE',
              'Durable Claim declaration report storage is not configured.',
              false,
            ),
          );
      }
      const record =
        query.documentHash === undefined
          ? await repository.latestByAsset(query.assetId)
          : await repository.latestByDocument(query.documentHash, query.assetId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_NOT_FOUND',
              'No durable Claim declaration report exists for this asset and source document.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/claims/declarations/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimDeclarationReportParamsSchema.parse(request.params);
      const repository = runtime.claimDeclarationReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_UNAVAILABLE',
              'Durable Claim declaration report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_NOT_FOUND',
              'The durable Claim declaration report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.post(
    '/api/v1/claims/rules/review',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const input = ClaimRuleReviewRequestSchema.parse(request.body);
      const declarationRepository = runtime.claimDeclarationReports;
      const reviewRepository = runtime.claimRuleReviewReports;
      if (declarationRepository === undefined || reviewRepository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_UNAVAILABLE',
              'Durable Claim declaration and rule-review storage must both be configured.',
              false,
            ),
          );
      }
      const declarationRecord = await declarationRepository.get(input.declarationReportId);
      if (declarationRecord === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_DECLARATION_REPORT_NOT_FOUND',
              'The source Claim declaration report was not found.',
              false,
            ),
          );
      }
      const tokenDecimalsNode =
        input.tokenDecimalsEvidenceId === undefined
          ? undefined
          : await getEvidenceNode(runtime, input.tokenDecimalsEvidenceId);
      if (input.tokenDecimalsEvidenceId !== undefined && tokenDecimalsNode === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_EVIDENCE_NOT_FOUND',
              'The token-decimals Evidence was not found.',
              false,
            ),
          );
      }
      if (
        tokenDecimalsNode !== undefined &&
        (tokenDecimalsNode.snapshot?.ledger !== 'EVM' ||
          tokenDecimalsNode.snapshot.chainId !== declarationRecord.chainId ||
          tokenDecimalsNode.snapshot.finality !== 'finalized' ||
          tokenDecimalsNode.evidence.blockOrSlot !== tokenDecimalsNode.snapshot.blockNumber ||
          tokenDecimalsNode.evidence.observedAt !== tokenDecimalsNode.snapshot.capturedAt)
      ) {
        return reply
          .code(409)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_EVIDENCE_CONFLICT',
              'Token-decimals Evidence must be bound to a matching finalized EVM Snapshot.',
              false,
            ),
          );
      }
      const result = reviewClaimDeclarationDraft({
        declarationReport: declarationRecord.report,
        draftId: input.draftId,
        reviewerLabel: input.reviewerLabel,
        reviewedAt: new Date().toISOString(),
        rule: input.rule,
        ...(input.tokenDecimals === undefined
          ? {}
          : { tokenDecimals: knownValue(input.tokenDecimals) }),
        ...(tokenDecimalsNode === undefined
          ? {}
          : { tokenDecimalsEvidence: tokenDecimalsNode.evidence }),
      });
      const reviewEvidence = result.evidence.find((item) => item.id === result.reviewEvidenceId);
      const terminalEvidence = result.evidence.find(
        (item) => item.id === result.terminalEvidenceId,
      );
      if (reviewEvidence === undefined || terminalEvidence === undefined) {
        throw new ClaimRuleReviewReportStorageError(
          'CLAIM_RULE_REVIEW_REPORT_INVALID',
          'Claim rule review Evidence closure is incomplete.',
        );
      }
      const storedReviewEvidence = await addEvidence(runtime, reviewEvidence);
      const terminalSourceIds = [
        declarationRecord.terminalEvidenceId,
        storedReviewEvidence.id,
        ...(tokenDecimalsNode === undefined ? [] : [tokenDecimalsNode.evidence.id]),
      ].sort();
      const storedTerminalEvidence = await addEvidence(
        runtime,
        terminalEvidence,
        terminalSourceIds,
      );
      const report = {
        ...result,
        evidence: result.evidence
          .map((item) =>
            item.id === storedReviewEvidence.id
              ? storedReviewEvidence
              : item.id === storedTerminalEvidence.id
                ? storedTerminalEvidence
                : item,
          )
          .sort((left, right) => left.id.localeCompare(right.id)),
      };
      const stored = await reviewRepository.put(report);
      return {
        ...report,
        durableReport: knownValue({
          id: stored.id,
          resultHash: stored.resultHash,
          createdAt: stored.createdAt,
        }),
      };
    },
  );

  app.post(
    '/api/v1/claims/:ledger/:token/metadata/decimals',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const input = Erc20DecimalsObservationRequestSchema.parse(request.body);
      const numericChainId = Number(input.chainId.slice('eip155:'.length));
      const adapter = Number.isSafeInteger(numericChainId)
        ? runtime.evmAdapters.get(numericChainId)
        : undefined;
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A configured EVM provider is required for token metadata observation.',
              true,
            ),
          );
      }
      const observation = await observeErc20Decimals(adapter, params.token);
      if (observation.assetId !== `${input.chainId}:erc20:${params.token.toLowerCase()}`) {
        throw new ProviderError('INVALID_RESPONSE', 'Token metadata Snapshot chain mismatched.');
      }
      const evidence = await addEvidence(runtime, observation.evidence, [], observation.snapshot);
      return {
        assetId: observation.assetId,
        decimals: knownValue(observation.decimals),
        snapshot: observation.snapshot,
        evidence,
        coverage: {
          metadataField: 1,
          sourceIndependence: unknownValue(
            'NOT_QUERIED',
            'One provider observation does not establish independent-source agreement.',
          ),
        },
        freshness: observation.snapshot.capturedAt,
        sourceSet: [evidence.source],
        modelVersion: 'erc20-metadata-observation-v1.0.0',
        confidence: unknownValue(
          'NOT_QUERIED',
          'Provider-independent confidence was not computed for this exact contract value.',
        ),
      };
    },
  );

  app.get(
    '/api/v1/claims/rules/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ClaimRuleReviewReportLookupQuerySchema.parse(request.query);
      const repository = runtime.claimRuleReviewReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_UNAVAILABLE',
              'Durable Claim rule review report storage is not configured.',
              false,
            ),
          );
      }
      const record =
        query.declarationReportId === undefined || query.draftId === undefined
          ? await repository.latestByAsset(query.assetId)
          : await repository.latestByDraft(query.declarationReportId, query.draftId);
      if (record === undefined || record.assetId !== query.assetId) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_NOT_FOUND',
              'No durable Claim rule review report exists for this asset and draft.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/claims/rules/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimRuleReviewReportParamsSchema.parse(request.params);
      const repository = runtime.claimRuleReviewReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_UNAVAILABLE',
              'Durable Claim rule review report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_RULE_REVIEW_REPORT_NOT_FOUND',
              'The durable Claim rule review report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/claims/verification/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ClaimVerificationReportLookupQuerySchema.parse(request.query);
      const repository = runtime.claimVerificationReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_VERIFICATION_REPORT_UNAVAILABLE',
              'Durable Claim verification report storage is not configured.',
              false,
            ),
          );
      }
      const record =
        query.ruleId === undefined
          ? await repository.latestByAsset(query.assetId as string)
          : await repository.latestByRule(query.ruleId);
      if (
        record === undefined ||
        (query.assetId !== undefined && record.assetId !== query.assetId)
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_VERIFICATION_REPORT_NOT_FOUND',
              'No durable Claim verification report exists for this reviewed rule.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/claims/verification/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimVerificationReportParamsSchema.parse(request.params);
      const repository = runtime.claimVerificationReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_VERIFICATION_REPORT_UNAVAILABLE',
              'Durable Claim verification report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_VERIFICATION_REPORT_NOT_FOUND',
              'The durable Claim verification report was not found.',
              false,
            ),
          );
      }
      return { replayed: true, record };
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/pension-candidates/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const repository = runtime.pensionCandidateReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_UNAVAILABLE',
              'Durable pension candidate report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(params.token.toLowerCase());
      if (record === undefined || record.chainId !== 'eip155:56') {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_NOT_FOUND',
              'No durable BSC pension candidate report exists for this token.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/pension-candidates/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = PensionCandidateReportByIdParamsSchema.parse(request.params);
      const repository = runtime.pensionCandidateReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_UNAVAILABLE',
              'Durable pension candidate report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (
        record === undefined ||
        record.chainId !== 'eip155:56' ||
        record.tokenAddress !== params.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'PENSION_CANDIDATE_REPORT_NOT_FOUND',
              'The durable pension candidate report was not found for this BSC token.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.post(
    '/api/v1/claims/:ledger/:token/pension-candidates',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const input = PensionCandidateDiscoveryRequestSchema.parse(request.body);
      const adapter = runtime.evmAdapters.get(56);
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A configured BSC provider is required for pension candidate discovery.',
              true,
            ),
          );
      }
      if (runtime.sqdBscLogReader === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'HISTORY_PROVIDER_UNCONFIGURED',
              'Pension candidate discovery requires the finalized BSC SQD dataset.',
              true,
            ),
          );
      }
      if (
        runtime.evidenceRepository === undefined ||
        runtime.pensionCandidateReports === undefined
      ) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'DURABLE_STORAGE_REQUIRED',
              'Pension candidate discovery requires durable Evidence and report storage.',
              false,
            ),
          );
      }
      const anchor = await adapter.readAnchorAt(input.toBlock);
      if (anchor.snapshot.ledger !== 'EVM' || anchor.snapshot.finality !== 'finalized') {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FINALIZED_PROVIDER_REQUIRED',
              'Pension candidate discovery requires a finalized range-end Snapshot.',
              true,
            ),
          );
      }
      const run = await discoverEvmPensionCandidates({
        tokenAddress: params.token,
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
        snapshot: anchor.snapshot,
        policy: {
          shareUnitAtomic: input.shareUnitAtomic,
          minimumExactUnitDeposits: input.minimumExactUnitDeposits,
          minimumUniqueExactUnitDepositors: input.minimumUniqueExactUnitDepositors,
          maximumCandidates: input.maximumCandidates,
        },
        logReader: runtime.sqdBscLogReader,
        blockReader: adapter,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.maxBlocksPerRequest === undefined
          ? {}
          : { maxBlocksPerRequest: input.maxBlocksPerRequest }),
        ...(input.maxRequests === undefined ? {} : { maxRequests: input.maxRequests }),
        ...(input.maxTransfers === undefined ? {} : { maxTransfers: input.maxTransfers }),
      });
      const durableReport = await runtime.pensionCandidateReports.put(run.report);
      return { report: run.report, durableReport };
    },
  );

  app.post(
    '/api/v1/claims/:ledger/:token/burn-candidates',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const input = ClaimBurnDiscoveryRequestSchema.parse(request.body);
      const numericChainId = Number(input.chainId.slice('eip155:'.length));
      if (!Number.isSafeInteger(numericChainId)) {
        return reply
          .code(400)
          .send(errorResponse(request, 'INVALID_CHAIN_ID', 'Invalid EIP-155 chain ID.', false));
      }
      const adapter = runtime.evmAdapters.get(numericChainId);
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A configured EVM provider is required for burn candidate discovery.',
              true,
            ),
          );
      }
      if (numericChainId !== 56 || runtime.sqdBscLogReader === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'HISTORY_PROVIDER_UNCONFIGURED',
              'The current long-range burn candidate path requires the BSC SQD dataset.',
              true,
            ),
          );
      }
      const anchor = await adapter.readAnchorAt(input.toBlock);
      if (anchor.snapshot.ledger !== 'EVM' || anchor.snapshot.finality !== 'finalized') {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FINALIZED_PROVIDER_REQUIRED',
              'Burn candidate discovery requires a finalized range-end Snapshot.',
              true,
            ),
          );
      }
      return discoverErc20BurnCandidates({
        tokenAddress: params.token,
        fromBlock: input.fromBlock,
        toBlock: input.toBlock,
        snapshot: anchor.snapshot,
        logReader: runtime.sqdBscLogReader,
        blockReader: adapter,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.maxBlocksPerRequest === undefined
          ? {}
          : { maxBlocksPerRequest: input.maxBlocksPerRequest }),
        ...(input.maxTransfers === undefined ? {} : { maxTransfers: input.maxTransfers }),
        ...(input.maxCandidates === undefined ? {} : { maxCandidates: input.maxCandidates }),
      });
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/burn-promotions/:scanId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnPromotionParamsSchema.parse(request.params);
      const checkpoints = runtime.semanticCheckpoints;
      if (checkpoints === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'BURN_PROMOTION_REPLAY_UNAVAILABLE',
              'Durable burn promotion storage is not configured.',
              false,
            ),
          );
      }
      const run = await checkpoints.get(params.scanId);
      if (
        run === undefined ||
        run.scanType !== 'ERC20_BURN_CANDIDATE_PROMOTION' ||
        run.source !== 'sqd:binance-mainnet' ||
        run.ledger !== 'EVM' ||
        run.chainId !== 'eip155:56' ||
        run.subject !== params.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'BURN_PROMOTION_NOT_FOUND',
              'The requested burn promotion scan was not found.',
              false,
            ),
          );
      }
      const terminalResult = replayErc20BurnPromotionResult(run);
      const totalBlocks = run.toBlock - run.fromBlock + 1;
      const completedBlocks = Math.min(Math.max(run.nextBlock - run.fromBlock, 0), totalBlocks);
      return {
        scan: {
          id: run.id,
          status: run.status,
          token: run.subject,
          requestedRange: {
            fromBlock: String(run.fromBlock),
            toBlock: String(run.toBlock),
            segmentSize: run.chunkSize,
          },
          nextBlock: String(run.nextBlock),
          requestedRangeCoverage: completedBlocks / totalBlocks,
          lastErrorCode: run.lastErrorCode,
          updatedAt: run.updatedAt,
        },
        terminalResult,
      };
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/supply-continuity/:scanId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimSupplyContinuityParamsSchema.parse(request.params);
      const checkpoints = runtime.semanticCheckpoints;
      if (checkpoints === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'SUPPLY_CONTINUITY_REPLAY_UNAVAILABLE',
              'Durable supply-continuity storage is not configured.',
              false,
            ),
          );
      }
      const run = await checkpoints.get(params.scanId);
      if (
        run === undefined ||
        run.scanType !== 'ERC20_SUPPLY_CONTINUITY' ||
        run.source !== 'multi-source:bsc-rpc+sqd' ||
        run.ledger !== 'EVM' ||
        run.chainId !== 'eip155:56' ||
        run.subject !== params.token.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'SUPPLY_CONTINUITY_NOT_FOUND',
              'The requested supply-continuity scan was not found.',
              false,
            ),
          );
      }
      const terminalResult = replayErc20SupplyContinuityResult(run);
      const totalBlocks = run.toBlock - run.fromBlock + 1;
      const completedBlocks = Math.min(Math.max(run.nextBlock - run.fromBlock, 0), totalBlocks);
      return {
        scan: {
          id: run.id,
          status: run.status,
          token: run.subject,
          requestedRange: {
            fromBlock: String(run.fromBlock),
            toBlock: String(run.toBlock),
            segmentSize: run.chunkSize,
          },
          nextBlock: String(run.nextBlock),
          requestedRangeCoverage: completedBlocks / totalBlocks,
          lastErrorCode: run.lastErrorCode,
          updatedAt: run.updatedAt,
        },
        terminalResult,
      };
    },
  );

  app.post(
    '/api/v1/claims/:ledger/:token/burn-conservation',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimBurnParamsSchema.parse(request.params);
      const input = ClaimBurnRequestSchema.parse(request.body);
      const numericChainId = Number(input.chainId.slice('eip155:'.length));
      if (!Number.isSafeInteger(numericChainId)) {
        return reply
          .code(400)
          .send(errorResponse(request, 'INVALID_CHAIN_ID', 'Invalid EIP-155 chain ID.', false));
      }
      const adapter = runtime.evmAdapters.get(numericChainId);
      if (adapter === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A configured EVM provider is required for burn conservation.',
              true,
            ),
          );
      }
      const anchor = await adapter.readAnchorAt(input.blockNumber);
      if (anchor.snapshot.ledger !== 'EVM' || anchor.snapshot.finality !== 'finalized') {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'FINALIZED_PROVIDER_REQUIRED',
              'Burn conservation requires a finalized EVM Snapshot.',
              true,
            ),
          );
      }
      const run = await observeEvmClaimBurnBlock({
        tokenAddress: params.token,
        snapshot: anchor.snapshot,
        adapter,
        logReader: adapter,
        blockReader: adapter,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(input.maxTransfers === undefined ? {} : { maxTransfers: input.maxTransfers }),
      });
      return run;
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/addresses/:address/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimReportParamsSchema.parse(request.params);
      const query = ClaimReportQuerySchema.parse(request.query);
      const repository = runtime.claimReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_REPORT_UNAVAILABLE',
              'Durable Claim Report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.latest(
        query.chainId,
        params.token.toLowerCase(),
        params.address.toLowerCase(),
      );
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_REPORT_NOT_FOUND',
              'No durable Claim Report exists for this token and address.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/claims/:ledger/:token/addresses/:address/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ClaimReportByIdParamsSchema.parse(request.params);
      const query = ClaimReportQuerySchema.parse(request.query);
      const repository = runtime.claimReports;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CLAIM_REPORT_UNAVAILABLE',
              'Durable Claim Report storage is not configured.',
              false,
            ),
          );
      }
      const record = await repository.get(params.reportId);
      if (
        record === undefined ||
        record.chainId !== query.chainId ||
        record.tokenAddress !== params.token.toLowerCase() ||
        record.address !== params.address.toLowerCase()
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CLAIM_REPORT_NOT_FOUND',
              'The requested durable Claim Report was not found for this subject.',
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.post(
    '/api/v1/control-rights/:ledger/:subject/inspect',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ControlSurfaceParamsSchema.parse(request.params);
      const input = ControlSurfaceInspectSchema.parse(request.body);
      if (
        (params.ledger === 'EVM' && !input.chainId.startsWith('eip155:')) ||
        (params.ledger === 'SOLANA' && input.chainId !== 'solana-mainnet')
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(
              request,
              'INVALID_CHAIN_ID',
              'Control surface ledger and chain ID do not match.',
              false,
            ),
          );
      }
      if (runtime.evidenceRepository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              'Durable Evidence storage is required for control inspection.',
              false,
            ),
          );
      }
      if (params.ledger === 'SOLANA') {
        if (input.blockNumber !== undefined) {
          return reply
            .code(400)
            .send(
              errorResponse(
                request,
                'HISTORICAL_STATE_UNSUPPORTED',
                'Solana JSON-RPC does not provide arbitrary historical account state; inspect the finalized live account set instead.',
                false,
              ),
            );
        }
        if (runtime.solanaControlSurfaces === undefined) {
          return reply
            .code(503)
            .send(
              errorResponse(
                request,
                'CONTROL_SURFACE_UNAVAILABLE',
                'Durable Solana control surface storage is required.',
                false,
              ),
            );
        }
        if (runtime.solanaAdapter === undefined) {
          return reply
            .code(503)
            .send(
              errorResponse(
                request,
                'PROVIDER_UNCONFIGURED',
                'A configured finalized Solana provider is required for control inspection.',
                true,
              ),
            );
        }
        const report = await inspectSolanaControlSurface({
          subject: params.subject,
          adapter: runtime.solanaAdapter,
          writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
            addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        });
        const record = await runtime.solanaControlSurfaces.put(report);
        return { record };
      }
      const repository = runtime.controlSurfaces;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              'Durable EVM control surface storage is required.',
              false,
            ),
          );
      }
      const numericChainId = Number(input.chainId.slice('eip155:'.length));
      if (!Number.isSafeInteger(numericChainId)) {
        return reply
          .code(400)
          .send(errorResponse(request, 'INVALID_CHAIN_ID', 'Invalid EIP-155 chain ID.', false));
      }
      const primary = runtime.evmAdapters.get(numericChainId);
      if (primary === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'PROVIDER_UNCONFIGURED',
              'A configured finalized EVM provider is required for control inspection.',
              true,
            ),
          );
      }
      const adapters = runtime.evmSourceAdapters?.get(numericChainId) ?? [primary];
      const report = await inspectEvmControlSurface({
        subject: params.subject,
        adapters,
        writeEvidence: (evidence, sourceEvidenceIds = [], snapshot) =>
          addEvidence(runtime, evidence, sourceEvidenceIds, snapshot),
        ...(runtime.evmSourceVerification === undefined
          ? {}
          : { sourceVerificationAdapter: runtime.evmSourceVerification }),
        ...(input.blockNumber === undefined ? {} : { blockNumber: input.blockNumber }),
      });
      const record = await repository.put(report);
      return { record };
    },
  );

  app.get(
    '/api/v1/control-rights/:ledger/:subject/reports/latest',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ControlSurfaceParamsSchema.parse(request.params);
      const query = ControlSurfaceQuerySchema.parse(request.query);
      if (
        (params.ledger === 'EVM' && !query.chainId.startsWith('eip155:')) ||
        (params.ledger === 'SOLANA' && query.chainId !== 'solana-mainnet')
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(request, 'INVALID_CHAIN_ID', 'Ledger and chain ID do not match.', false),
          );
      }
      const repository =
        params.ledger === 'EVM' ? runtime.controlSurfaces : runtime.solanaControlSurfaces;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              `Durable ${params.ledger} control surface storage is not configured.`,
              false,
            ),
          );
      }
      const record =
        params.ledger === 'EVM'
          ? await runtime.controlSurfaces?.latest(query.chainId, params.subject.toLowerCase())
          : await runtime.solanaControlSurfaces?.latest(params.subject);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_NOT_FOUND',
              `No durable ${params.ledger} control surface report was found for this subject.`,
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/control-rights/:ledger/:subject/reports/:reportId',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const params = ControlSurfaceByIdParamsSchema.parse(request.params);
      const query = ControlSurfaceQuerySchema.parse(request.query);
      if (
        (params.ledger === 'EVM' && !query.chainId.startsWith('eip155:')) ||
        (params.ledger === 'SOLANA' && query.chainId !== 'solana-mainnet')
      ) {
        return reply
          .code(400)
          .send(
            errorResponse(request, 'INVALID_CHAIN_ID', 'Ledger and chain ID do not match.', false),
          );
      }
      const repository =
        params.ledger === 'EVM' ? runtime.controlSurfaces : runtime.solanaControlSurfaces;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              `Durable ${params.ledger} control surface storage is not configured.`,
              false,
            ),
          );
      }
      const record =
        params.ledger === 'EVM'
          ? await runtime.controlSurfaces?.get(params.reportId)
          : await runtime.solanaControlSurfaces?.get(params.reportId);
      if (
        record === undefined ||
        record.chainId !== query.chainId ||
        record.subject !== (params.ledger === 'EVM' ? params.subject.toLowerCase() : params.subject)
      ) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_NOT_FOUND',
              `The requested durable ${params.ledger} control surface report was not found.`,
              false,
            ),
          );
      }
      return { record };
    },
  );

  app.get(
    '/api/v1/control-rights',
    { schema: { tags: ['intelligence'] } },
    async (request, reply) => {
      const query = ControlSurfaceListQuerySchema.parse(request.query);
      const repository =
        query.ledger === 'EVM' ? runtime.controlSurfaces : runtime.solanaControlSurfaces;
      if (repository === undefined) {
        return reply
          .code(503)
          .send(
            errorResponse(
              request,
              'CONTROL_SURFACE_UNAVAILABLE',
              `Durable ${query.ledger} control surface storage is not configured.`,
              false,
            ),
          );
      }
      const record =
        query.ledger === 'EVM'
          ? await runtime.controlSurfaces?.latest(query.chainId, query.subject.toLowerCase())
          : await runtime.solanaControlSurfaces?.latest(query.subject);
      return { records: record === undefined ? [] : [record] };
    },
  );

  const controlCampaignUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({
      status: unknownValue(
        'STORAGE_UNCONFIGURED',
        'PostgreSQL Control Campaign storage is not configured.',
      ),
      metadata: emptyMetadata('control-campaign-v1'),
      error: errorResponse(
        request,
        'CONTROL_CAMPAIGN_STORAGE_UNAVAILABLE',
        'Durable Control Campaign storage is not configured.',
        false,
      ).error,
    });

  const captureScheduleUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({
      status: unknownValue(
        'STORAGE_UNCONFIGURED',
        'PostgreSQL capture scheduler storage is not configured.',
      ),
      metadata: emptyMetadata('capture-scheduler-v1'),
      error: errorResponse(
        request,
        'CAPTURE_SCHEDULER_UNAVAILABLE',
        'Durable capture scheduler storage is not configured.',
        false,
      ).error,
    });

  const queueControlCampaignBackfill = async (
    request: FastifyRequest,
    reply: FastifyReply,
    params: { chainId: string; token: string },
  ) => {
    const schedules = runtime.captureSchedules;
    if (schedules === undefined) return captureScheduleUnavailable(request, reply);
    const body = ControlCampaignBackfillRequestSchema.parse(request.body);
    const dataset =
      params.chainId === 'eip155:1'
        ? 'ethereum-mainnet'
        : params.chainId === 'eip155:56'
          ? 'binance-mainnet'
          : undefined;
    if (dataset === undefined) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_BACKFILL_UNSUPPORTED_CHAIN',
            'Token History backfill currently supports Ethereum and BNB Smart Chain only.',
            false,
          ),
        );
    }
    const parameters = TokenHistoryBackfillParametersSchema.parse({
      schemaVersion: 'token-history-backfill-v1',
      dataset,
      token: params.token.toLowerCase(),
      fromBlock: body.fromBlock,
      toBlock: body.toBlock,
      modelVersion: 'token-history-backfill-v1.0.0',
      policyVersion: 'token-history-policy-v1.0.0',
    });
    const fromBlock = BigInt(parameters.fromBlock);
    const toBlock = BigInt(parameters.toBlock);
    if (
      fromBlock > BigInt(Number.MAX_SAFE_INTEGER) ||
      toBlock > BigInt(Number.MAX_SAFE_INTEGER) ||
      toBlock - fromBlock + 1n > 1_000_000n
    ) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_BACKFILL_RANGE_INVALID',
            'Token History backfill must fit a safe integer range and at most 1,000,000 blocks.',
            false,
          ),
        );
    }
    const target = {
      ledger: 'EVM' as const,
      chainId: params.chainId,
      subjectType: 'TOKEN' as const,
      normalizedIdentifier: params.token.toLowerCase(),
    };
    const existing = (
      await schedules.listSchedules({
        target,
        captureKind: 'TOKEN_HISTORY_BACKFILL',
        limit: 100,
      })
    ).find((schedule) => hashPayload(schedule.definition.parameters) === hashPayload(parameters));
    const schedule =
      existing ??
      (() => {
        // Bind creation and one-shot execution to the same millisecond. If these
        // calls straddle a millisecond boundary, the schedule can be born
        // COMPLETED instead of QUEUED and a valid backfill is never claimable.
        const enqueueAt = new Date().toISOString();
        return defineCaptureSchedule({
          captureKind: 'TOKEN_HISTORY_BACKFILL',
          target,
          parameters,
          createdAt: enqueueAt,
          trigger: { type: 'ONCE', at: enqueueAt },
          retryPolicy: {
            maxAttempts: 3,
            initialDelaySeconds: 30,
            maximumDelaySeconds: 900,
            backoffMultiplierBps: 20_000,
          },
        });
      })();
    const stored = existing ?? (await schedules.putSchedule(schedule));
    const runs = await schedules.listRunsForSchedule(stored.definition.id, 20);
    const response = {
      backfill: {
        scheduleId: stored.definition.id,
        status: stored.status === 'ACTIVE' ? 'QUEUED' : stored.status,
        target: stored.definition.target,
        parameters: TokenHistoryBackfillParametersSchema.parse(stored.definition.parameters),
        nextRunAt: stored.nextRunAt,
      },
      schedule: stored,
      runs,
      replayed: existing !== undefined,
    };
    return reply.code(existing === undefined ? 202 : 200).send(response);
  };

  const listControlCampaignBackfills = async (
    request: FastifyRequest,
    reply: FastifyReply,
    params: { chainId: string; token: string },
  ) => {
    const schedules = runtime.captureSchedules;
    if (schedules === undefined) return captureScheduleUnavailable(request, reply);
    const query = ControlCampaignListQuerySchema.parse(request.query);
    const target = {
      ledger: 'EVM' as const,
      chainId: params.chainId,
      subjectType: 'TOKEN' as const,
      normalizedIdentifier: params.token.toLowerCase(),
    };
    const records = await schedules.listSchedules({
      target,
      captureKind: 'TOKEN_HISTORY_BACKFILL',
      ...(query.limit === undefined ? {} : { limit: query.limit }),
    });
    return {
      records: await Promise.all(
        records.map(async (schedule) => ({
          schedule,
          runs: await schedules.listRunsForSchedule(schedule.definition.id, 20),
        })),
      ),
      replayed: true,
    };
  };

  const queueControlCampaignMonitor = async (
    request: FastifyRequest,
    reply: FastifyReply,
    params: { chainId: string; token: string },
  ) => {
    const schedules = runtime.captureSchedules;
    if (schedules === undefined) return captureScheduleUnavailable(request, reply);
    const body = ControlCampaignMonitorRequestSchema.parse(request.body);
    const dataset =
      params.chainId === 'eip155:1'
        ? 'ethereum-mainnet'
        : params.chainId === 'eip155:56'
          ? 'binance-mainnet'
          : undefined;
    if (dataset === undefined) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_MONITOR_UNSUPPORTED_CHAIN',
            'Token Campaign monitoring currently supports Ethereum and BNB Smart Chain only.',
            false,
          ),
        );
    }
    const initialFromBlock = BigInt(body.initialFromBlock);
    if (initialFromBlock > BigInt(Number.MAX_SAFE_INTEGER)) {
      return reply
        .code(400)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_MONITOR_RANGE_INVALID',
            'Monitor initialFromBlock must fit a safe integer range.',
            false,
          ),
        );
    }
    const parameters = TokenLiveCaptureParametersSchema.parse({
      schemaVersion: 'token-live-capture-v1',
      dataset,
      token: params.token.toLowerCase(),
      initialFromBlock: body.initialFromBlock,
      windowBlocks: body.windowBlocks ?? 10_000,
      modelVersion: 'token-live-capture-v1.0.0',
      policyVersion: 'token-history-policy-v1.0.0',
    });
    const everySeconds = body.everySeconds ?? 60;
    const target = {
      ledger: 'EVM' as const,
      chainId: params.chainId,
      subjectType: 'TOKEN' as const,
      normalizedIdentifier: params.token.toLowerCase(),
    };
    const existing = (
      await schedules.listSchedules({
        target,
        captureKind: 'TOKEN_LIVE_CAPTURE',
        limit: 100,
      })
    ).find(
      (schedule) =>
        hashPayload(schedule.definition.parameters) === hashPayload(parameters) &&
        schedule.definition.trigger.type === 'INTERVAL' &&
        schedule.definition.trigger.everySeconds === everySeconds,
    );
    const schedule =
      existing ??
      defineCaptureSchedule({
        captureKind: 'TOKEN_LIVE_CAPTURE',
        target,
        parameters,
        trigger: {
          type: 'INTERVAL',
          anchorAt: new Date().toISOString(),
          everySeconds,
          catchupPolicy: 'SKIP_MISSED',
        },
        retryPolicy: {
          maxAttempts: 3,
          initialDelaySeconds: 30,
          maximumDelaySeconds: 900,
          backoffMultiplierBps: 20_000,
        },
      });
    const stored = existing ?? (await schedules.putSchedule(schedule));
    const runs = await schedules.listRunsForSchedule(stored.definition.id, 20);
    return reply.code(existing === undefined ? 202 : 200).send({
      monitor: {
        monitorId: stored.definition.id,
        scheduleId: stored.definition.id,
        status: stored.status,
        target: stored.definition.target,
        parameters: TokenLiveCaptureParametersSchema.parse(stored.definition.parameters),
        trigger: stored.definition.trigger,
        nextRunAt: stored.nextRunAt,
      },
      schedule: stored,
      runs,
      replayed: existing !== undefined,
    });
  };

  const readControlCampaignMonitor = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ControlCampaignMonitorParamsSchema.parse(request.params);
    const schedules = runtime.captureSchedules;
    if (schedules === undefined) return captureScheduleUnavailable(request, reply);
    const schedule = await schedules.getSchedule(params.monitorId);
    if (schedule === undefined || schedule.definition.captureKind !== 'TOKEN_LIVE_CAPTURE') {
      return reply
        .code(404)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_MONITOR_NOT_FOUND',
            'Control Campaign monitor was not found.',
            false,
          ),
        );
    }
    return {
      monitor: {
        monitorId: schedule.definition.id,
        scheduleId: schedule.definition.id,
        status: schedule.status,
        target: schedule.definition.target,
        parameters: TokenLiveCaptureParametersSchema.parse(schedule.definition.parameters),
        trigger: schedule.definition.trigger,
        nextRunAt: schedule.nextRunAt,
      },
      schedule,
      runs: await schedules.listRunsForSchedule(schedule.definition.id, 50),
      replayed: true,
    };
  };

  const alertsUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({
      status: unknownValue(
        'STORAGE_UNCONFIGURED',
        'PostgreSQL Forensic Campaign Alert storage is not configured.',
      ),
      metadata: emptyMetadata('forensic-campaign-alert-v1'),
      error: errorResponse(
        request,
        'FORENSIC_ALERT_STORAGE_UNAVAILABLE',
        'Durable Forensic Campaign Alert storage is not configured.',
        false,
      ).error,
    });

  const campaignAlerts = async (
    request: FastifyRequest,
    reply: FastifyReply,
    campaignId: string,
  ): Promise<
    FastifyReply | { campaignId: string; alerts: ForensicCampaignAlert[]; replayed: true }
  > => {
    const campaigns = runtime.controlCampaignReports;
    const alerts = runtime.forensicCampaignAlerts;
    if (campaigns === undefined) return controlCampaignUnavailable(request, reply);
    if (alerts === undefined) return alertsUnavailable(request, reply);
    const record = await campaigns.get(campaignId);
    if (record === undefined) {
      return reply
        .code(404)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_NOT_FOUND',
            'Control Campaign was not found.',
            false,
          ),
        );
    }
    return { campaignId, alerts: await alerts.listByCampaign(campaignId), replayed: true };
  };

  const streamControlCampaignById = async (
    request: FastifyRequest,
    reply: FastifyReply,
    campaignId: string,
  ) => {
    const campaigns = runtime.controlCampaignReports;
    const alerts = runtime.forensicCampaignAlerts;
    if (campaigns === undefined) return controlCampaignUnavailable(request, reply);
    if (alerts === undefined) return alertsUnavailable(request, reply);
    const record = await campaigns.get(campaignId);
    if (record === undefined) {
      return reply
        .code(404)
        .send(
          errorResponse(
            request,
            'CONTROL_CAMPAIGN_NOT_FOUND',
            'Control Campaign was not found.',
            false,
          ),
        );
    }
    const records = await alerts.listByCampaign(campaignId);
    const events = [
      `event: campaign\ndata: ${JSON.stringify({
        campaignId: record.id,
        resultHash: record.resultHash,
        snapshotPosition: record.snapshotPosition,
        capturedAt: record.capturedAt,
        replayed: true,
      })}\n\n`,
      ...records.map(
        (alert) => `id: ${alert.id}\nevent: alert\ndata: ${JSON.stringify(alert)}\n\n`,
      ),
      `event: complete\ndata: ${JSON.stringify({
        campaignId: record.id,
        alertCount: records.length,
        replayed: true,
      })}\n\n`,
    ];
    return reply
      .header('content-type', 'text/event-stream; charset=utf-8')
      .header('cache-control', 'no-cache, no-store')
      .header('connection', 'keep-alive')
      .send(events.join(''));
  };

  const streamControlCampaign = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ControlCampaignParamsSchema.parse(request.params);
    return streamControlCampaignById(request, reply, params.campaignId);
  };

  const fundingSettlementUnavailable = (request: FastifyRequest, reply: FastifyReply) =>
    reply.code(503).send({
      status: unknownValue(
        'STORAGE_UNCONFIGURED',
        'PostgreSQL Funding and Settlement report storage is not configured.',
      ),
      metadata: emptyMetadata('funding-settlement-v1.0.0'),
      error: errorResponse(
        request,
        'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
        'Durable Funding and Settlement report storage is not configured.',
        false,
      ).error,
    });

  app.get(
    '/api/v1/funding-settlement/tokens/:chainId/:token/range',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const query = FundingSettlementRangeQuerySchema.parse(request.query);
      const repository = runtime.fundingSettlementReports;
      if (repository === undefined) return fundingSettlementUnavailable(request, reply);
      const report = await repository.forRange(
        params.chainId,
        params.token.toLowerCase(),
        query.fromBlock,
        query.toBlock,
      );
      if (report === undefined) {
        return {
          report: unknownValue(
            'NOT_QUERIED',
            'No durable Funding and Settlement report matches the selected campaign range.',
          ),
          snapshot: unknownValue('NOT_QUERIED'),
          metadata: emptyMetadata('funding-settlement-v1.0.0'),
          replayed: true,
        };
      }
      return { report, replayed: true };
    },
  );

  app.get(
    '/api/v1/funding-settlement/tokens/:chainId/:token',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const repository = runtime.fundingSettlementReports;
      if (repository === undefined) return fundingSettlementUnavailable(request, reply);
      const report = await repository.latest(params.chainId, params.token.toLowerCase());
      if (report === undefined) {
        return {
          report: unknownValue(
            'NOT_QUERIED',
            'No durable Funding and Settlement report has been materialized for this token.',
          ),
          snapshot: unknownValue('NOT_QUERIED'),
          metadata: emptyMetadata('funding-settlement-v1.0.0'),
          replayed: true,
        };
      }
      return { report, replayed: true };
    },
  );

  app.get(
    '/api/v1/funding-settlement/reports/:reportId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = FundingSettlementReportParamsSchema.parse(request.params);
      const repository = runtime.fundingSettlementReports;
      if (repository === undefined) return fundingSettlementUnavailable(request, reply);
      const report = await repository.get(params.reportId);
      if (report === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'FUNDING_SETTLEMENT_REPORT_NOT_FOUND',
              'The requested durable Funding and Settlement report was not found.',
              false,
            ),
          );
      }
      return { report, replayed: true };
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/overview',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.latest(params.chainId, params.token.toLowerCase());
      if (record === undefined) {
        return {
          campaign: unknownValue(
            'NOT_QUERIED',
            'No durable Control Campaign has been materialized for this token.',
          ),
          snapshot: unknownValue('NOT_QUERIED'),
          metadata: emptyMetadata('control-campaign-v1'),
        };
      }
      return controlCampaignResponse(record);
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/campaigns',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const query = ControlCampaignListQuerySchema.parse(request.query);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const records = await repository.list({
        chainId: params.chainId,
        token: params.token.toLowerCase(),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      });
      return { records: records.map((record) => controlCampaignResponse(record)) };
    },
  );

  app.post(
    '/api/v1/control/tokens/:chainId/:token/backfill',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      return queueControlCampaignBackfill(request, reply, params);
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/backfill',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      return listControlCampaignBackfills(request, reply, params);
    },
  );

  app.post(
    '/api/v1/control-campaigns/:ledger/:chainId/:token/backfills',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignBackfillAliasParamsSchema.parse(request.params);
      return queueControlCampaignBackfill(request, reply, params);
    },
  );

  app.get(
    '/api/v1/control-campaigns/:ledger/:chainId/:token/backfills',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignBackfillAliasParamsSchema.parse(request.params);
      return listControlCampaignBackfills(request, reply, params);
    },
  );

  app.post(
    '/api/v1/control/tokens/:chainId/:token/monitor',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      return queueControlCampaignMonitor(request, reply, params);
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/alerts',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const campaigns = runtime.controlCampaignReports;
      if (campaigns === undefined) return controlCampaignUnavailable(request, reply);
      const record = await campaigns.latest(params.chainId, params.token.toLowerCase());
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'No latest Control Campaign was found for this token.',
              false,
            ),
          );
      }
      return campaignAlerts(request, reply, record.id);
    },
  );

  app.get(
    '/api/v1/control/tokens/:chainId/:token/stream',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignTokenParamsSchema.parse(request.params);
      const campaigns = runtime.controlCampaignReports;
      if (campaigns === undefined) return controlCampaignUnavailable(request, reply);
      const record = await campaigns.latest(params.chainId, params.token.toLowerCase());
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'No latest Control Campaign was found for this token.',
              false,
            ),
          );
      }
      return streamControlCampaignById(request, reply, record.id);
    },
  );

  app.post(
    '/api/v1/control-campaigns/:ledger/:chainId/:token/monitors',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignBackfillAliasParamsSchema.parse(request.params);
      return queueControlCampaignMonitor(request, reply, params);
    },
  );

  app.get(
    '/api/v1/control-campaigns/monitors/:monitorId',
    { schema: { tags: ['analysis'] } },
    readControlCampaignMonitor,
  );

  app.get(
    '/api/v1/control-campaigns/:campaignId/alerts',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      return campaignAlerts(request, reply, params.campaignId);
    },
  );

  app.get(
    '/api/v1/control-campaigns/:campaignId/stream',
    { schema: { tags: ['analysis'] } },
    streamControlCampaign,
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return controlCampaignResponse(record);
    },
  );

  app.post(
    '/api/v1/control/campaigns/:campaignId/replay',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return controlCampaignResponse(record, true);
    },
  );

  app.post(
    '/api/v1/control/campaigns/:campaignId/export',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      try {
        return { case: await forensicCaseBundleForCampaign(runtime, record), replayed: true };
      } catch (error) {
        if (error instanceof ForensicCaseBundleError)
          return forensicCaseBundleError(request, reply, error);
        throw error;
      }
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/export',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      try {
        return { case: await forensicCaseBundleForCampaign(runtime, record), replayed: true };
      } catch (error) {
        if (error instanceof ForensicCaseBundleError)
          return forensicCaseBundleError(request, reply, error);
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/forensics/cases',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const body = ForensicCaseCreateSchema.parse(request.body);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(body.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      try {
        return { case: await forensicCaseBundleForCampaign(runtime, record), replayed: true };
      } catch (error) {
        if (error instanceof ForensicCaseBundleError)
          return forensicCaseBundleError(request, reply, error);
        throw error;
      }
    },
  );

  const readForensicCase = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = ForensicCaseParamsSchema.parse(request.params);
    const campaignId = params.caseId.slice('fcb_'.length);
    const repository = runtime.controlCampaignReports;
    if (repository === undefined) return controlCampaignUnavailable(request, reply);
    const record = await repository.get(campaignId);
    if (record === undefined || caseIdForCampaign(record.id) !== params.caseId) {
      return reply
        .code(404)
        .send(
          errorResponse(
            request,
            'FORENSIC_CASE_NOT_FOUND',
            'Forensic Case Bundle was not found.',
            false,
          ),
        );
    }
    try {
      return { case: await forensicCaseBundleForCampaign(runtime, record), replayed: true };
    } catch (error) {
      if (error instanceof ForensicCaseBundleError)
        return forensicCaseBundleError(request, reply, error);
      throw error;
    }
  };

  app.get('/api/v1/forensics/cases/:caseId', { schema: { tags: ['analysis'] } }, readForensicCase);
  app.get(
    '/api/v1/forensics/cases/:caseId/export',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const response = await readForensicCase(request, reply);
      if (reply.sent || response === undefined) return response;
      reply.header('content-type', 'application/json; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="forensic-case-bundle.json"');
      return response;
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/timeline',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return {
        campaignId: record.id,
        snapshot: record.bundle.campaign.snapshotEnd,
        metadata: record.bundle.campaign.metadata,
        events: record.bundle.behaviorEvents,
        evidenceLine: record.bundle.evidenceLine,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/positions',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return {
        campaignId: record.id,
        snapshot: record.bundle.campaign.snapshotEnd,
        metadata: record.bundle.campaign.metadata,
        positions: record.bundle.positions,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/wallets',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return {
        campaignId: record.id,
        snapshot: record.bundle.campaign.snapshotEnd,
        metadata: record.bundle.campaign.metadata,
        memberships: record.bundle.memberships,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/graph',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const query = ControlCampaignGraphQuerySchema.parse(request.query);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      const bundle = record.bundle;
      const phaseForLayer = {
        control: undefined,
        funding: 'FUNDING',
        token: 'TOKEN_CONTROL',
        settlement: 'SETTLEMENT',
      }[query.layer];
      const phaseItems =
        phaseForLayer === undefined
          ? bundle.evidenceItems
          : bundle.evidenceItems.filter((item) => item.phase === phaseForLayer);
      const nodes = new Map<string, { id: string; type: string; role?: string }>();
      for (const wallet of bundle.clusterVersion.memberWalletIds) {
        nodes.set(wallet, { id: wallet, type: 'WALLET' });
      }
      const edges = phaseItems
        .filter((item) => item.subjectA !== undefined && item.subjectB !== undefined)
        .map((item) => {
          const subjectA = item.subjectA!;
          const subjectB = item.subjectB!;
          nodes.set(subjectA, { id: subjectA, type: 'SUBJECT' });
          nodes.set(subjectB, { id: subjectB, type: 'SUBJECT' });
          return {
            id: item.id,
            source: subjectA,
            target: subjectB,
            relation: item.featureKind ?? item.phase,
            evidenceIds: [item.evidenceId],
            automaticEntityMembershipAllowed: false,
          };
        });
      return {
        layer: query.layer,
        campaignId: record.id,
        snapshot: bundle.campaign.snapshotEnd,
        metadata: bundle.campaign.metadata,
        automaticEntityMembershipAllowed: false,
        nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
        edges,
        resultHash: hashPayload({
          layer: query.layer,
          campaignId: record.id,
          nodes: [...nodes.keys()].sort(),
          edges,
        }),
      };
    },
  );

  app.get(
    '/api/v1/control/campaigns/:campaignId/evidence-line',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.get(params.campaignId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_CAMPAIGN_NOT_FOUND',
              'Control Campaign was not found.',
              false,
            ),
          );
      }
      return {
        campaignId: record.id,
        snapshot: record.bundle.campaign.snapshotEnd,
        metadata: record.bundle.campaign.metadata,
        evidenceLine: record.bundle.evidenceLine,
        items: record.bundle.evidenceItems,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/events/:eventId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignEventParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.findByBehaviorEventId(params.eventId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_EVENT_NOT_FOUND',
              'Behavior Event was not found.',
              false,
            ),
          );
      }
      const event = record.bundle.behaviorEvents.find((item) => item.id === params.eventId);
      return {
        campaignId: record.id,
        event,
        snapshot: record.bundle.campaign.snapshotEnd,
        resultHash: record.resultHash,
      };
    },
  );

  app.get(
    '/api/v1/control/evidence/:itemId',
    { schema: { tags: ['analysis'] } },
    async (request, reply) => {
      const params = ControlCampaignEvidenceItemParamsSchema.parse(request.params);
      const repository = runtime.controlCampaignReports;
      if (repository === undefined) return controlCampaignUnavailable(request, reply);
      const record = await repository.findByEvidenceItemId(params.itemId);
      if (record === undefined) {
        return reply
          .code(404)
          .send(
            errorResponse(
              request,
              'CONTROL_EVIDENCE_NOT_FOUND',
              'Campaign Evidence Item was not found.',
              false,
            ),
          );
      }
      const item = record.bundle.evidenceItems.find((candidate) => candidate.id === params.itemId);
      return {
        campaignId: record.id,
        item,
        evidenceLine: record.bundle.evidenceLine,
        snapshot: record.bundle.campaign.snapshotEnd,
        resultHash: record.resultHash,
      };
    },
  );

  const incompleteCapabilities = ['assets', 'labels', 'launches', 'markets', 'claims', 'timeline'];
  for (const capability of incompleteCapabilities) {
    app.all(`/api/v1/${capability}`, { schema: { tags: ['analysis'] } }, (request, reply) =>
      capabilityNotImplemented(request, reply, capability),
    );
  }

  return app;
}
