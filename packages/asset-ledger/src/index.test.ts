import { describe, expect, it } from 'vitest';

import {
  assertNoUnlinkedSwapIncome,
  linkSwapLegs,
  netAtomicFlow,
  type AssetLedgerEvent,
} from './index.js';

const position = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockOrSlot: '100',
};
const asset = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  token: `0x${'a'.repeat(40)}`,
};

function event(
  partial: Partial<AssetLedgerEvent> & Pick<AssetLedgerEvent, 'id' | 'kind' | 'from' | 'to'>,
): AssetLedgerEvent {
  return {
    ledger: 'EVM',
    chainId: 'eip155:56',
    txId: `0x${'1'.repeat(64)}`,
    position,
    asset,
    amountAtomic: '1000',
    internal: false,
    failed: false,
    evidenceIds: [`ev_${'1'.repeat(24)}`],
    ...partial,
  };
}

describe('asset ledger', () => {
  it('links swap legs in one transaction and rejects unlinked swap income', () => {
    const linked = linkSwapLegs({
      txId: `0x${'1'.repeat(64)}`,
      input: event({ id: 'in', kind: 'SWAP_IN', from: 'trader', to: 'pool' }),
      output: event({
        id: 'out',
        kind: 'SWAP_OUT',
        from: 'pool',
        to: 'trader',
        asset: { ...asset, token: `0x${'b'.repeat(40)}` },
      }),
      evidenceIds: [`ev_${'1'.repeat(24)}`],
    });
    expect(linked.input.swapGroupId).toEqual(linked.output.swapGroupId);
    assertNoUnlinkedSwapIncome([linked.input, linked.output]);
    expect(() =>
      assertNoUnlinkedSwapIncome([
        event({ id: 'orphan', kind: 'SWAP_OUT', from: 'pool', to: 'trader' }),
      ]),
    ).toThrow(/missing an explicit swap group/);
  });

  it('does not treat failed execution as a completed swap', () => {
    expect(() =>
      linkSwapLegs({
        txId: `0x${'1'.repeat(64)}`,
        input: event({ id: 'in', kind: 'SWAP_IN', from: 'trader', to: 'pool', failed: true }),
        output: event({ id: 'out', kind: 'SWAP_OUT', from: 'pool', to: 'trader' }),
        evidenceIds: [`ev_${'1'.repeat(24)}`],
      }),
    ).toThrow(/Failed execution/);
  });

  it('nets owner flows without coercing missing events to zero profit', () => {
    const events = [
      event({ id: 'a', kind: 'TRANSFER', from: 'x', to: 'owner', amountAtomic: '5' }),
      event({ id: 'b', kind: 'TRANSFER', from: 'owner', to: 'y', amountAtomic: '2' }),
    ];
    expect(netAtomicFlow(events, 'owner', asset).toString()).toBe('3');
  });
});
