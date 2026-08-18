import { describe, expect, it } from 'vitest';

import { materializeSupplyReality, supplyCellId } from './index.js';
import type { SupplyCell } from '@zerotrace/schemas';

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '1000',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-19T00:00:00.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unapplied',
};

const token = { ledger: 'EVM' as const, chainId: 'eip155:56', token: `0x${'c'.repeat(40)}` };

function cell(
  partial: Pick<
    SupplyCell,
    'owner' | 'amountAtomic' | 'custodyType' | 'economicController' | 'liquidityStatus'
  > &
    Partial<SupplyCell>,
): SupplyCell {
  const base = {
    token,
    snapshot,
    roleAssessmentIds: [],
    lotIds: [],
    evidenceIds: [`ev_${'1'.repeat(24)}`],
    ...partial,
  };
  return { ...base, id: partial.id ?? supplyCellId(base) };
}

describe('supply reality', () => {
  it('conserves protocol supply and keeps unknown as an explicit remainder', () => {
    const report = materializeSupplyReality({
      token,
      protocolSupplyAtomic: '1000',
      historicalMintAtomic: '1100',
      historicalBurnAtomic: '100',
      burnAlreadyReflectedInSupply: true,
      originCoverageComplete: true,
      cells: [
        cell({
          owner: 'controller',
          amountAtomic: '400',
          custodyType: 'WALLET',
          economicController: 'CONFIRMED_CONTROLLER',
          liquidityStatus: 'SELLABLE_NOW',
        }),
        cell({
          owner: 'pool',
          amountAtomic: '300',
          custodyType: 'POOL_RESERVE',
          economicController: 'SERVICE',
          liquidityStatus: 'LP_WITHDRAWAL_REQUIRED',
        }),
        cell({
          owner: '0x000000000000000000000000000000000000dead',
          amountAtomic: '100',
          custodyType: 'BURN_PROVABLE',
          economicController: 'UNKNOWN',
          liquidityStatus: 'UNSPENDABLE',
        }),
      ],
    });
    expect(report.conservation.explainedSupplyAtomic).toBe('700');
    expect(report.conservation.unknownDifferenceAtomic).toBe('300');
    expect(report.conservation.identityHolds).toBe(true);
    expect(report.executable.sellableNowAtomic).toBe('400');
    expect(report.executable.unspendableAtomic).toBe('0');
  });

  it('does not double-count a matched wrapped/bridge representation', () => {
    const wrapped = cell({
      owner: 'bridge',
      amountAtomic: '50',
      custodyType: 'WRAPPED_MINT',
      economicController: 'SERVICE',
      liquidityStatus: 'UNKNOWN',
    });
    const escrow = cell({
      owner: 'escrow',
      amountAtomic: '50',
      custodyType: 'BRIDGE_ESCROW',
      economicController: 'SERVICE',
      liquidityStatus: 'UNKNOWN',
      matchedBridgeCellId: wrapped.id,
    });
    const report = materializeSupplyReality({
      token,
      protocolSupplyAtomic: '50',
      historicalMintAtomic: '50',
      historicalBurnAtomic: '0',
      burnAlreadyReflectedInSupply: false,
      originCoverageComplete: false,
      cells: [escrow, wrapped],
    });
    expect(report.conservation.explainedSupplyAtomic).toBe('50');
    expect(report.conservation.matchedBridgeDedupAtomic).toBe('50');
    expect(report.conservation.unknownDifferenceAtomic).toBe('0');
  });

  it('rejects duplicate cells instead of summing the same quantity twice', () => {
    const once = cell({
      owner: 'a',
      amountAtomic: '10',
      custodyType: 'WALLET',
      economicController: 'UNKNOWN',
      liquidityStatus: 'SELLABLE_NOW',
      id: 'cel_aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(() =>
      materializeSupplyReality({
        token,
        protocolSupplyAtomic: '10',
        historicalMintAtomic: '10',
        historicalBurnAtomic: '0',
        burnAlreadyReflectedInSupply: false,
        originCoverageComplete: true,
        cells: [once, { ...once }],
      }),
    ).toThrow(/double-count/);
  });
});
