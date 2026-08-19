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
  type ExitFailure,
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

interface VenueRuntime {
  snapshot: VenueSnapshot;
  base: bigint;
  quote: bigint;
  fee: bigint;
  blockedReason?: ExitFailure['reason'];
}

function quoteSettlesInU(venue: VenueSnapshot): boolean {
  return venue.quoteSettlesInU === true;
}

function v3ExactReady(venue: VenueSnapshot): boolean {
  return (
    venue.kind !== 'CONCENTRATED_V3' ||
    (venue.tick !== undefined &&
      venue.tickLiquidityNet !== undefined &&
      venue.v3RangeComplete === true)
  );
}

function initVenues(venues: readonly VenueSnapshot[]): VenueRuntime[] {
  return venues.map((snapshot) => {
    const blockedReason: ExitFailure['reason'] | undefined = snapshot.blacklisted
      ? 'BLACKLIST'
      : !v3ExactReady(snapshot)
        ? 'UNKNOWN_CONSTRAINT'
        : undefined;
    return {
      snapshot,
      base: parseAtomic(snapshot.reserves.baseAtomic, 'base'),
      quote: parseAtomic(snapshot.reserves.quoteAtomic, 'quote'),
      fee: parseAtomic(snapshot.feeBps, 'feeBps'),
      ...(blockedReason === undefined ? {} : { blockedReason }),
    };
  });
}

function previewOut(runtime: VenueRuntime, amountIn: bigint): bigint {
  if (runtime.blockedReason !== undefined || amountIn === 0n) return 0n;
  if (!runtime.snapshot.sellEnabled) return 0n;
  const taxBps = parseAtomic(runtime.snapshot.sellTaxBps ?? '0', 'sellTaxBps');
  const taxed = (amountIn * (10_000n - taxBps)) / 10_000n;
  if (taxed === 0n) return 0n;
  if (runtime.snapshot.kind === 'STABLESWAP') {
    return executeStableSwap({
      x: runtime.base,
      y: runtime.quote,
      amountIn: taxed,
      amplification: parseAtomic(runtime.snapshot.amplification ?? '100', 'A'),
      feeBps: runtime.fee,
    }).amountOut;
  }
  if (runtime.snapshot.kind === 'CONCENTRATED_V3') {
    const sqrt = parseAtomic(runtime.snapshot.sqrtPriceX96 ?? Q96.toString(), 'sqrt');
    const liquidityNet = parseAtomic(runtime.snapshot.tickLiquidityNet ?? '0', 'tickLiquidityNet');
    const step = executeConcentratedV3({
      liquidity: liquidityNet,
      sqrtPriceX96: sqrt,
      amountIn: taxed,
      feeBps: runtime.fee,
      zeroForOne: true,
    });
    return step.amountOut > runtime.quote ? runtime.quote : step.amountOut;
  }
  return executeConstantProduct({
    baseReserve: runtime.base,
    quoteReserve: runtime.quote,
    amountIn: taxed,
    feeBps: runtime.fee,
  }).amountOut;
}

function applyOut(runtime: VenueRuntime, amountIn: bigint): bigint {
  const out = previewOut(runtime, amountIn);
  if (out === 0n) return 0n;
  const taxBps = parseAtomic(runtime.snapshot.sellTaxBps ?? '0', 'sellTaxBps');
  const taxed = (amountIn * (10_000n - taxBps)) / 10_000n;
  if (runtime.snapshot.kind === 'STABLESWAP') {
    const executed = executeStableSwap({
      x: runtime.base,
      y: runtime.quote,
      amountIn: taxed,
      amplification: parseAtomic(runtime.snapshot.amplification ?? '100', 'A'),
      feeBps: runtime.fee,
    });
    runtime.base = executed.x;
    runtime.quote = executed.y;
    return executed.amountOut;
  }
  if (runtime.snapshot.kind === 'CONCENTRATED_V3') {
    runtime.base += taxed;
    runtime.quote = runtime.quote > out ? runtime.quote - out : 0n;
    return out;
  }
  const executed = executeConstantProduct({
    baseReserve: runtime.base,
    quoteReserve: runtime.quote,
    amountIn: taxed,
    feeBps: runtime.fee,
  });
  runtime.base = executed.baseReserve;
  runtime.quote = executed.quoteReserve;
  return executed.amountOut;
}

