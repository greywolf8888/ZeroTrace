import { z } from 'zod';

import {
  AssetIdSchema,
  DecimalStringSchema,
  EvidenceIdSchema,
  ScenarioDistributionSchema,
  ScenarioIdSchema,
  knowledgeValueSchema,
} from './foundation.js';
import { AnalysisSnapshotSchema } from './foundation.js';

export const ExitStrategySchema = z.enum([
  'CONTROLLER_FIRST',
  'RETAIL_FIRST',
  'PRO_RATA',
  'SEEDED_RANDOM',
  'ADVERSARIAL_LP_REMOVAL',
  'SLIPPAGE_CONSTRAINED',
  'CONFIRMED_ROLES_ONLY',
  'HIGH_PROBABILITY_UPPER_BOUND',
  'MISSING_VENUE_SENSITIVITY',
]);
export type ExitStrategy = z.infer<typeof ExitStrategySchema>;

export const VenueKindSchema = z.enum([
  'CONSTANT_PRODUCT_V2',
  'CONCENTRATED_V3',
  'STABLESWAP',
  'BONDING_CURVE',
  'AGGREGATOR_ROUTE',
  'CEX_ORDER_BOOK',
  'OTC_UNKNOWN',
]);
export type VenueKind = z.infer<typeof VenueKindSchema>;

export const StablePegQualitySchema = z.object({
  asset: AssetIdSchema,
  includeInU: z.boolean(),
  pegDeviationBps: knowledgeValueSchema(z.string()),
  liquidityAtomic: knowledgeValueSchema(z.string()),
  source: z.string().min(1),
  evidenceIds: z.array(EvidenceIdSchema),
});
export type StablePegQuality = z.infer<typeof StablePegQualitySchema>;

export const VenueSnapshotSchema = z.object({
  id: z.string().min(1),
  kind: VenueKindSchema,
  baseToken: AssetIdSchema,
  quoteToken: AssetIdSchema,
  feeBps: z.string(),
  sellEnabled: z.boolean(),
  quoteSettlesInU: z.boolean().optional(),
  maxSellAtomic: z.string().optional(),
  lpTotalSupplyAtomic: z.string().optional(),
  blacklisted: z.boolean().optional(),
  sellTaxBps: z.string().optional(),
  reserves: z.object({
    baseAtomic: z.string(),
    quoteAtomic: z.string(),
  }),
  tick: z.number().int().optional(),
  tickLiquidityNet: z.string().optional(),
  v3RangeComplete: z.boolean().optional(),
  sqrtPriceX96: z.string().optional(),
  amplification: z.string().optional(),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});
export type VenueSnapshot = z.infer<typeof VenueSnapshotSchema>;

export const ExitCohortSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['CONTROLLER', 'HIDDEN_AFFILIATE', 'RETAIL', 'COORDINATED', 'SERVICE', 'UNKNOWN']),
  executableAmountAtomic: z.string(),
  lpTokenAmountAtomic: z.string().optional(),
});
export type ExitCohort = z.infer<typeof ExitCohortSchema>;

export const ExitFailureSchema = z.object({
  cohortId: z.string().min(1),
  remainingAtomic: z.string(),
  reason: z.enum([
    'NO_ROUTE',
    'MAX_TX',
    'BLACKLIST',
    'HONEYPOT',
    'INSUFFICIENT_LIQUIDITY',
    'SLIPPAGE_LIMIT',
    'SELL_DISABLED',
    'UNKNOWN_CONSTRAINT',
  ]),
});
export type ExitFailure = z.infer<typeof ExitFailureSchema>;

export const ExitCohortResultSchema = z.object({
  cohortId: z.string().min(1),
  soldAtomic: z.string(),
  realizedU: DecimalStringSchema,
  failed: z.array(ExitFailureSchema),
});
export type ExitCohortResult = z.infer<typeof ExitCohortResultSchema>;

export const MarketWideExitScenarioSchema = z.object({
  id: ScenarioIdSchema,
  token: AssetIdSchema,
  snapshot: AnalysisSnapshotSchema,
  executableSupplyAtomic: z.string(),
  participantCohorts: z.array(ExitCohortSchema),
  venueStates: z.array(VenueSnapshotSchema),
  strategy: ExitStrategySchema,
  totalRealizedU: DecimalStringSchema,
  cohortResults: z.array(ExitCohortResultSchema),
  failedAmountAtomic: z.string(),
  finalReferencePriceU: knowledgeValueSchema(DecimalStringSchema),
  distribution: ScenarioDistributionSchema.optional(),
  isolatedRvSumRejected: z.literal(true),
  peg: z.array(StablePegQualitySchema),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});
export type MarketWideExitScenario = z.infer<typeof MarketWideExitScenarioSchema>;

export const MarketWideExitPayloadSchema = z.object({
  scenarios: z.array(MarketWideExitScenarioSchema).min(1),
  impactCapacity: z.object({
    ec5: knowledgeValueSchema(DecimalStringSchema),
    ec10: knowledgeValueSchema(DecimalStringSchema),
    ec20: knowledgeValueSchema(DecimalStringSchema),
    ec50: knowledgeValueSchema(DecimalStringSchema),
  }),
});
export type MarketWideExitPayload = z.infer<typeof MarketWideExitPayloadSchema>;
