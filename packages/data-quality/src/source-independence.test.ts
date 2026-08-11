import { describe, expect, it } from 'vitest';

import { BSC_SOURCE_OPERATOR_REGISTRY, resolveSourceOperators } from './source-independence.js';

describe('source operator registry', () => {
  it('verifies distinct officially registered BSC endpoint operators', () => {
    const result = resolveSourceOperators([
      'bsc-rpc@bnb-mainnet.g.alchemy.com#1',
      'bsc-rpc@bsc-dataseed.bnbchain.org#2',
    ]);

    expect(result.independence).toEqual({ state: 'known', value: true });
    expect(result.distinctOperatorIds).toEqual(['alchemy', 'bnb-chain']);
    expect(result.unresolvedSources).toEqual([]);
    expect(result.matches.map((match) => match.hostname)).toEqual([
      'bnb-mainnet.g.alchemy.com',
      'bsc-dataseed.bnbchain.org',
    ]);
  });

  it('does not mistake two BNB Chain endpoints for operator independence', () => {
    const result = resolveSourceOperators([
      'bsc-rpc@bsc-dataseed.bnbchain.org#1',
      'bsc-rpc@bsc-dataseed-public.bnbchain.org#2',
    ]);

    expect(result.independence).toEqual({ state: 'known', value: false });
    expect(result.distinctOperatorIds).toEqual(['bnb-chain']);
  });

  it('keeps unregistered or malformed source ownership inconclusive', () => {
    const result = resolveSourceOperators([
      'bsc-rpc@bnb-mainnet.g.alchemy.com#1',
      'bsc-rpc@unknown.example#2',
      'not-a-source-id',
    ]);

    expect(result.independence).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(result.unresolvedSources).toEqual(['bsc-rpc@unknown.example#2', 'not-a-source-id']);
  });

  it('rejects conflicting registry ownership', () => {
    expect(() =>
      resolveSourceOperators(
        ['rpc@duplicate.example'],
        [
          ...BSC_SOURCE_OPERATOR_REGISTRY,
          {
            operatorId: 'one',
            operatorName: 'One',
            hostnames: ['duplicate.example'],
            officialSource: 'https://one.example/docs',
            registryObservedAt: '2026-08-11T00:00:00.000Z',
            registryRevision: 'one-v1',
          },
          {
            operatorId: 'two',
            operatorName: 'Two',
            hostnames: ['duplicate.example'],
            officialSource: 'https://two.example/docs',
            registryObservedAt: '2026-08-11T00:00:00.000Z',
            registryRevision: 'two-v1',
          },
        ],
      ),
    ).toThrow('assigns duplicate.example more than once');
  });
});