function cappedTake(runtime: VenueRuntime, remaining: bigint): bigint {
  let take = remaining;
  if (runtime.snapshot.maxSellAtomic !== undefined) {
    const max = parseAtomic(runtime.snapshot.maxSellAtomic, 'maxSellAtomic');
    if (take > max) take = max;
  }
  return take;
}

function routeSell(
  runtimes: VenueRuntime[],
  amountIn: bigint,
): { sold: bigint; realizedU: bigint; reason?: ExitFailure['reason'] } {
  let remaining = amountIn;
  let sold = 0n;
  let realizedU = 0n;
  while (remaining > 0n) {
    let bestIndex = -1;
    let bestOut = 0n;
    let bestTake = 0n;
    for (const [index, runtime] of runtimes.entries()) {
      if (runtime.blockedReason !== undefined) continue;
      if (!runtime.snapshot.sellEnabled) continue;
      const take = cappedTake(runtime, remaining);
      if (take === 0n) continue;
      const out = previewOut(runtime, take);
      if (out > bestOut) {
        bestOut = out;
        bestIndex = index;
        bestTake = take;
      }
    }
    if (bestIndex < 0 || bestOut === 0n) break;
    const runtime = runtimes[bestIndex];
    if (runtime === undefined) break;
    const out = applyOut(runtime, bestTake);
    sold += bestTake;
    remaining -= bestTake;
    if (quoteSettlesInU(runtime.snapshot)) realizedU += out;
  }
  if (remaining === 0n) return { sold, realizedU };
  const blocked = runtimes.find((item) => item.blockedReason !== undefined)?.blockedReason;
  const disabled = runtimes.every((item) => !item.snapshot.sellEnabled);
  const blacklisted = runtimes.every((item) => item.snapshot.blacklisted === true);
  const reason: ExitFailure['reason'] =
    blocked ?? (blacklisted ? 'BLACKLIST' : disabled ? 'SELL_DISABLED' : 'INSUFFICIENT_LIQUIDITY');
  return { sold, realizedU, reason };
}

function withdrawLp(runtimes: VenueRuntime[], cohorts: readonly ExitCohort[]): void {
  const target = [...runtimes]
    .filter(
      (item) => item.snapshot.lpTotalSupplyAtomic !== undefined && item.blockedReason === undefined,
    )
    .sort((left, right) => (right.quote === left.quote ? 0 : right.quote > left.quote ? 1 : -1))[0];
  if (target === undefined || target.snapshot.lpTotalSupplyAtomic === undefined) return;
  const supply = parseAtomic(target.snapshot.lpTotalSupplyAtomic, 'lpTotalSupplyAtomic');
  if (supply === 0n) return;
  for (const cohort of cohorts) {
    const lp = parseAtomic(cohort.lpTokenAmountAtomic ?? '0', 'lp');
    if (lp === 0n) continue;
    const withdrawBase = (target.base * lp) / supply;
    const withdrawQuote = (target.quote * lp) / supply;
    target.base = target.base > withdrawBase ? target.base - withdrawBase : 0n;
    target.quote = target.quote > withdrawQuote ? target.quote - withdrawQuote : 0n;
  }
}

const PRO_RATA_STEPS = 256n;

