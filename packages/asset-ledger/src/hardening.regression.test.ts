import { describe, expect, it } from 'vitest';

import { matchBridgePair, netAtomicFlow, type AssetLedgerEvent } from './index.js';

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

describe('asset ledger hardening', () => {
  it('rejects bridge pairs that only share event kinds', () => {
    expect(() =>
      matchBridgePair(
        event({
          id: 'dep',
          kind: 'BRIDGE_DEPOSIT',
          from: 'user',
          to: 'bridge',
          amountAtomic: '100',
        }),
        event({
          id: 'rel',
          kind: 'BRIDGE_RELEASE',
          from: 'bridge',
          to: 'user',
          amountAtomic: '90',
          chainId: 'eip155:1',
          asset: { ledger: 'EVM', chainId: 'eip155:1', token: `0x${'b'.repeat(40)}` },
        }),
      ),
    ).toThrow(/amount and asset identity/);
  });

  it('does not net flows from a different ledger, chain, or asset', () => {
    const events = [
      event({ id: 'a', kind: 'TRANSFER', from: 'x', to: 'owner', amountAtomic: '5' }),
      event({
        id: 'b',
        kind: 'TRANSFER',
        from: 'x',
        to: 'owner',
        amountAtomic: '9',
        chainId: 'eip155:1',
        asset: { ledger: 'EVM', chainId: 'eip155:1', token: asset.token },
      }),
    ];
    expect(netAtomicFlow(events, 'owner', asset).toString()).toBe('5');
  });
});
