import { describe, expect, it } from 'vitest';

import { ProviderCapabilityRegistry } from './registry.js';

describe('ProviderCapabilityRegistry', () => {
  it('separates declared capability from configured provider health', () => {
    const registry = new ProviderCapabilityRegistry([
      {
        id: 'sqd:ethereum-mainnet',
        ledger: 'EVM',
        chainId: 'eip155:1',
        capabilities: ['LOG', 'TRANSACTION'],
        configured: true,
        version: 'sqd-finalized-v1',
      },
      {
        id: 'alchemy:ethereum-mainnet',
        ledger: 'EVM',
        chainId: 'eip155:1',
        capabilities: ['BLOCK', 'RECEIPT', 'TRANSACTION'],
        configured: false,
        version: 'alchemy-json-rpc-v1',
      },
    ]);

    expect(
      registry.resolve({ ledger: 'EVM', chainId: 'eip155:1', capability: 'TRANSACTION' }),
    ).toMatchObject({
      state: 'DECLARED',
      providers: ['sqd:ethereum-mainnet'],
    });
    expect(
      registry.resolve({ ledger: 'EVM', chainId: 'eip155:1', capability: 'RECEIPT' }),
    ).toMatchObject({
      state: 'UNCONFIGURED',
      providers: ['alchemy:ethereum-mainnet'],
    });
    expect(
      registry.resolve({ ledger: 'EVM', chainId: 'eip155:1', capability: 'ARCHIVE' }),
    ).toMatchObject({ state: 'NOT_DECLARED', providers: [] });
  });

  it('rejects duplicate provider declarations and duplicate capabilities', () => {
    expect(
      () =>
        new ProviderCapabilityRegistry([
          {
            id: 'provider',
            ledger: 'EVM',
            chainId: 'eip155:1',
            capabilities: ['LOG', 'LOG'],
            configured: true,
            version: 'v1',
          },
        ]),
    ).toThrow('must not contain duplicates');
  });
});
