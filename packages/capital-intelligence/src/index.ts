import { parseAtomic } from '@zerotrace/asset-ledger';
import { contentAddressedId, unknownCoverageVector } from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type AssetId,
  type CampaignLedgerEntry,
  type CampaignProfitReport,
  type CapitalAttribution,
  type CapitalIntelligencePayload,
  type ChainPosition,
  type EconomicLot,
} from '@zerotrace/schemas';

export const CAPITAL_INTELLIGENCE_MODEL_VERSION = 'capital-intelligence-v1.0.0';

export type LotPolicy = 'FIFO' | 'LIFO' | 'HIFO' | 'ACTUAL_SOURCE';

export interface LotCreateInput {
  asset: AssetId;
  economicOwnerEntityId: string;
  originType: EconomicLot['originType'];
  originPosition: ChainPosition;
  amountAtomic: string;
  acquisitionCostU: EconomicLot['acquisitionCostU'];
  evidenceIds: readonly string[];
  parentLotIds?: readonly string[];
  campaignId?: string;
}

export function createLot(input: LotCreateInput): EconomicLot {
  const amount = parseAtomic(input.amountAtomic, 'amountAtomic');
  const lot: EconomicLot = {
    id: contentAddressedId('lot', input),
    asset: input.asset,
    economicOwnerEntityId: input.economicOwnerEntityId,
    originType: input.originType,
    originPosition: input.originPosition,
    originalAmountAtomic: amount.toString(),
    remainingAmountAtomic: amount.toString(),
    acquisitionCostU: input.acquisitionCostU,
    transactionCostsU: knownValue('0'),
    parentLotIds: [...(input.parentLotIds ?? [])],
    campaignId:
      input.campaignId === undefined
        ? unknownValue('NOT_QUERIED')
        : knownValue(input.campaignId as `mcc_${string}`),
    evidenceIds: [...input.evidenceIds],
  };
  return lot;
}

