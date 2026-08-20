import { createLot, transferLots } from '@zerotrace/capital-intelligence';
import { hashPayload } from '@zerotrace/evidence';
import { unknownValue, type EconomicLot } from '@zerotrace/schemas';
import type { IndexedTransfer } from '@zerotrace/local-index';

import { ZERO_ADDRESS } from './types.js';

function evidenceId(item: IndexedTransfer): `ev_${string}` {
  return `ev_${hashPayload({
    block: item.blockNumber.toString(10),
    logIndex: item.logIndex,
    transactionHash: item.transactionHash,
  }).slice(0, 24)}`;
}

export function automaticLots(input: {
  chainId: string;
  token: string;
  transfers: readonly IndexedTransfer[];
}): { lots: EconomicLot[]; limitation?: string } {
  let lots: EconomicLot[] = [];
  const asset = { ledger: 'EVM' as const, chainId: input.chainId, token: input.token };
  for (const item of input.transfers) {
    const evidence = evidenceId(item);
    const position = {
      ledger: 'EVM' as const,
      chainId: input.chainId,
      blockOrSlot: item.blockNumber.toString(10),
    };
    if (item.from === ZERO_ADDRESS) {
      lots = [
        ...lots,
        createLot({
          asset,
          economicOwnerEntityId: `addr:${item.to}`,
          originType: 'MINT',
          originPosition: position,
          amountAtomic: item.valueAtomic,
          acquisitionCostU: unknownValue('INSUFFICIENT_DATA'),
          evidenceIds: [evidence],
        }),
      ];
      continue;
    }
    try {
      const moved = transferLots({
        lots,
        fromOwner: `addr:${item.from}`,
        toOwner: `addr:${item.to}`,
        amountAtomic: item.valueAtomic,
        policy: 'FIFO',
        position,
        evidenceIds: [evidence],
      });
      lots = moved.lots;
    } catch {
      return {
        lots,
        limitation: '历史未闭合或库存不足，拒绝发明零成本 Lot。',
      };
    }
  }
  return {
    lots,
    limitation: '自动 Lot 已从转账继承成本；无成交 U 时成本保持未知，不是 0。',
  };
}
