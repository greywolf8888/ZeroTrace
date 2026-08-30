import { describe, it, expect } from 'vitest';
import {
  executeConstantProduct,
  executeConcentratedV3,
  executeStableSwap,
  atomicDistribution,
} from './math.js';
describe('V9 numeric safety repairs', () => {
  it('retains fee numerator until the final integer division', () => {
    const x = 100n,
      y = 100n,
      a = 10n,
      f = 25n;
    expect(
      executeConstantProduct({ baseReserve: x, quoteReserve: y, amountIn: a, feeBps: f }).amountOut,
    ).toBe((a * (10000n - f) * y) / (x * 10000n + a * (10000n - f)));
  });
  it('moves price up for token1 input', () => {
    const q = 2n ** 96n;
    expect(
      executeConcentratedV3({
        liquidity: 1000000n,
        sqrtPriceX96: q,
        amountIn: 1000n,
        feeBps: 0n,
        zeroForOne: false,
      }).sqrtPriceX96,
    ).toBeGreaterThan(q);
  });
  it('never returns the historical negative-reserve StableSwap result', () => {
    expect(
      executeStableSwap({
        x: 1000000n,
        y: 1000000n,
        amountIn: 1000n,
        amplification: 100n,
        feeBps: 0n,
      }),
    ).toEqual({ amountOut: 999n, x: 1001000n, y: 999001n });
  });
  it('does not turn unavailable quantiles into zero', () => {
    expect(() => atomicDistribution([], 1)).toThrow(/INSUFFICIENT_DATA/);
    expect(atomicDistribution([0n], 1).p50).toBe('0');
  });
});
