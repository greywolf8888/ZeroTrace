import {
  quoteConstantProductExit,
  simulateExitRace,
  type ConstantProductPoolSnapshot,
} from '@zerotrace/rv';
import {
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
  type AssetId,
  type ExitCohort,
  type ExitStrategy,
  type MarketWideExitScenario,
  type VenueKind,
  type VenueSnapshot,
} from '@zerotrace/schemas';
import { contentAddressedId } from '@zerotrace/evidence';

export const MARKET_REALITY_MODEL_VERSION = 'market-reality-v1.0.0';

const Q96 = 2n ** 96n;

export function parseAtomic(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value))
    throw new Error(`${field} must be a non-negative integer string.`);
  return BigInt(value);
}

export function executeConstantProduct(input: {
  baseReserve: bigint;
  quoteReserve: bigint;
  amountIn: bigint;
  feeBps: bigint;
}): { amountOut: bigint; baseReserve: bigint; quoteReserve: bigint } {
  if (input.amountIn === 0n) {
    return { amountOut: 0n, baseReserve: input.baseReserve, quoteReserve: input.quoteReserve };
  }
  const effective = (input.amountIn * (10_000n - input.feeBps)) / 10_000n;
  const out = (input.quoteReserve * effective) / (input.baseReserve + effective);
  const capped = out > input.quoteReserve ? input.quoteReserve : out;
  return {
    amountOut: capped,
    baseReserve: input.baseReserve + input.amountIn,
    quoteReserve: input.quoteReserve - capped,
  };
}

export function executeConcentratedV3(input: {
  liquidity: bigint;
  sqrtPriceX96: bigint;
  amountIn: bigint;
  feeBps: bigint;
  zeroForOne: boolean;
}): { amountOut: bigint; sqrtPriceX96: bigint } {
  const feeAdj = (input.amountIn * (10_000n - input.feeBps)) / 10_000n;
  if (input.liquidity === 0n || feeAdj === 0n) {
    return { amountOut: 0n, sqrtPriceX96: input.sqrtPriceX96 };
  }
  const virtualBase = (input.liquidity * Q96) / input.sqrtPriceX96;
  const virtualQuote = (input.liquidity * input.sqrtPriceX96) / Q96;
  const swapped = input.zeroForOne
    ? executeConstantProduct({
        baseReserve: virtualBase,
        quoteReserve: virtualQuote,
        amountIn: feeAdj,
        feeBps: 0n,
      })
    : executeConstantProduct({
        baseReserve: virtualQuote,
        quoteReserve: virtualBase,
        amountIn: feeAdj,
        feeBps: 0n,
      });
  const nextSqrt =
    swapped.baseReserve === 0n ? input.sqrtPriceX96 : (input.liquidity * Q96) / swapped.baseReserve;
  return { amountOut: swapped.amountOut, sqrtPriceX96: nextSqrt };
}

export function executeStableSwap(input: {
  x: bigint;
  y: bigint;
  amountIn: bigint;
  amplification: bigint;
  feeBps: bigint;
}): { amountOut: bigint; x: bigint; y: bigint } {
  const n = 2n;
  const sum = input.x + input.y;
  let d = sum;
  const ann = input.amplification * n;
  for (let i = 0; i < 32; i += 1) {
    let dp = d;
    dp = (dp * d) / (n * input.x);
    dp = (dp * d) / (n * input.y);
    const next = ((ann * sum + dp * n) * d) / ((ann - 1n) * d + (n + 1n) * dp);
    if (next > d ? next - d <= 1n : d - next <= 1n) {
      d = next;
      break;
    }
    d = next;
  }
  const xAfter = input.x + (input.amountIn * (10_000n - input.feeBps)) / 10_000n;
  let y = input.y;
  for (let i = 0; i < 32; i += 1) {
    const yPrev = y;
    const c = (d * d * d) / (n * n * xAfter * y);
    const b = xAfter + d / ann;
    y = (d * d + c * y) / (2n * y + b - d);
    if (y > yPrev ? y - yPrev <= 1n : yPrev - y <= 1n) break;
  }
  const out = input.y > y ? input.y - y : 0n;
  return { amountOut: out, x: xAfter, y: input.y - out };
}

