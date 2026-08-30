/**
 * Big-integer research primitives. Inputs are normalized, same-unit reserves.
 * These primitives are not a protocol-specific execution or mainnet-fill proof.
 * V3 covers one active-liquidity segment only; no tick crossing is implemented.
 */
const Q96 = 2n ** 96n;
function nonnegative(value: bigint, name: string): void {
  if (value < 0n) throw new RangeError(`${name} must be non-negative.`);
}
function positive(value: bigint, name: string): void {
  if (value <= 0n) throw new RangeError(`${name} must be positive.`);
}
function validFee(feeBps: bigint): void {
  if (feeBps < 0n || feeBps >= 10_000n) throw new RangeError('feeBps must be in [0, 10000).');
}
function ceilDiv(n: bigint, d: bigint): bigint {
  positive(d, 'denominator');
  return (n + d - 1n) / d;
}
function close(a: bigint, b: bigint): boolean {
  return (a > b ? a - b : b - a) <= 1n;
}
export function executeConstantProduct(input: {
  baseReserve: bigint;
  quoteReserve: bigint;
  amountIn: bigint;
  feeBps: bigint;
}): { amountOut: bigint; baseReserve: bigint; quoteReserve: bigint } {
  positive(input.baseReserve, 'baseReserve');
  positive(input.quoteReserve, 'quoteReserve');
  nonnegative(input.amountIn, 'amountIn');
  validFee(input.feeBps);
  // Keep the fee numerator intact until the final division; early rounding loses output.
  const weighted = input.amountIn * (10_000n - input.feeBps);
  const out = (weighted * input.quoteReserve) / (input.baseReserve * 10_000n + weighted);
  return {
    amountOut: out,
    baseReserve: input.baseReserve + input.amountIn,
    quoteReserve: input.quoteReserve - out,
  };
}
export function executeConcentratedV3(input: {
  liquidity: bigint;
  sqrtPriceX96: bigint;
  amountIn: bigint;
  feeBps: bigint;
  zeroForOne: boolean;
}): { amountOut: bigint; sqrtPriceX96: bigint } {
  positive(input.liquidity, 'active liquidity');
  positive(input.sqrtPriceX96, 'sqrtPriceX96');
  nonnegative(input.amountIn, 'amountIn');
  validFee(input.feeBps);
  const amount = (input.amountIn * (10_000n - input.feeBps)) / 10_000n;
  const l = input.liquidity,
    p = input.sqrtPriceX96;
  if (amount === 0n) return { amountOut: 0n, sqrtPriceX96: p };
  if (input.zeroForOne) {
    const next = ceilDiv(l * Q96 * p, l * Q96 + amount * p);
    return { amountOut: (l * (p - next)) / Q96, sqrtPriceX96: next };
  }
  const next = p + (amount * Q96) / l;
  return { amountOut: (l * (next - p) * Q96) / (next * p), sqrtPriceX96: next };
}
export function stableInvariant(x: bigint, y: bigint, amplification: bigint): bigint {
  positive(x, 'x');
  positive(y, 'y');
  positive(amplification, 'amplification');
  const n = 2n,
    sum = x + y,
    ann = amplification * n;
  let d = sum;
  for (let i = 0; i < 255; i += 1) {
    let dp = (d * d) / (n * x);
    dp = (dp * d) / (n * y);
    const next = ((ann * sum + dp * n) * d) / ((ann - 1n) * d + (n + 1n) * dp);
    if (close(next, d)) return next;
    d = next;
  }
  throw new Error('STABLESWAP_INVARIANT_DID_NOT_CONVERGE');
}
export function executeStableSwap(input: {
  x: bigint;
  y: bigint;
  amountIn: bigint;
  amplification: bigint;
  feeBps: bigint;
}): { amountOut: bigint; x: bigint; y: bigint } {
  nonnegative(input.amountIn, 'amountIn');
  validFee(input.feeBps);
  const d = stableInvariant(input.x, input.y, input.amplification);
  const effective = (input.amountIn * (10_000n - input.feeBps)) / 10_000n;
  if (effective === 0n) return { amountOut: 0n, x: input.x + input.amountIn, y: input.y };
  const xAfter = input.x + effective,
    ann = input.amplification * 2n;
  // Two-coin, normalized-balance StableSwap with an explicitly defined INPUT fee.
  // c must depend on D, xAfter and Ann, never on the unknown y being iterated.
  let c = (d * d) / (xAfter * 2n);
  c = (c * d) / (ann * 2n);
  const b = xAfter + d / ann;
  let y = d,
    converged = false;
  for (let i = 0; i < 255; i += 1) {
    const denominator = 2n * y + b - d;
    positive(denominator, 'stable denominator');
    const next = (y * y + c) / denominator;
    if (close(next, y)) {
      y = next;
      converged = true;
      break;
    }
    y = next;
  }
  if (!converged) throw new Error('STABLESWAP_OUTPUT_DID_NOT_CONVERGE');
  const gross = input.y > y ? input.y - y : 0n;
  const out = gross > 0n ? gross - 1n : 0n; // conservative integer rounding
  if (out < 0n || out >= input.y) throw new Error('STABLESWAP_RESERVE_BOUND');
  // Fee remains in the input reserve. Do not silently remove it from pool accounting.
  return { amountOut: out, x: input.x + input.amountIn, y: input.y - out };
}
export function atomicDistribution(
  values: readonly bigint[],
  seed: number,
): {
  p10: string;
  p50: string;
  p90: string;
  seed: number;
  iterations: number;
} {
  if (values.length === 0) throw new Error('INSUFFICIENT_DATA: no exit scenarios.');
  if (!Number.isSafeInteger(seed)) throw new RangeError('seed must be a safe integer.');
  values.forEach((v) => nonnegative(v, 'realized amount'));
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const at = (p: number): string => sorted[Math.floor((sorted.length - 1) * p)]!.toString();
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9), seed, iterations: values.length };
}