function sellCohortAmount(
  runtimes: VenueRuntime[],
  amountIn: bigint,
  cohortId: string,
): {
  soldAtomic: string;
  realizedU: string;
  failed: Array<{ cohortId: string; remainingAtomic: string; reason: ExitFailure['reason'] }>;
  leftover: bigint;
} {
  if (amountIn === 0n) {
    return { soldAtomic: '0', realizedU: '0', failed: [], leftover: 0n };
  }
  const routed = routeSell(runtimes, amountIn);
  const leftover = amountIn - routed.sold;
  const failed =
    leftover > 0n
      ? [
          {
            cohortId,
            remainingAtomic: leftover.toString(),
            reason: routed.reason ?? 'INSUFFICIENT_LIQUIDITY',
          },
        ]
      : [];
  return {
    soldAtomic: routed.sold.toString(),
    realizedU: routed.realizedU.toString(),
    failed,
    leftover,
  };
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
  if (input.venues.length === 0) {
    throw new Error('Market-wide exit requires at least one venue snapshot.');
  }
  const runtimes = initVenues(input.venues);
  if (input.removeLpFirst || input.strategy === 'ADVERSARIAL_LP_REMOVAL') {
    withdrawLp(runtimes, input.cohorts);
  }

  const remaining = input.cohorts.map((cohort) =>
    parseAtomic(cohort.executableAmountAtomic, 'executable'),
  );
  const sold = input.cohorts.map(() => 0n);
  const realized = input.cohorts.map(() => 0n);
  const failed: Array<
    Array<{ cohortId: string; remainingAtomic: string; reason: ExitFailure['reason'] }>
  > = input.cohorts.map(() => []);
  const executable = remaining.reduce((acc, value) => acc + value, 0n);

  const applySlice = (index: number, amount: bigint): void => {
    const cohort = input.cohorts[index];
    const current = remaining[index];
    if (cohort === undefined || current === undefined || amount <= 0n || current <= 0n) return;
    const take = amount < current ? amount : current;
    const result = sellCohortAmount(runtimes, take, cohort.id);
    remaining[index] = current - take + result.leftover;
    sold[index] = (sold[index] ?? 0n) + BigInt(result.soldAtomic);
    realized[index] = (realized[index] ?? 0n) + BigInt(result.realizedU);
    if (result.failed.length > 0) {
      failed[index] = [...(failed[index] ?? []), ...result.failed];
    }
  };

  if (input.strategy === 'PRO_RATA') {
    const originals = [...remaining];
    for (let step = 0n; step < PRO_RATA_STEPS; step += 1n) {
      for (const [index, original] of originals.entries()) {
        const slice = original / PRO_RATA_STEPS;
        const extra = step === PRO_RATA_STEPS - 1n ? original % PRO_RATA_STEPS : 0n;
        applySlice(index, slice + extra);
      }
    }
  } else {
    const ordered = orderCohorts(input.cohorts, input.strategy, input.seed);
    for (const cohort of ordered) {
      const index = input.cohorts.findIndex((item) => item.id === cohort.id);
      if (index < 0) continue;
      applySlice(index, remaining[index] ?? 0n);
    }
  }

  const cohortResults = input.cohorts.map((cohort, index) => ({
    cohortId: cohort.id,
    soldAtomic: (sold[index] ?? 0n).toString(),
    realizedU: (realized[index] ?? 0n).toString(),
    failed: failed[index] ?? [],
  }));
  const failedAmount = remaining.reduce((acc, value) => acc + value, 0n);
  const total = realized.reduce((acc, value) => acc + value, 0n);
  const evidenceIds = [...new Set(input.venues.flatMap((item) => [...item.evidenceIds]))].sort();
  const uVenues = runtimes.filter((item) => quoteSettlesInU(item.snapshot));
  const quoteU = uVenues.reduce((acc, item) => acc + item.quote, 0n);
  const baseU = uVenues.reduce((acc, item) => acc + item.base, 0n);
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
      quoteU === 0n || baseU === 0n
        ? unknownValue('NOT_APPLICABLE')
        : knownValue(((quoteU * 10n ** 18n) / baseU).toString()),
    isolatedRvSumRejected: true,
    peg: [
      {
        asset: input.venues[0]?.quoteToken ?? input.token,
        includeInU: uVenues.length > 0,
        pegDeviationBps: uVenues.length > 0 ? knownValue('0') : unknownValue('INSUFFICIENT_DATA'),
        liquidityAtomic: knownValue(quoteU.toString()),
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
