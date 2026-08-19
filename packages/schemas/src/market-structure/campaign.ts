import { z } from 'zod';

import {
  AssetIdSchema,
  CampaignV2IdSchema,
  ChainPositionSchema,
  EvidenceIdSchema,
  FindingIdSchema,
  ForensicFindingSchema,
  knowledgeValueSchema,
} from './foundation.js';

export const CampaignStatusSchema = z.enum([
  'OPEN',
  'CLOSED',
  'DORMANT',
  'REACTIVATED',
  'INSUFFICIENT_HISTORY',
  'BOUNDED_OBSERVATION',
]);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const CampaignStageSchema = z.enum([
  'PREPARATION',
  'ORIGIN_AND_PRIVILEGE_SETUP',
  'INVENTORY_BUILD',
  'LIQUIDITY_SEEDING',
  'HIDDEN_WAREHOUSE_DISTRIBUTION',
  'VOLUME_BOOTSTRAP',
  'CONTROLLED_MARKUP',
  'PRICE_DEFENSE',
  'DISTRIBUTION',
  'LIQUIDITY_EXIT',
  'SETTLEMENT_AND_REPATRIATION',
  'DORMANCY',
  'REENTRY',
]);
export type CampaignStage = z.infer<typeof CampaignStageSchema>;

export const CampaignFeatureWindowSchema = z.object({
  start: ChainPositionSchema,
  end: ChainPositionSchema,
  controllerNetToken: z.string(),
  controllerNetQuoteU: knowledgeValueSchema(z.string()),
  controlledSupplyAtomic: z.string(),
  hiddenAffiliateSupplyAtomic: z.string(),
  independentSupplyAtomic: z.string(),
  unknownSupplyAtomic: z.string(),
  newEntities: z.number().int(),
  exitedEntities: z.number().int(),
  fanOut: z.number(),
  fanIn: z.number(),
  dexBuyAtomic: z.string(),
  dexSellAtomic: z.string(),
  organicVolumeAtomic: knowledgeValueSchema(z.string()),
  cyclicVolumeAtomic: knowledgeValueSchema(z.string()),
  lpAddCount: z.number().int().nonnegative(),
  lpRemoveCount: z.number().int().nonnegative(),
  mintAtomic: z.string(),
  burnAtomic: z.string(),
  evidenceIds: z.array(EvidenceIdSchema),
});
export type CampaignFeatureWindow = z.infer<typeof CampaignFeatureWindowSchema>;

export const CampaignEpisodeSchema = z.object({
  stage: CampaignStageSchema,
  start: ChainPositionSchema,
  end: knowledgeValueSchema(ChainPositionSchema),
  featureWindow: CampaignFeatureWindowSchema,
  finding: ForensicFindingSchema,
});
export type CampaignEpisode = z.infer<typeof CampaignEpisodeSchema>;

export const TacticTypeSchema = z.enum([
  'PRIVILEGED_MINT_FREEZE_BLACKLIST',
  'PROXY_OR_OWNER_TRANSFER',
  'DYNAMIC_TAX_OR_EXEMPTION',
  'MAX_TX_WALLET_COOLDOWN',
  'WHITELIST_FRONT_RUN',
  'CLAIM_VESTING_MANIPULATION',
  'SELECTIVE_SELL_HONEYPOT',
  'SUPPLY_DISCLOSURE_MISMATCH',
  'TEAM_INITIAL_CONCENTRATION',
  'SYBIL_SPLIT',
  'HIDDEN_AFFILIATE_WAREHOUSE',
  'EARLY_BATCH_ACCUMULATION',
  'COMMON_FUNDER_FANOUT',
  'SHARED_GAS_OR_QUOTE',
  'MULTI_HOP_CONCEALMENT',
  'CROSS_CHAIN_SPLIT',
  'SYNCHRONIZED_TRADE',
  'WASH_OR_ROUND_TRIP',
  'SELF_TRADE',
  'VOLUME_BOOTSTRAP',
  'CONTROLLED_MARKUP',
  'PRICE_DEFENSE',
  'LADDERED_DISTRIBUTION',
  'SNIPER_QUEUE',
  'MEV_DISGUISE',
  'MARKET_MAKER_DISGUISE',
  'TEMPORARY_LP_DEPTH',
  'MULTI_POOL_MARKING',
  'LP_CONTROL_CONCENTRATION',
  'LP_TOKEN_MIGRATION',
  'REMOVE_LP_THEN_SELL',
  'UNUSABLE_LIQUIDITY_LEFT',
  'MIGRATION_CONTROL_ADVANTAGE',
  'QUOTE_SELF_CYCLE',
  'TAX_SKIM',
  'FAKE_BUYBACK',
  'THEATRICAL_BURN',
  'CEX_PREPOSITION',
  'BRIDGE_EXIT',
  'SETTLEMENT_CONVERGENCE',
  'STATEMENT_CHAIN_MISMATCH',
]);
export type TacticType = z.infer<typeof TacticTypeSchema>;

export const TacticHypothesisSchema = z.object({
  id: z.string().regex(/^tac_[0-9a-f]{24}$/),
  tacticType: TacticTypeSchema,
  campaignId: CampaignV2IdSchema,
  stages: z.array(CampaignStageSchema),
  subjects: z.array(z.string().min(1)),
  finding: ForensicFindingSchema,
  impactTokenAtomic: knowledgeValueSchema(z.string()),
  impactQuoteU: knowledgeValueSchema(z.string()),
});
export type TacticHypothesis = z.infer<typeof TacticHypothesisSchema>;

export const CampaignBoundarySchema = z.object({
  start: ChainPositionSchema,
  end: knowledgeValueSchema(ChainPositionSchema),
  originComplete: z.boolean(),
  deterministicReasons: z.array(z.string().min(1)),
  changePointCandidates: z.array(
    z.object({
      position: ChainPositionSchema,
      score: z.number(),
      evidenceIds: z.array(EvidenceIdSchema),
    }),
  ),
});
export type CampaignBoundary = z.infer<typeof CampaignBoundarySchema>;

export const MarketControlCampaignSchema = z.object({
  id: CampaignV2IdSchema,
  token: AssetIdSchema,
  controllerEntityIds: z.array(z.string().min(1)),
  boundary: CampaignBoundarySchema,
  episodes: z.array(CampaignEpisodeSchema),
  tacticFindingIds: z.array(FindingIdSchema),
  supplySnapshotIds: z.array(z.string()),
  capitalLedgerId: knowledgeValueSchema(z.string()),
  profitReportId: knowledgeValueSchema(z.string()),
  evidenceClosure: z.array(EvidenceIdSchema).min(1),
  status: CampaignStatusSchema,
  compatibleControlCampaignId: z.string().optional(),
});
export type MarketControlCampaign = z.infer<typeof MarketControlCampaignSchema>;

export const CampaignIntelligencePayloadSchema = z.object({
  campaigns: z.array(MarketControlCampaignSchema),
  tactics: z.array(TacticHypothesisSchema),
  unattributedEventCount: z.number().int().nonnegative(),
});
export type CampaignIntelligencePayload = z.infer<typeof CampaignIntelligencePayloadSchema>;
