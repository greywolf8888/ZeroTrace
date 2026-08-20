import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { detectChangePoints } from '@zerotrace/campaign-intelligence';
import { executeConstantProduct } from '@zerotrace/market-reality-engine';

const RUST_DIFFERENTIAL_TIMEOUT_MS = 120_000;

function rustCompute(op: string, payload: unknown): Record<string, unknown> {
  const raw = execFileSync('cargo', ['run', '-q', '-p', 'zerotrace-compute'], {
    input: JSON.stringify({ op, payload }),
    encoding: 'utf8',
    timeout: 120_000,
  });
  const parsed = JSON.parse(raw) as {
    ok: boolean;
    result?: Record<string, unknown>;
    error?: string;
  };
  if (!parsed.ok || parsed.result === undefined) {
    throw new Error(parsed.error ?? 'rust compute failed');
  }
  return parsed.result;
}

describe('terminal formula differential', () => {
  it(
    'matches constant-product integer kernel with Rust authority',
    () => {
      const ts = executeConstantProduct({
        baseReserve: 1_000_000n,
        quoteReserve: 1_000_000n,
        amountIn: 10_000n,
        feeBps: 25n,
      });
      const rust = rustCompute('constant_product', {
        baseReserve: '1000000',
        quoteReserve: '1000000',
        amountIn: '10000',
        feeBps: '25',
      });
      expect(rust.amountOut).toBe(ts.amountOut.toString());
      expect(rust.baseReserve).toBe(ts.baseReserve.toString());
      expect(rust.quoteReserve).toBe(ts.quoteReserve.toString());
    },
    RUST_DIFFERENTIAL_TIMEOUT_MS,
  );

  it(
    'matches PELT change points with Rust authority',
    () => {
      const series = [
        ...Array.from({ length: 20 }, (_, index) => ({
          position: {
            ledger: 'EVM' as const,
            chainId: 'eip155:56',
            blockOrSlot: String(index),
            txIndex: '0',
          },
          value: index < 10 ? 0 : 10,
        })),
      ];
      const ts = detectChangePoints(series, 3).map((point) => Number(point.position.blockOrSlot));
      const rust = rustCompute('pelt', {
        values: series.map((point) => point.value),
        penalty: 3,
      });
      expect(rust.changePoints).toEqual(ts);
    },
    RUST_DIFFERENTIAL_TIMEOUT_MS,
  );
});
