import { describe, expect, it } from 'vitest';

import {
  createLot,
  realizeProfit,
  recordCexBoundary,
  recordInternalTransfer,
  recordSale,
  transferLots,
} from './index.js';

const asset = { ledger: 'EVM' as const, chainId: 'eip155:56', token: `0x${'a'.repeat(40)}` };
const position = { ledger: 'EVM' as const, chainId: 'eip155:56', blockOrSlot: '10' };
const evidence = [`ev_${'1'.repeat(24)}`];
const campaignId = `mcc_${'a'.repeat(24)}`;

describe('capital intelligence', () => {
  it('inherits cost on internal transfer and records zero profit', () => {
    const parent = createLot({
      asset,
      economicOwnerEntityId: 'controller-a',
      originType: 'PURCHASE',
      originPosition: position,
      amountAtomic: '100',
      acquisitionCostU: { state: 'known', value: '200' },
      evidenceIds: evidence,
      campaignId,
    });
    const moved = transferLots({
      lots: [parent],
      fromOwner: 'controller-a',
      toOwner: 'controller-b',
      amountAtomic: '40',
      policy: 'FIFO',
      position: { ...position, blockOrSlot: '11' },
      evidenceIds: evidence,
    });
    const child = moved.created[0];
    expect(child?.economicOwnerEntityId).toBe('controller-b');
    expect(child?.acquisitionCostU).toEqual({ state: 'known', value: '80' });
    expect(child?.parentLotIds).toEqual([parent.id]);
    const entry = recordInternalTransfer({
      campaignId,
      asset,
      amountAtomic: '40',
      evidenceIds: evidence,
    });
    expect(entry.internalTransfer).toBe(true);
    expect(entry.amountU).toEqual({ state: 'known', value: '0' });
    const profit = realizeProfit({ campaignId, entries: [entry] });
    expect(profit.realizedNetProfitU).toEqual({ state: 'known', value: '0' });
    expect(profit.reconciliation.balanced).toBe(true);
  });

  it('treats CEX deposit as a venue boundary rather than a sale', () => {
    const cex = recordCexBoundary({ campaignId, amountU: '50', evidenceIds: evidence });
    const profit = realizeProfit({ campaignId, entries: [cex] });
    expect(profit.realizedGrossProceedsU).toEqual({ state: 'known', value: '0' });
    expect(profit.venueBoundaryProceedsU.state).toBe('known');
    if (profit.venueBoundaryProceedsU.state === 'known') {
      expect(profit.venueBoundaryProceedsU.value.upper).toBe('50');
    }
  });

  it('computes realized net profit from sale proceeds minus lot cost', () => {
    const sale = recordSale({
      campaignId,
      proceedsU: '150',
      lotCostU: '80',
      evidenceIds: evidence,
      lotIds: [`lot_${'b'.repeat(24)}`],
    });
    const profit = realizeProfit({ campaignId, entries: sale });
    expect(profit.realizedNetProfitU).toEqual({ state: 'known', value: '70' });
    expect(profit.reconciliation.balanced).toBe(true);
  });
});