export function isolatedRvSumIsIllegal(values: readonly bigint[]): never | void {
  if (values.length > 1) {
    throw new Error('Isolated per-address RV must not be summed into market-wide value.');
  }
}

function xorshift(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a !== undefined && b !== undefined) {
      result[i] = b;
      result[j] = a;
    }
  }
  return result;
}

function orderCohorts(
  cohorts: readonly ExitCohort[],
  strategy: ExitStrategy,
  seed: number,
): ExitCohort[] {
  if (strategy === 'CONTROLLER_FIRST') {
    return [...cohorts].sort((a, b) => Number(a.role === 'RETAIL') - Number(b.role === 'RETAIL'));
  }
  if (strategy === 'RETAIL_FIRST') {
    return [...cohorts].sort(
      (a, b) => Number(a.role === 'CONTROLLER') - Number(b.role === 'CONTROLLER'),
    );
  }
  if (strategy === 'SEEDED_RANDOM') return shuffle(cohorts, xorshift(seed));
  return [...cohorts];
}

export function simulateMarketWideExit(input: {
  token: AssetId;
  snapshot: AnalysisSnapshot;
  venues: VenueSnapshot[];
  cohorts: ExitCohort[];
  strategy: ExitStrategy;
  seed: number;
  metadata: AnalysisMetadata;
  removeLpFirst?: boolean;
}): MarketWideExitScenario {
  isolatedRvSumIsIllegal([]);
  const venue = input.venues[0];
  if (venue === undefined) {
    throw new Error('Market-wide exit requires at least one venue snapshot.');
  }
  let base = parseAtomic(venue.reserves.baseAtomic, 'base');
  let quote = parseAtomic(venue.reserves.quoteAtomic, 'quote');
  const fee = parseAtomic(venue.feeBps, 'feeBps');
  if (input.removeLpFirst || input.strategy === 'ADVERSARIAL_LP_REMOVAL') {
    for (const cohort of input.cohorts) {
      const lp = parseAtomic(cohort.lpTokenAmountAtomic ?? '0', 'lp');
      if (lp === 0n) continue;
      const supply = base + quote === 0n ? 1n : base;
      const withdrawBase = (base * lp) / (supply === 0n ? 1n : supply);
      const withdrawQuote = (quote * lp) / (supply === 0n ? 1n : supply);
      base = base > withdrawBase ? base - withdrawBase : 0n;
      quote = quote > withdrawQuote ? quote - withdrawQuote : 0n;
    }
  }
  const ordered = orderCohorts(input.cohorts, input.strategy, input.seed);
  const cohortResults = [];
  let failedAmount = 0n;
  let total = 0n;
  let executable = 0n;
  for (const cohort of ordered) {
    executable += parseAtomic(cohort.executableAmountAtomic, 'executable');
    if (!venue.sellEnabled) {
      failedAmount += parseAtomic(cohort.executableAmountAtomic, 'executable');
      cohortResults.push({
        cohortId: cohort.id,
        soldAtomic: '0',
        realizedU: '0',
        failed: [
          {
            cohortId: cohort.id,
            remainingAtomic: cohort.executableAmountAtomic,
            reason: 'SELL_DISABLED' as const,
          },
        ],
      });
      continue;
    }
    const amountIn = parseAtomic(cohort.executableAmountAtomic, 'executable');
    const executed =
      venue.kind === 'STABLESWAP'
        ? executeStableSwap({
            x: base,
            y: quote,
            amountIn,
            amplification: parseAtomic(venue.amplification ?? '100', 'A'),
            feeBps: fee,
          })
        : venue.kind === 'CONCENTRATED_V3'
          ? (() => {
              const sqrt = parseAtomic(venue.sqrtPriceX96 ?? Q96.toString(), 'sqrt');
              const liq = base === 0n ? 0n : (base * sqrt) / Q96;
              const step = executeConcentratedV3({
                liquidity: liq,
                sqrtPriceX96: sqrt,
                amountIn,
                feeBps: fee,
                zeroForOne: true,
              });
              const next = executeConstantProduct({
                baseReserve: base,
                quoteReserve: quote,
                amountIn,
                feeBps: fee,
              });
              return {
                amountOut: step.amountOut < next.amountOut ? step.amountOut : next.amountOut,
                x: next.baseReserve,
                y: next.quoteReserve,
              };
            })()
          : executeConstantProduct({
              baseReserve: base,
              quoteReserve: quote,
              amountIn,
              feeBps: fee,
            });
    if ('x' in executed && 'y' in executed) {
      base = executed.x;
      quote = executed.y;
    } else {
      base = executed.baseReserve;
      quote = executed.quoteReserve;
    }
    if (executed.amountOut === 0n && amountIn > 0n) {
      failedAmount += amountIn;
      cohortResults.push({
        cohortId: cohort.id,
        soldAtomic: '0',
        realizedU: '0',
        failed: [
          {
            cohortId: cohort.id,
            remainingAtomic: amountIn.toString(),
            reason: 'INSUFFICIENT_LIQUIDITY' as const,
          },
        ],
      });
      continue;
    }
    total += executed.amountOut;
    cohortResults.push({
      cohortId: cohort.id,
      soldAtomic: amountIn.toString(),
      realizedU: executed.amountOut.toString(),
      failed: [],
    });
  }
  const evidenceIds = [...new Set(input.venues.flatMap((item) => [...item.evidenceIds]))].sort();
  return {
    id: contentAddressedId('mwe', {
      token: input.token,
      strategy: input.strategy,
      seed: input.seed,
      total: total.toString(),
    }),
    token: input.token,
    snapshot: input.snapshot,
    executableSupplyAtomic: executable.toString(),
    participantCohorts: [...input.cohorts],
    venueStates: input.venues,
    strategy: input.strategy,
    totalRealizedU: total.toString(),
    cohortResults,
    failedAmountAtomic: failedAmount.toString(),
    finalReferencePriceU:
      quote === 0n || base === 0n
        ? unknownValue('NOT_APPLICABLE')
        : knownValue(((quote * 10n ** 18n) / base).toString()),
    isolatedRvSumRejected: true,
    peg: [
      {
        asset: venue.quoteToken,
        includeInU: true,
        pegDeviationBps: knownValue('0'),
        liquidityAtomic: knownValue(quote.toString()),
        source: 'venue-snapshot',
        evidenceIds,
      },
    ],
    evidenceIds,
  };
}

export function reproducibleDistribution(
  runs: readonly MarketWideExitScenario[],
  seed: number,
): { p10: string; p50: string; p90: string; seed: number; iterations: number } {
  const values = runs
    .map((run) => BigInt(run.totalRealizedU))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const at = (p: number): string => {
    const index = Math.floor((values.length - 1) * p);
    return (values[index] ?? 0n).toString();
  };
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9), seed, iterations: runs.length };
}

export function wrapLegacyExitRace(
  pool: ConstantProductPoolSnapshot,
  metadata: AnalysisMetadata,
  participants: Array<{ id: string; inputQuantity: string }>,
  seed: number,
) {
  return simulateExitRace({
    pool,
    participants,
    order: 'RANDOM',
    seed,
    iterations: 32,
    metadata,
  });
}

export function wrapLegacyQuote(
  pool: ConstantProductPoolSnapshot,
  inputQuantity: string,
  metadata: AnalysisMetadata,
) {
  return quoteConstantProductExit({ pool, inputQuantity, metadata });
}

export type { VenueKind };
