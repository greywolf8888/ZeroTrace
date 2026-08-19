import { describe, expect, it } from 'vitest';

import { coverageComplete, coverageGaps, MemoryLocalIndex, mergeSpans, tokenKey } from './index.js';

describe('local index coverage', () => {
  it('merges adjacent spans and reports remaining gaps', () => {
    const merged = mergeSpans([
      { startBlock: 10n, endBlock: 20n },
      { startBlock: 21n, endBlock: 30n },
      { startBlock: 40n, endBlock: 42n },
    ]);
    expect(merged).toEqual([
      { startBlock: 10n, endBlock: 30n },
      { startBlock: 40n, endBlock: 42n },
    ]);
    expect(coverageGaps(merged, 1n, 42n)).toEqual([
      { startBlock: 1n, endBlock: 9n },
      { startBlock: 31n, endBlock: 39n },
    ]);
    expect(coverageComplete(merged, 10n, 30n)).toBe(true);
    expect(coverageComplete(merged, 10n, 42n)).toBe(false);
  });

  it('does not treat an unindexed range as an empty holder set', () => {
    const index = new MemoryLocalIndex();
    const key = tokenKey('eip155:56', '0xabc');
    index.putCoverage(key, { startBlock: 100n, endBlock: 110n });
    expect(index.transfers(key)).toEqual([]);
    expect(coverageComplete(index.coverage(key), 100n, 200n)).toBe(false);
  });
});
