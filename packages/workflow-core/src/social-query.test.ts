import { describe, expect, it } from 'vitest';

import { buildIdentityQueries, compileApprovedQuery } from './social-query.js';

const bsc = {
  chain: 'BSC' as const,
  address: `0x${'AB'.repeat(20)}`,
};

describe('approved social query compiler', () => {
  it('builds bounded BSC and Solana identity queries without changing provider syntax', () => {
    const bscResult = buildIdentityQueries(
      {
        ...bsc,
        verifiedHandle: 'ZeroTrace_1',
        aliases: Array.from({ length: 9 }, (_, i) => `别名${i}`),
      },
      'query-v1',
    );
    expect(bscResult.assetKey).toBe(`BSC:${bsc.address.toLowerCase()}`);
    expect(bscResult.queries).toHaveLength(11);
    expect(bscResult.queries[2]).toEqual({
      role: 'DECLARED_ACCOUNT',
      query: 'from:ZeroTrace_1',
    });
    expect(
      buildIdentityQueries({ chain: 'SOLANA', address: '1'.repeat(32) }, 'query-v1'),
    ).toMatchObject({
      assetKey: `SOLANA:${'1'.repeat(32)}`,
      queries: [{ role: 'IDENTITY' }, { role: 'COUNTEREVIDENCE' }],
    });
    expect(compileApprovedQuery('from:ZeroTrace_1', 100, 'query-v1')).toBe('from:ZeroTrace_1');
  });

  it('rejects missing versions, invalid ledger addresses, and invalid handles', () => {
    expect(() => buildIdentityQueries(bsc, '')).toThrow('QUERY_VERSION_REQUIRED');
    expect(() => buildIdentityQueries({ ...bsc, address: '0x01' }, 'query-v1')).toThrow(
      'INVALID_CHAIN_ADDRESS',
    );
    expect(() =>
      buildIdentityQueries({ chain: 'SOLANA', address: '0'.repeat(32) }, 'query-v1'),
    ).toThrow('INVALID_CHAIN_ADDRESS');
    expect(() =>
      buildIdentityQueries({ ...bsc, verifiedHandle: 'invalid-handle' }, 'query-v1'),
    ).toThrow('INVALID_HANDLE');
  });

  it('rejects blank, oversized, quoted, escaped, and control-character terms', () => {
    for (const alias of [
      ' ',
      'x'.repeat(161),
      'bad"term',
      'bad\\term',
      `bad${String.fromCharCode(1)}term`,
    ]) {
      expect(() => buildIdentityQueries({ ...bsc, aliases: [alias] }, 'query-v1')).toThrow(
        'UNSAFE_QUERY_TERM',
      );
    }
  });

  it('fails closed for every compile budget and control-character violation', () => {
    for (const [query, maxChars, version] of [
      ['query', 100, ''],
      ['query', 1.5, 'query-v1'],
      ['query', 0, 'query-v1'],
      ['too-long', 3, 'query-v1'],
      ['bad\rquery', 100, 'query-v1'],
      ['bad\nquery', 100, 'query-v1'],
      [`bad${String.fromCharCode(0)}query`, 100, 'query-v1'],
    ] as const) {
      expect(() => compileApprovedQuery(query, maxChars, version)).toThrow(
        'QUERY_NOT_APPROVED_OR_TOO_LONG',
      );
    }
  });
});
