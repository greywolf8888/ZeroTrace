import { describe, expect, it } from 'vitest';

import { createSqdProfileRequest, SQD_INGESTION_PROFILES } from './profiles.js';

describe('SQD ingestion profiles', () => {
  it('keeps block-header ingestion explicit and bounded', () => {
    expect(SQD_INGESTION_PROFILES).toEqual(['block-headers', 'transactions']);
    expect(
      createSqdProfileRequest({
        dataset: 'ethereum-mainnet',
        profile: 'block-headers',
        fromBlock: 10,
        toBlock: 12,
      }),
    ).toEqual({ fromBlock: 10, toBlock: 12 });
  });

  it.each([
    {
      dataset: 'ethereum-mainnet' as const,
      expected: ['authorizationList', 'from', 'gasUsed', 'hash', 'input', 'status', 'to', 'value'],
    },
    {
      dataset: 'bitcoin-mainnet' as const,
      expected: ['hash', 'locktime', 'size', 'txid', 'version', 'vsize', 'weight'],
    },
    {
      dataset: 'solana-mainnet' as const,
      expected: [
        'accountKeys',
        'computeUnitsConsumed',
        'err',
        'fee',
        'feePayer',
        'recentBlockhash',
        'signatures',
        'version',
      ],
    },
  ])('requests the documented transaction table and identity fields for $dataset', (fixture) => {
    const request = createSqdProfileRequest({
      dataset: fixture.dataset,
      profile: 'transactions',
      fromBlock: 1,
      toBlock: 1,
    });

    expect(request.requests).toEqual({ transactions: [{}] });
    const selected = Object.entries(request.fields?.transaction ?? {})
      .filter(([, enabled]) => enabled)
      .map(([field]) => field);
    for (const field of fixture.expected) expect(selected).toContain(field);
  });

  it('rejects an unsafe or inverted range', () => {
    expect(() =>
      createSqdProfileRequest({
        dataset: 'solana-mainnet',
        profile: 'transactions',
        fromBlock: 2,
        toBlock: 1,
      }),
    ).toThrow(/range/);
  });
});
