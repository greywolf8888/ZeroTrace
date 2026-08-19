import { describe, expect, it } from 'vitest';

import { createLot, realizeProfit, recordSale, transferLots, buildCapitalReport } from './index.js';

const asset = { ledger: 'EVM' as const, chainId: 'eip155:56', token: `0x${'a'.repeat(40)}` };
const evidence = [`ev_${'1'.repeat(24)}`];
const campaignId = `mcc_${'a'.repeat(24)}`;

function lot(block: string, amount: string, cost: string, owner = 'controller') {
  return createLot({
    asset,
    economicOwnerEntityId: owner,
    originType: 'PURCHASE',
    originPosition: { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: block },
    amountAtomic: amount,
    acquisitionCostU: { state: 'known', value: cost },
    evidenceIds: evidence,
    campaignId,
  });
}

describe('capital intelligence hardening', () => {
  it('FIFO consumes numeric block 9 before block 10', () => {
    const moved = transferLots({
      lots: [lot('10', '10', '10'), lot('9', '10', '100')],
      fromOwner: 'controller',
      toOwner: 'desk',
      amountAtomic: '10',
      policy: 'FIFO',
      position: { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: '11' },
      evidenceIds: evidence,
    });
    expect(moved.created[0]?.acquisitionCostU).toEqual({ state: 'known', value: '100' });
  });

  it('HIFO consumes higher unit cost, not higher total cost', () => {
    const moved = transferLots({
      lots: [lot('1', '100', '100'), lot('2', '10', '50')],
      fromOwner: 'controller',
      toOwner: 'desk',
      amountAtomic: '10',
      policy: 'HIFO',
      position: { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: '3' },
      evidenceIds: evidence,
    });
    expect(moved.created[0]?.acquisitionCostU).toEqual({ state: 'known', value: '50' });
  });

  it('ACTUAL_SOURCE consumes the nominated lot rather than FIFO order', () => {
    const early = lot('1', '10', '10');
    const nominated = lot('9', '10', '77');
    const moved = transferLots({
      lots: [early, nominated],
      fromOwner: 'controller',
      toOwner: 'desk',
      amountAtomic: '10',
      policy: 'ACTUAL_SOURCE',
      sourceLotIds: [nominated.id],
      position: { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: '12' },
      evidenceIds: evidence,
    });
    expect(moved.created[0]?.acquisitionCostU).toEqual({ state: 'known', value: '77' });
  });

  it('flags unbalanced same-account journals instead of hard-coding unmatchedCount 0', () => {
    const profit = realizeProfit({
      campaignId,
      entries: [
        {
          id: `cle_${'1'.repeat(24)}`,
          campaignId: campaignId as `mcc_${string}`,
          debit: 'CONTROLLER_CASH_U',
          credit: 'CONTROLLER_CASH_U',
          amountU: { state: 'known', value: '10' },
          lotIds: [],
          internalTransfer: false,
          evidenceIds: evidence,
        },
      ],
    });
    expect(profit.reconciliation.balanced).toBe(false);
    expect(profit.reconciliation.unmatchedCount).toBeGreaterThan(0);
  });

  it('records cross-asset attributions instead of an empty array', () => {
    const sale = recordSale({
      campaignId,
      proceedsU: '20',
      lotCostU: '5',
      evidenceIds: evidence,
      lotIds: [lot('1', '5', '5').id],
    });
    const report = buildCapitalReport({
      lots: [],
      entries: sale,
      campaignId,
      swapLinks: [
        {
          sourceEventId: 'swap-in',
          destinationEventId: 'swap-out',
          fromAsset: asset,
          toAsset: { ...asset, token: `0x${'b'.repeat(40)}` },
          amountAtomic: '5',
          amountU: '20',
          txId: `0x${'9'.repeat(64)}`,
          position: { ledger: 'EVM', chainId: 'eip155:56', blockOrSlot: '8' },
        },
      ],
    });
    expect(report.attributions.length).toBeGreaterThan(0);
    expect(report.attributions[0]?.boundary).toBe('NONE');
  });
});
