import { z } from 'zod';

import {
  AssetIdSchema,
  CampaignV2IdSchema,
  ChainPositionSchema,
  DecimalRangeSchema,
  DecimalStringSchema,
  EvidenceIdSchema,
  LotIdSchema,
  ScenarioDistributionSchema,
  knowledgeValueSchema,
} from './foundation.js';

export const LotOriginTypeSchema = z.enum([
  'PURCHASE',
  'MINT',
  'CLAIM',
  'TEAM_ALLOCATION',
  'TRANSFER_IN',
  'LP_WITHDRAWAL',
  'BRIDGE_IN',
  'UNKNOWN',
]);
export type LotOriginType = z.infer<typeof LotOriginTypeSchema>;

export const EconomicLotSchema = z.object({
  id: LotIdSchema,
  asset: AssetIdSchema,
  economicOwnerEntityId: z.string().min(1),
  originType: LotOriginTypeSchema,
  originPosition: ChainPositionSchema,
  originalAmountAtomic: z.string(),
  remainingAmountAtomic: z.string(),
  acquisitionCostU: knowledgeValueSchema(DecimalStringSchema),
  transactionCostsU: knowledgeValueSchema(DecimalStringSchema),
  parentLotIds: z.array(LotIdSchema),
  campaignId: knowledgeValueSchema(CampaignV2IdSchema),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});
export type EconomicLot = z.infer<typeof EconomicLotSchema>;

export const CapitalPathSegmentSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  asset: AssetIdSchema,
  amountAtomic: z.string(),
  amountU: knowledgeValueSchema(DecimalStringSchema),
  txId: z.string().min(1),
  position: ChainPositionSchema,
  capacityAtomic: z.string(),
  evidenceIds: z.array(EvidenceIdSchema),
});
export type CapitalPathSegment = z.infer<typeof CapitalPathSegmentSchema>;

export const CapitalAttributionSchema = z.object({
  sourceEventId: z.string().min(1),
  destinationEventId: z.string().min(1),
  assetPath: z.array(AssetIdSchema).min(1),
  amountU: knowledgeValueSchema(DecimalStringSchema),
  attributionMethod: z.enum(['PROPORTIONAL', 'FIFO', 'LIFO', 'TEMPORAL_MAX_FLOW']),
  lowerBoundU: DecimalStringSchema,
  upperBoundU: DecimalStringSchema,
  path: z.array(CapitalPathSegmentSchema),
  boundary: z.enum(['NONE', 'CEX', 'BRIDGE_UNMATCHED', 'PRIVACY_TOOL', 'UNKNOWN']),
  evidenceIds: z.array(EvidenceIdSchema),
});
export type CapitalAttribution = z.infer<typeof CapitalAttributionSchema>;

export const CampaignLedgerAccountSchema = z.enum([
  'EXTERNAL_CAPITAL',
  'CONTROLLER_CASH_U',
  'TOKEN_INVENTORY',
  'LP_POSITION',
  'PROTOCOL_FEE_INCOME',
  'CLAIM_REWARD_INCOME',
  'GAS_EXECUTION_COST',
  'VENUE_BOUNDARY',
  'REALIZED_REVENUE',
  'REALIZED_COST',
  'REALIZED_PNL',
  'UNREALIZED_RV',
]);
export type CampaignLedgerAccount = z.infer<typeof CampaignLedgerAccountSchema>;

export const CampaignLedgerEntrySchema = z.object({
  id: z.string().regex(/^cle_[0-9a-f]{24}$/),
  campaignId: CampaignV2IdSchema,
  debit: CampaignLedgerAccountSchema,
  credit: CampaignLedgerAccountSchema,
  amountU: knowledgeValueSchema(DecimalStringSchema),
  amountAtomic: z.string().optional(),
  asset: AssetIdSchema.optional(),
  lotIds: z.array(LotIdSchema),
  txId: z.string().min(1).optional(),
  internalTransfer: z.boolean(),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
});
export type CampaignLedgerEntry = z.infer<typeof CampaignLedgerEntrySchema>;

export const LedgerReconciliationSchema = z.object({
  balanced: z.boolean(),
  debitSumU: knowledgeValueSchema(DecimalStringSchema),
  creditSumU: knowledgeValueSchema(DecimalStringSchema),
  unmatchedCount: z.number().int().nonnegative(),
});
export type LedgerReconciliation = z.infer<typeof LedgerReconciliationSchema>;

export const CampaignProfitReportSchema = z.object({
  campaignId: CampaignV2IdSchema,
  realizedGrossProceedsU: knowledgeValueSchema(DecimalStringSchema),
  realizedFeeAndTaxIncomeU: knowledgeValueSchema(DecimalStringSchema),
  disposedLotCostU: knowledgeValueSchema(DecimalStringSchema),
  gasAndExecutionCostsU: knowledgeValueSchema(DecimalStringSchema),
  realizedNetProfitU: knowledgeValueSchema(DecimalStringSchema),
  externalCapitalInjectedU: knowledgeValueSchema(DecimalStringSchema),
  confirmedRepatriatedU: knowledgeValueSchema(DecimalStringSchema),
  venueBoundaryProceedsU: knowledgeValueSchema(DecimalRangeSchema),
  remainingInventoryCostU: knowledgeValueSchema(DecimalStringSchema),
  remainingInventoryRvU: knowledgeValueSchema(ScenarioDistributionSchema),
  totalEconomicProfitU: knowledgeValueSchema(ScenarioDistributionSchema),
  roi: knowledgeValueSchema(DecimalRangeSchema),
  ledgerEntries: z.array(CampaignLedgerEntrySchema),
  reconciliation: LedgerReconciliationSchema,
});
export type CampaignProfitReport = z.infer<typeof CampaignProfitReportSchema>;

export const CapitalIntelligencePayloadSchema = z.object({
  lots: z.array(EconomicLotSchema),
  attributions: z.array(CapitalAttributionSchema),
  profit: CampaignProfitReportSchema,
});
export type CapitalIntelligencePayload = z.infer<typeof CapitalIntelligencePayloadSchema>;
