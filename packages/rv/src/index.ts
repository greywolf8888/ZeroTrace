import {
  knownValue,
  unavailableValue,
  type AnalysisMetadata,
  type RealizableValuePoint,
} from '@zerotrace/schemas';

const BPS_DENOMINATOR = 10_000n;

function parseAtomic(value: string, field: string): bigint {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${field} must be a non-negative integer string in atomic units.`);
  }
  return BigInt(value);
}

function parseBps(value: string): bigint {
  const bps = parseAtomic(value, 'feeBps');
  if (bps > BPS_DENOMINATOR) throw new Error('feeBps may not exceed 10000.');
  return bps;
}

function formatRatio(numerator: bigint, denominator: bigint, decimalPlaces = 18): string {
  if (denominator === 0n) throw new Error('Cannot format a ratio with a zero denominator.');
  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const integer = absoluteNumerator / absoluteDenominator;
  let remainder = absoluteNumerator % absoluteDenominator;
  let fraction = '';
  for (let index = 0; index < decimalPlaces && remainder !== 0n; index += 1) {
    remainder *= 10n;
    fraction += (remainder / absoluteDenominator).toString();
    remainder %= absoluteDenominator;
  }
  fraction = fraction.replace(/0+$/, '');
  const result = fraction.length === 0 ? integer.toString() : `${integer}.${fraction}`;
  return negative && result !== '0' ? `-${result}` : result;
}

export interface PensionEntryEconomicsInput {
  quoteInputAtomic: string;
  modeledNetTokenOutputAtomic: string;
  shareUnitAtomic: string;
}

export interface PensionEntryEconomics {
  modeledShareEquivalent: string;
  modeledWholeShares: string;
  modeledCommittedTokenAtomic: string;
  modeledRemainderTokenAtomic: string;
  modeledQuoteCostForCommittedSharesAtomic: string;
  modeledAverageQuoteCostPerShareAtomic: string | null;
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

export function calculatePensionEntryEconomics(
  input: PensionEntryEconomicsInput,
): PensionEntryEconomics {
  const quoteInput = parseAtomic(input.quoteInputAtomic, 'quoteInputAtomic');
  const modeledNetTokenOutput = parseAtomic(
    input.modeledNetTokenOutputAtomic,
    'modeledNetTokenOutputAtomic',
  );
  const shareUnit = parseAtomic(input.shareUnitAtomic, 'shareUnitAtomic');
  if (quoteInput === 0n) throw new Error('quoteInputAtomic must be positive.');
  if (shareUnit === 0n) throw new Error('shareUnitAtomic must be positive.');

  const wholeShares = modeledNetTokenOutput / shareUnit;
  const committedTokens = wholeShares * shareUnit;
  const remainderTokens = modeledNetTokenOutput - committedTokens;
  const committedQuoteCost =
    modeledNetTokenOutput === 0n ? 0n : (quoteInput * committedTokens) / modeledNetTokenOutput;
  const averageQuoteCostPerShare =
    modeledNetTokenOutput === 0n ? null : ceilDivide(quoteInput * shareUnit, modeledNetTokenOutput);

  return {
    modeledShareEquivalent: formatRatio(modeledNetTokenOutput, shareUnit),
    modeledWholeShares: wholeShares.toString(),
    modeledCommittedTokenAtomic: committedTokens.toString(),
    modeledRemainderTokenAtomic: remainderTokens.toString(),
    modeledQuoteCostForCommittedSharesAtomic: committedQuoteCost.toString(),
    modeledAverageQuoteCostPerShareAtomic: averageQuoteCostPerShare?.toString() ?? null,
  };
}

export interface ConstantProductPoolSnapshot {
  id: string;
  baseReserve: string;
  quoteReserve: string;
  virtualBaseReserve?: string | undefined;
  virtualQuoteReserve?: string | undefined;
  feeBps: string;
  sellEnabled: boolean;
  maxSellQuantity?: string | undefined;
  evidenceIds: string[];
}

export interface ConstantProductQuoteInput {
  pool: ConstantProductPoolSnapshot;
  inputQuantity: string;
  metadata: AnalysisMetadata;
}

interface QuoteComputation {
  amountIn: bigint;
  effectiveInput: bigint;
  output: bigint;
  nominal: string;
  averageExitPrice: string;
  priceImpactBps: string;
  feeBps: bigint;
}

function computeConstantProductQuote(
  pool: ConstantProductPoolSnapshot,
  inputQuantity: string,
): QuoteComputation {
  const amountIn = parseAtomic(inputQuantity, 'inputQuantity');
  const baseReserve = parseAtomic(pool.baseReserve, 'baseReserve');
  const quoteReserve = parseAtomic(pool.quoteReserve, 'quoteReserve');
  const virtualBase = parseAtomic(pool.virtualBaseReserve ?? '0', 'virtualBaseReserve');
  const virtualQuote = parseAtomic(pool.virtualQuoteReserve ?? '0', 'virtualQuoteReserve');
  const feeBps = parseBps(pool.feeBps);
  const effectiveBase = baseReserve + virtualBase;
  const effectiveQuote = quoteReserve + virtualQuote;
  if (effectiveBase <= 0n || effectiveQuote <= 0n)
    throw new Error('Effective pool reserves must be positive.');
  const nominal = formatRatio(amountIn * effectiveQuote, effectiveBase);
  if (amountIn === 0n) {
    return {
      amountIn,
      effectiveInput: 0n,
      output: 0n,
      nominal,
      averageExitPrice: '0',
      priceImpactBps: '0',
      feeBps,
    };
  }
  const effectiveInput = (amountIn * (BPS_DENOMINATOR - feeBps)) / BPS_DENOMINATOR;
  const invariant = effectiveBase * effectiveQuote;
  const newEffectiveQuote = invariant / (effectiveBase + effectiveInput);
  const theoreticalOutput = effectiveQuote - newEffectiveQuote;
  const output = theoreticalOutput > quoteReserve ? quoteReserve : theoreticalOutput;
  const averageExitPrice = formatRatio(output, amountIn);
  const realizedVsSpotBps =
    (output * effectiveBase * BPS_DENOMINATOR) / (amountIn * effectiveQuote);
  const impact = realizedVsSpotBps >= BPS_DENOMINATOR ? 0n : BPS_DENOMINATOR - realizedVsSpotBps;
  return {
    amountIn,
    effectiveInput,
    output,
    nominal,
    averageExitPrice,
    priceImpactBps: impact.toString(),
    feeBps,
  };
}

export function quoteConstantProductExit(input: ConstantProductQuoteInput): RealizableValuePoint {
  const amountIn = parseAtomic(input.inputQuantity, 'inputQuantity');
  const baseReserve = parseAtomic(input.pool.baseReserve, 'baseReserve');
  const quoteReserve = parseAtomic(input.pool.quoteReserve, 'quoteReserve');
  const virtualBase = parseAtomic(input.pool.virtualBaseReserve ?? '0', 'virtualBaseReserve');
  const virtualQuote = parseAtomic(input.pool.virtualQuoteReserve ?? '0', 'virtualQuoteReserve');
  const effectiveBase = baseReserve + virtualBase;
  const effectiveQuote = quoteReserve + virtualQuote;
  if (effectiveBase <= 0n || effectiveQuote <= 0n)
    throw new Error('Effective pool reserves must be positive.');
  const nominal = formatRatio(amountIn * effectiveQuote, effectiveBase);
  const evidenceIds = [...new Set([...input.metadata.evidenceIds, ...input.pool.evidenceIds])];
  const metadata = { ...input.metadata, evidenceIds };
  if (!input.pool.sellEnabled) {
    return {
      inputQuantity: input.inputQuantity,
      nominalValue: knownValue(nominal),
      realizableValue: unavailableValue('EXECUTION_BLOCKED', 'Pool state disables selling.'),
      averageExitPrice: unavailableValue('EXECUTION_BLOCKED'),
      priceImpactBps: unavailableValue('EXECUTION_BLOCKED'),
      totalFeeBps: knownValue(input.pool.feeBps),
      route: [input.pool.id],
      metadata,
    };
  }
  if (
    input.pool.maxSellQuantity !== undefined &&
    amountIn > parseAtomic(input.pool.maxSellQuantity, 'maxSellQuantity')
  ) {
    return {
      inputQuantity: input.inputQuantity,
      nominalValue: knownValue(nominal),
      realizableValue: unavailableValue(
        'EXECUTION_BLOCKED',
        'Input exceeds the observed max-sell constraint.',
      ),
      averageExitPrice: unavailableValue('EXECUTION_BLOCKED'),
      priceImpactBps: unavailableValue('EXECUTION_BLOCKED'),
      totalFeeBps: knownValue(input.pool.feeBps),
      route: [input.pool.id],
      metadata,
    };
  }
  const computed = computeConstantProductQuote(input.pool, input.inputQuantity);
  return {
    inputQuantity: input.inputQuantity,
    nominalValue: knownValue(computed.nominal),
    realizableValue: knownValue(computed.output.toString()),
    averageExitPrice: knownValue(computed.averageExitPrice),
    priceImpactBps: knownValue(computed.priceImpactBps),
    totalFeeBps: knownValue(computed.feeBps.toString()),
    route: [input.pool.id],
    metadata,
  };
}

export interface ExitRaceParticipant {
  id: string;
  inputQuantity: string;
}

export interface ExitRaceInput {
  pool: ConstantProductPoolSnapshot;
  participants: ExitRaceParticipant[];
  order: 'SEQUENTIAL' | 'RANDOM';
  seed: number;
  iterations?: number | undefined;
  metadata: AnalysisMetadata;
}

export interface ExitRaceParticipantResult {
  id: string;
  p10: string;
  p50: string;
  p90: string;
}

export interface ExitRaceResult {
  seed: number;
  iterations: number;
  participantResults: ExitRaceParticipantResult[];
  finalQuoteReserve: { p10: string; p50: string; p90: string };
  evidenceIds: string[];
}

function randomGenerator(seed: number): () => number {
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
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = result[index];
    const replacement = result[swapIndex];
    if (current !== undefined && replacement !== undefined) {
      result[index] = replacement;
      result[swapIndex] = current;
    }
  }
  return result;
}

function percentile(values: bigint[], percentileValue: number): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const index = Math.floor((sorted.length - 1) * percentileValue);
  const result = sorted[index];
  if (result === undefined) throw new Error('Cannot calculate a percentile over an empty set.');
  return result;
}

export function simulateExitRace(input: ExitRaceInput): ExitRaceResult {
  if (!input.pool.sellEnabled) throw new Error('Exit race cannot run while selling is disabled.');
  if (input.participants.length === 0)
    throw new Error('Exit race requires at least one participant.');
  if (new Set(input.participants.map((item) => item.id)).size !== input.participants.length) {
    throw new Error('Exit race participant ids must be unique.');
  }
  const iterations = input.order === 'SEQUENTIAL' ? 1 : (input.iterations ?? 100);
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 10_000) {
    throw new Error('Exit race iterations must be between 1 and 10000.');
  }
  const results = new Map(
    input.participants.map((participant) => [participant.id, [] as bigint[]]),
  );
  const finalReserves: bigint[] = [];
  const random = randomGenerator(input.seed);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const order =
      input.order === 'RANDOM' ? shuffle(input.participants, random) : [...input.participants];
    let pool: ConstantProductPoolSnapshot = { ...input.pool };
    for (const participant of order) {
      const quote = computeConstantProductQuote(pool, participant.inputQuantity);
      results.get(participant.id)?.push(quote.output);
      pool = {
        ...pool,
        baseReserve: (parseAtomic(pool.baseReserve, 'baseReserve') + quote.amountIn).toString(),
        quoteReserve: (parseAtomic(pool.quoteReserve, 'quoteReserve') - quote.output).toString(),
      };
    }
    finalReserves.push(parseAtomic(pool.quoteReserve, 'quoteReserve'));
  }
  return {
    seed: input.seed,
    iterations,
    participantResults: input.participants.map((participant) => {
      const values = results.get(participant.id) ?? [];
      return {
        id: participant.id,
        p10: percentile(values, 0.1).toString(),
        p50: percentile(values, 0.5).toString(),
        p90: percentile(values, 0.9).toString(),
      };
    }),
    finalQuoteReserve: {
      p10: percentile(finalReserves, 0.1).toString(),
      p50: percentile(finalReserves, 0.5).toString(),
      p90: percentile(finalReserves, 0.9).toString(),
    },
    evidenceIds: [...new Set([...input.metadata.evidenceIds, ...input.pool.evidenceIds])],
  };
}
