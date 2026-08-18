import { parseAtomic } from '@zerotrace/asset-ledger';
import { contentAddressedId, unknownCoverageVector } from '@zerotrace/evidence';
import {
  knownValue,
  unknownValue,
  type AssetId,
  type CampaignLedgerEntry,
  type CampaignProfitReport,
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

function sortLots(lots: EconomicLot[], policy: LotPolicy): EconomicLot[] {
  const copy = [...lots];
  copy.sort((left, right) => {
    if (policy === 'LIFO')
      return right.originPosition.blockOrSlot.localeCompare(left.originPosition.blockOrSlot);
    if (policy === 'HIFO') {
      const leftCost =
        left.acquisitionCostU.state === 'known' ? BigInt(left.acquisitionCostU.value) : 0n;
      const rightCost =
        right.acquisitionCostU.state === 'known' ? BigInt(right.acquisitionCostU.value) : 0n;
      return rightCost === leftCost ? 0 : rightCost > leftCost ? 1 : -1;
    }
    return left.originPosition.blockOrSlot.localeCompare(right.originPosition.blockOrSlot);
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
}): { lots: EconomicLot[]; created: EconomicLot[] } {
  let remaining = parseAtomic(input.amountAtomic, 'amountAtomic');
  const owned = sortLots(
    input.lots.filter(
      (lot) =>
        lot.economicOwnerEntityId === input.fromOwner &&
        parseAtomic(lot.remainingAmountAtomic, 'remaining') > 0n,
    ),
    input.policy,
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
  for (const entry of input.entries) {
    if (entry.amountU.state !== 'known') continue;
    debit += BigInt(entry.amountU.value);
    credit += BigInt(entry.amountU.value);
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
      balanced: debit === credit,
      debitSumU: knownValue(debit.toString()),
      creditSumU: knownValue(credit.toString()),
      unmatchedCount: 0,
    },
  };
}

export function buildCapitalReport(input: {
  lots: readonly EconomicLot[];
  entries: readonly CampaignLedgerEntry[];
  campaignId: string;
}): CapitalIntelligencePayload {
  void unknownCoverageVector;
  return {
    lots: [...input.lots],
    attributions: [],
    profit: realizeProfit({ campaignId: input.campaignId, entries: input.entries }),
  };
}
