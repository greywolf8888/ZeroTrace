import { contentAddressedId } from '@zerotrace/evidence';
import { parseAtomic } from '@zerotrace/asset-ledger';
import {
  SupplyCellSchema,
  SupplyRealityPayloadSchema,
  type AssetId,
  type SupplyCell,
  type SupplyRealityPayload,
} from '@zerotrace/schemas';

export const SUPPLY_REALITY_MODEL_VERSION = 'supply-reality-v1.0.0';

export interface SupplyRealityInput {
  token: AssetId;
  protocolSupplyAtomic: string;
  historicalMintAtomic: string;
  historicalBurnAtomic: string;
  burnAlreadyReflectedInSupply: boolean;
  originCoverageComplete: boolean;
  cells: readonly SupplyCell[];
}

function uniqueKey(cell: SupplyCell): string {
  return [
    cell.owner,
    cell.custodyType,
    cell.economicController,
    cell.liquidityStatus,
    cell.matchedBridgeCellId ?? '',
  ].join(':');
}

export function materializeSupplyReality(input: SupplyRealityInput): SupplyRealityPayload {
  const protocol = parseAtomic(input.protocolSupplyAtomic, 'protocolSupplyAtomic');
  const seen = new Set<string>();
  const cells: SupplyCell[] = [];
  const skippedBridge = new Set<string>();
  for (const raw of input.cells) {
    const cell = SupplyCellSchema.parse(raw);
    if (cell.token.token !== input.token.token || cell.token.chainId !== input.token.chainId) {
      throw new Error('Supply cell token does not match the report subject.');
    }
    const key = `${cell.id}:${uniqueKey(cell)}`;
    if (seen.has(key) || seen.has(cell.id)) {
      throw new Error(`Supply cell ${cell.id} would double-count the same quantity.`);
    }
    seen.add(key);
    seen.add(cell.id);
    cells.push(cell);
    if (cell.matchedBridgeCellId !== undefined) skippedBridge.add(cell.matchedBridgeCellId);
  }

  let explained = 0n;
  let matchedBridgeDedup = 0n;
  for (const cell of cells) {
    const amount = parseAtomic(cell.amountAtomic, 'amountAtomic');
    if (input.burnAlreadyReflectedInSupply && cell.custodyType === 'BURN_PROVABLE') {
      continue;
    }
    if (skippedBridge.has(cell.id)) {
      matchedBridgeDedup += amount;
      continue;
    }
    explained += amount;
  }

  const unknown = protocol >= explained ? protocol - explained : 0n;
  const identityHolds = protocol >= explained;

  const sum = (status: SupplyCell['liquidityStatus']): bigint =>
    cells
      .filter((cell) => {
        if (skippedBridge.has(cell.id)) return false;
        if (input.burnAlreadyReflectedInSupply && cell.custodyType === 'BURN_PROVABLE')
          return false;
        return cell.liquidityStatus === status;
      })
      .reduce((acc, cell) => acc + parseAtomic(cell.amountAtomic, 'amountAtomic'), 0n);

  return SupplyRealityPayloadSchema.parse({
    token: input.token,
    cells,
    conservation: {
      protocolSupplyAtomic: protocol.toString(),
      explainedSupplyAtomic: explained.toString(),
      unknownDifferenceAtomic: unknown.toString(),
      burnAlreadyReflectedInSupply: input.burnAlreadyReflectedInSupply,
      matchedBridgeDedupAtomic: matchedBridgeDedup.toString(),
      identityHolds,
    },
    executable: {
      sellableNowAtomic: sum('SELLABLE_NOW').toString(),
      transferableNoRouteAtomic: sum('TRANSFERABLE_NO_ROUTE').toString(),
      unlockDependentAtomic: sum('UNLOCK_REQUIRED').toString(),
      lpWithdrawalRequiredAtomic: sum('LP_WITHDRAWAL_REQUIRED').toString(),
      claimRequiredAtomic: sum('CLAIM_REQUIRED').toString(),
      frozenOrBlacklistedAtomic: (sum('FROZEN') + sum('BLACKLISTED')).toString(),
      unspendableAtomic: sum('UNSPENDABLE').toString(),
      unknownSellabilityAtomic: sum('UNKNOWN').toString(),
    },
    historicalMintAtomic: input.historicalMintAtomic,
    historicalBurnAtomic: input.historicalBurnAtomic,
    originCoverageComplete: input.originCoverageComplete,
  });
}

export function supplyCellId(cell: Omit<SupplyCell, 'id'>): string {
  return contentAddressedId('cel', cell);
}
