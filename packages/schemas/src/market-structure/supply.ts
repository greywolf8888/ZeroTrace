import { z } from 'zod';

import {
  AssetIdSchema,
  CellIdSchema,
  EvidenceIdSchema,
  LotIdSchema,
  UnsignedQuantityStringSchema,
} from './foundation.js';
import { AnalysisSnapshotSchema } from './foundation.js';

export const CustodyTypeSchema = z.enum([
  'WALLET',
  'POOL_RESERVE',
  'LP_POSITION',
  'BURN_PROVABLE',
  'BURN_CONVENTIONAL',
  'VESTING',
  'LOCKER',
  'BRIDGE_ESCROW',
  'WRAPPED_MINT',
  'CEX_CUSTODY',
  'PROTOCOL_CUSTODY',
  'UNKNOWN',
]);
export type CustodyType = z.infer<typeof CustodyTypeSchema>;

export const EconomicControllerSchema = z.enum([
  'CONFIRMED_CONTROLLER',
  'PROBABLE_CONTROLLER',
  'HIDDEN_AFFILIATE',
  'COORDINATED',
  'INDEPENDENT',
  'SERVICE',
  'UNKNOWN',
]);
export type EconomicController = z.infer<typeof EconomicControllerSchema>;

export const LiquidityStatusSchema = z.enum([
  'SELLABLE_NOW',
  'TRANSFERABLE_NO_ROUTE',
  'UNLOCK_REQUIRED',
  'LP_WITHDRAWAL_REQUIRED',
  'CLAIM_REQUIRED',
  'FROZEN',
  'BLACKLISTED',
  'UNSPENDABLE',
  'UNKNOWN',
]);
export type LiquidityStatus = z.infer<typeof LiquidityStatusSchema>;

export const SupplyCellSchema = z.object({
  id: CellIdSchema,
  token: AssetIdSchema,
  snapshot: AnalysisSnapshotSchema,
  amountAtomic: UnsignedQuantityStringSchema,
  owner: z.string().min(1),
  custodyType: CustodyTypeSchema,
  economicController: EconomicControllerSchema,
  liquidityStatus: LiquidityStatusSchema,
  roleAssessmentIds: z.array(z.string()),
  lotIds: z.array(LotIdSchema),
  evidenceIds: z.array(EvidenceIdSchema).min(1),
  matchedBridgeCellId: CellIdSchema.optional(),
});
export type SupplyCell = z.infer<typeof SupplyCellSchema>;

export const SupplyConservationSchema = z.object({
  protocolSupplyAtomic: UnsignedQuantityStringSchema,
  explainedSupplyAtomic: UnsignedQuantityStringSchema,
  unknownDifferenceAtomic: UnsignedQuantityStringSchema,
  burnAlreadyReflectedInSupply: z.boolean(),
  matchedBridgeDedupAtomic: UnsignedQuantityStringSchema,
  identityHolds: z.boolean(),
});
export type SupplyConservation = z.infer<typeof SupplyConservationSchema>;

export const ExecutableSellableSupplySchema = z.object({
  sellableNowAtomic: UnsignedQuantityStringSchema,
  transferableNoRouteAtomic: UnsignedQuantityStringSchema,
  unlockDependentAtomic: UnsignedQuantityStringSchema,
  lpWithdrawalRequiredAtomic: UnsignedQuantityStringSchema,
  claimRequiredAtomic: UnsignedQuantityStringSchema,
  frozenOrBlacklistedAtomic: UnsignedQuantityStringSchema,
  unspendableAtomic: UnsignedQuantityStringSchema,
  unknownSellabilityAtomic: UnsignedQuantityStringSchema,
});
export type ExecutableSellableSupply = z.infer<typeof ExecutableSellableSupplySchema>;

export const SupplyRealityPayloadSchema = z.object({
  token: AssetIdSchema,
  cells: z.array(SupplyCellSchema),
  conservation: SupplyConservationSchema,
  executable: ExecutableSellableSupplySchema,
  historicalMintAtomic: UnsignedQuantityStringSchema,
  historicalBurnAtomic: UnsignedQuantityStringSchema,
  originCoverageComplete: z.boolean(),
});
export type SupplyRealityPayload = z.infer<typeof SupplyRealityPayloadSchema>;