function compareNumericSlot(left: string, right: string): number {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function lotUnitCost(lot: EconomicLot): bigint {
  const original = parseAtomic(lot.originalAmountAtomic, 'original');
  if (original === 0n) return 0n;
  const cost = lot.acquisitionCostU.state === 'known' ? BigInt(lot.acquisitionCostU.value) : 0n;
  return (cost * 10n ** 18n) / original;
}

function sortLots(
  lots: EconomicLot[],
  policy: LotPolicy,
  sourceLotIds?: readonly string[],
): EconomicLot[] {
  const copy = [...lots];
  if (policy === 'ACTUAL_SOURCE') {
    if (sourceLotIds === undefined || sourceLotIds.length === 0) {
      throw new Error('ACTUAL_SOURCE requires explicit sourceLotIds; refusing FIFO fallback.');
    }
    const order = new Map(sourceLotIds.map((id, index) => [id, index]));
    return copy
      .filter((lot) => order.has(lot.id))
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
  }
  copy.sort((left, right) => {
    if (policy === 'LIFO') {
      return compareNumericSlot(right.originPosition.blockOrSlot, left.originPosition.blockOrSlot);
    }
    if (policy === 'HIFO') {
      const leftUnit = lotUnitCost(left);
      const rightUnit = lotUnitCost(right);
      if (rightUnit !== leftUnit) return rightUnit > leftUnit ? 1 : -1;
    }
    return compareNumericSlot(left.originPosition.blockOrSlot, right.originPosition.blockOrSlot);
  });
  return copy;
}

export function transferLots(input: {
  lots: EconomicLot[];
  fromOwner: string;
  toOwner: string;
  amountAtomic: string;
  policy: LotPolicy;
  position: ChainPosition;
  evidenceIds: readonly string[];
  sourceLotIds?: readonly string[];
}): { lots: EconomicLot[]; created: EconomicLot[] } {
  let remaining = parseAtomic(input.amountAtomic, 'amountAtomic');
  const owned = sortLots(
    input.lots.filter(
      (lot) =>
        lot.economicOwnerEntityId === input.fromOwner &&
        parseAtomic(lot.remainingAmountAtomic, 'remaining') > 0n,
    ),
    input.policy,
    input.sourceLotIds,
  );
  const created: EconomicLot[] = [];
  const updated = input.lots.map((lot) => ({ ...lot }));
  for (const lot of owned) {
    if (remaining === 0n) break;
    const available = parseAtomic(lot.remainingAmountAtomic, 'remaining');
    const take = available < remaining ? available : remaining;
    const target = updated.find((item) => item.id === lot.id);
    if (target === undefined) continue;
    target.remainingAmountAtomic = (available - take).toString();
    const parentCost =
      lot.acquisitionCostU.state === 'known'
        ? (BigInt(lot.acquisitionCostU.value) * take) /
          parseAtomic(lot.originalAmountAtomic, 'original')
        : undefined;
    created.push(
      createLot({
        asset: lot.asset,
        economicOwnerEntityId: input.toOwner,
        originType: 'TRANSFER_IN',
        originPosition: input.position,
        amountAtomic: take.toString(),
        acquisitionCostU:
          parentCost === undefined
            ? unknownValue('INSUFFICIENT_DATA')
            : knownValue(parentCost.toString()),
        evidenceIds: input.evidenceIds,
        parentLotIds: [lot.id],
        ...(lot.campaignId.state === 'known' ? { campaignId: lot.campaignId.value } : {}),
      }),
    );
    remaining -= take;
  }
  if (remaining > 0n) {
    throw new Error('Insufficient lots to transfer; cannot invent cost-zero inventory.');
  }
  return { lots: [...updated, ...created], created };
}

export function recordInternalTransfer(input: {
  campaignId: string;
  asset: AssetId;
  amountAtomic: string;
  evidenceIds: readonly string[];
}): CampaignLedgerEntry {
  return {
    id: contentAddressedId('cle', { ...input, kind: 'internal' }),
    campaignId: input.campaignId as CampaignLedgerEntry['campaignId'],
    debit: 'TOKEN_INVENTORY',
    credit: 'TOKEN_INVENTORY',
    amountU: knownValue('0'),
    amountAtomic: input.amountAtomic,
    asset: input.asset,
    lotIds: [],
    internalTransfer: true,
    evidenceIds: [...input.evidenceIds],
  };
}

export function recordCexBoundary(input: {
  campaignId: string;
  amountU: string;
  evidenceIds: readonly string[];
}): CampaignLedgerEntry {
  return {
    id: contentAddressedId('cle', { ...input, kind: 'cex' }),
    campaignId: input.campaignId as CampaignLedgerEntry['campaignId'],
    debit: 'VENUE_BOUNDARY',
    credit: 'TOKEN_INVENTORY',
    amountU: knownValue(input.amountU),
    lotIds: [],
    internalTransfer: false,
    evidenceIds: [...input.evidenceIds],
  };
}

export function recordSale(input: {
  campaignId: string;
  proceedsU: string;
  lotCostU: string;
  evidenceIds: readonly string[];
  lotIds: readonly string[];
}): CampaignLedgerEntry[] {
  return [
    {
      id: contentAddressedId('cle', { ...input, kind: 'revenue' }),
      campaignId: input.campaignId as CampaignLedgerEntry['campaignId'],
      debit: 'CONTROLLER_CASH_U',
      credit: 'REALIZED_REVENUE',
      amountU: knownValue(input.proceedsU),
      lotIds: [...input.lotIds],
      internalTransfer: false,
      evidenceIds: [...input.evidenceIds],
    },
    {
      id: contentAddressedId('cle', { ...input, kind: 'cost' }),
      campaignId: input.campaignId as CampaignLedgerEntry['campaignId'],
      debit: 'REALIZED_COST',
      credit: 'TOKEN_INVENTORY',
      amountU: knownValue(input.lotCostU),
      lotIds: [...input.lotIds],
      internalTransfer: false,
      evidenceIds: [...input.evidenceIds],
    },
  ];
}

export function realizeProfit(input: {
  campaignId: string;
  entries: readonly CampaignLedgerEntry[];
  remainingInventoryCostU?: string;
}): CampaignProfitReport {
  const knownU = (
    account: CampaignLedgerEntry['credit'] | CampaignLedgerEntry['debit'],
    side: 'credit' | 'debit',
  ): bigint => {
    let sum = 0n;
    for (const entry of input.entries) {
      if (entry.internalTransfer) continue;
      if (entry[side] !== account) continue;
      if (entry.amountU.state !== 'known') continue;
      sum += BigInt(entry.amountU.value);
    }
    return sum;
  };
  const proceeds = knownU('REALIZED_REVENUE', 'credit');
  const fees = knownU('PROTOCOL_FEE_INCOME', 'credit');
  const costs = knownU('REALIZED_COST', 'debit');
  const gas = knownU('GAS_EXECUTION_COST', 'debit');
  const external = knownU('EXTERNAL_CAPITAL', 'credit');
  const venue = knownU('VENUE_BOUNDARY', 'debit');
  const net = proceeds + fees - costs - gas;
  let debit = 0n;
  let credit = 0n;
  let unmatchedCount = 0;
  for (const entry of input.entries) {
    if (entry.internalTransfer) continue;
    if (entry.amountU.state !== 'known') {
      unmatchedCount += 1;
      continue;
    }
    const amount = BigInt(entry.amountU.value);
    if (entry.debit === entry.credit) {
      unmatchedCount += 1;
      continue;
    }
    debit += amount;
    credit += amount;
  }
  return {
    campaignId: input.campaignId as CampaignProfitReport['campaignId'],
    realizedGrossProceedsU: knownValue(proceeds.toString()),
    realizedFeeAndTaxIncomeU: knownValue(fees.toString()),
    disposedLotCostU: knownValue(costs.toString()),
    gasAndExecutionCostsU: knownValue(gas.toString()),
    realizedNetProfitU: knownValue(net.toString()),
    externalCapitalInjectedU: knownValue(external.toString()),
    confirmedRepatriatedU: unknownValue('NOT_QUERIED'),
    venueBoundaryProceedsU: knownValue({ lower: '0', upper: venue.toString() }),
    remainingInventoryCostU:
      input.remainingInventoryCostU === undefined
        ? unknownValue('NOT_QUERIED')
        : knownValue(input.remainingInventoryCostU),
    remainingInventoryRvU: unknownValue('NOT_QUERIED'),
    totalEconomicProfitU: unknownValue('NOT_QUERIED'),
    roi: unknownValue('NOT_QUERIED'),
    ledgerEntries: [...input.entries],
    reconciliation: {
      balanced: unmatchedCount === 0 && debit === credit,
      debitSumU: knownValue(debit.toString()),
      creditSumU: knownValue(credit.toString()),
      unmatchedCount,
    },
  };
}

export interface SwapAttributionLink {
  sourceEventId: string;
  destinationEventId: string;
  fromAsset: AssetId;
  toAsset: AssetId;
  amountAtomic: string;
  amountU: string;
  txId: string;
  position: ChainPosition;
  evidenceIds?: readonly string[];
}

export function buildCapitalReport(input: {
  lots: readonly EconomicLot[];
  entries: readonly CampaignLedgerEntry[];
  campaignId: string;
  swapLinks?: readonly SwapAttributionLink[];
}): CapitalIntelligencePayload {
  void unknownCoverageVector;
  const attributions: CapitalAttribution[] = (input.swapLinks ?? []).map((link) => ({
    sourceEventId: link.sourceEventId,
    destinationEventId: link.destinationEventId,
    assetPath: [link.fromAsset, link.toAsset],
    amountU: knownValue(link.amountU),
    attributionMethod: 'FIFO',
    lowerBoundU: link.amountU,
    upperBoundU: link.amountU,
    path: [
      {
        from: link.sourceEventId,
        to: link.destinationEventId,
        asset: link.toAsset,
        amountAtomic: link.amountAtomic,
        amountU: knownValue(link.amountU),
        txId: link.txId,
        position: link.position,
        capacityAtomic: link.amountAtomic,
        evidenceIds: [...(link.evidenceIds ?? [])],
      },
    ],
    boundary: 'NONE',
    evidenceIds: [...(link.evidenceIds ?? [])],
  }));
  return {
    lots: [...input.lots],
    attributions,
    profit: realizeProfit({ campaignId: input.campaignId, entries: input.entries }),
  };
}
