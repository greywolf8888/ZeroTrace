import { hashPayload } from '@zerotrace/evidence';
import { DiscrepancyAuditResultSchema } from '@zerotrace/schemas';
import type {
  AnalysisMetadata,
  AnalysisSnapshot,
  DiscrepancyAuditResult,
  DiscrepancyAuditStatus,
  DiscrepancyCheckInput,
  DiscrepancyCheckResult,
  DiscrepancyClass,
  DiscrepancyDisposition,
  DiscrepancySeverity,
  KnowledgeReason,
} from '@zerotrace/schemas';

export type {
  ComparableValue,
  ComparisonObservation,
  DiscrepancyAuditResult,
  DiscrepancyAuditStatus,
  DiscrepancyCheckInput,
  DiscrepancyCheckResult,
  DiscrepancyClass,
  DiscrepancyDisposition,
  DiscrepancySeverity,
} from '@zerotrace/schemas';

interface NumericBudget {
  passPpm: bigint;
  warningPpm?: bigint;
}

const PPM = 1_000_000n;
export const DISCREPANCY_MODEL_VERSION = 'typed-discrepancy-v1';
const NUMERIC_BUDGETS: Partial<Record<DiscrepancyClass, NumericBudget>> = {
  DETERMINISTIC_DERIVED: { passPpm: 1_000n },
  INDEPENDENT_MARKET_QUOTE_RV: { passPpm: 5_000n, warningPpm: 10_000n },
  HOLDER_ENTITY_AGGREGATE: { passPpm: 1_000n },
};

interface DecimalFraction {
  numerator: bigint;
  denominator: bigint;
  scale: number;
}

function normalizedIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort();
}

function parseDecimal(value: string): DecimalFraction | undefined {
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value);
  if (match === null) return undefined;
  const fraction = match[3] ?? '';
  const denominator = 10n ** BigInt(fraction.length);
  const unsigned = BigInt(`${match[2]}${fraction}`);
  return {
    numerator: match[1] === '-' ? -unsigned : unsigned,
    denominator,
    scale: fraction.length,
  };
}

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function decimalAtScale(numerator: bigint, scale: number): string {
  const sign = numerator < 0n ? '-' : '';
  const digits = absolute(numerator)
    .toString()
    .padStart(scale + 1, '0');
  if (scale === 0) return sign + digits;
  const integer = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/, '');
  return fraction.length === 0 ? sign + integer : `${sign}${integer}.${fraction}`;
}

function absoluteDifference(left: DecimalFraction, right: DecimalFraction): string {
  const scale = Math.max(left.scale, right.scale);
  const leftScaled = left.numerator * 10n ** BigInt(scale - left.scale);
  const rightScaled = right.numerator * 10n ** BigInt(scale - right.scale);
  return decimalAtScale(absolute(leftScaled - rightScaled), scale);
}

function formatRatioPercent(numerator: bigint, denominator: bigint): string {
  if (denominator === 0n) return numerator === 0n ? '0' : 'undefined';
  const scale = 8;
  const scaled = (numerator * 100n * 10n ** BigInt(scale) + denominator / 2n) / denominator;
  return decimalAtScale(scaled, scale);
}

function ppmToPercent(ppm: bigint): string {
  return decimalAtScale(ppm, 4);
}

function snapshotIdentity(snapshot: AnalysisSnapshot): Record<string, string> {
  switch (snapshot.ledger) {
    case 'EVM':
      return {
        ledger: snapshot.ledger,
        chainId: snapshot.chainId,
        position: snapshot.blockNumber,
        hash: snapshot.blockHash.toLowerCase(),
        finality: snapshot.finality,
      };
    case 'BITCOIN':
      return {
        ledger: snapshot.ledger,
        chainId: snapshot.chainId,
        position: snapshot.height,
        hash: snapshot.blockHash.toLowerCase(),
        finality: snapshot.finality,
      };
    case 'SOLANA':
      return {
        ledger: snapshot.ledger,
        chainId: snapshot.chainId,
        position: snapshot.slot,
        hash: snapshot.blockhash,
        finality: snapshot.commitment,
      };
  }
}

function sameSnapshot(left: AnalysisSnapshot, right: AnalysisSnapshot): boolean {
  return hashPayload(snapshotIdentity(left)) === hashPayload(snapshotIdentity(right));
}

function unknownMetric(reason: KnowledgeReason) {
  return { state: 'unknown' as const, reason };
}

function baseResult(
  input: DiscrepancyCheckInput,
  disposition: DiscrepancyDisposition,
  severity: DiscrepancySeverity,
  message: string,
  metrics: Partial<
    Pick<
      DiscrepancyCheckResult,
      | 'absoluteError'
      | 'relativeErrorPct'
      | 'passThresholdPct'
      | 'warningThresholdPct'
      | 'numericDenominatorIncluded'
    >
  > = {},
): DiscrepancyCheckResult {
  const coverage = input.coverage ?? 1;
  const requiredCoverage = input.requiredCoverage ?? 1;
  const evidenceIds = normalizedIds([...input.actual.evidenceIds, ...input.reference.evidenceIds]);
  const explanationEvidenceIds = normalizedIds(input.explanationEvidenceIds ?? []);
  const sourceIndependenceEvidenceIds = normalizedIds(input.sourceIndependenceEvidenceIds ?? []);
  const content = {
    fieldPath: input.fieldPath,
    comparisonClass: input.comparisonClass,
    actual: input.actual,
    reference: input.reference,
    coverage,
    requiredCoverage,
    explanationEvidenceIds,
  };
  return {
    id: `dq_${hashPayload(content).slice(0, 24)}`,
    fieldPath: input.fieldPath,
    comparisonClass: input.comparisonClass,
    disposition,
    severity,
    actual: input.actual.value,
    reference: input.reference.value,
    absoluteError: metrics.absoluteError ?? unknownMetric('INSUFFICIENT_DATA'),
    relativeErrorPct: metrics.relativeErrorPct ?? unknownMetric('INSUFFICIENT_DATA'),
    passThresholdPct: metrics.passThresholdPct ?? unknownMetric('NOT_APPLICABLE'),
    warningThresholdPct: metrics.warningThresholdPct ?? unknownMetric('NOT_APPLICABLE'),
    coverage,
    requiredCoverage,
    sourceIndependence: input.sourceIndependence ?? unknownMetric('NOT_QUERIED'),
    sourceIndependenceEvidenceIds,
    numericDenominatorIncluded: metrics.numericDenominatorIncluded ?? false,
    sourceSet: normalizedIds([...input.actual.sourceSet, ...input.reference.sourceSet]),
    evidenceIds,
    explanationEvidenceIds,
    message,
  };
}

function compareKnown(
  input: DiscrepancyCheckInput,
  expectedSnapshot: AnalysisSnapshot | null,
): DiscrepancyCheckResult {
  const actualValue = input.actual.value;
  const referenceValue = input.reference.value;
  if (actualValue.state !== 'known' || referenceValue.state !== 'known') {
    return baseResult(
      input,
      'INCONCLUSIVE',
      'MEDIUM',
      'At least one comparison value is not Known and was excluded from the numeric denominator.',
    );
  }
  if (input.actual.snapshot === null || input.reference.snapshot === null) {
    return baseResult(
      input,
      'INCONCLUSIVE',
      'HIGH',
      'Both observations require a replayable Snapshot.',
    );
  }
  if (expectedSnapshot === null) {
    return baseResult(
      input,
      'INCONCLUSIVE',
      'HIGH',
      'The discrepancy audit requires a replayable target Snapshot.',
    );
  }
  if (
    !sameSnapshot(input.actual.snapshot, expectedSnapshot) ||
    !sameSnapshot(input.reference.snapshot, expectedSnapshot)
  ) {
    return baseResult(
      input,
      'FAIL',
      'CRITICAL',
      'A comparison observation does not match the audit target Snapshot.',
    );
  }
  if (!sameSnapshot(input.actual.snapshot, input.reference.snapshot)) {
    return baseResult(
      input,
      'FAIL',
      'CRITICAL',
      'The comparison observations do not refer to the same ledger position and block identity.',
    );
  }
  if (input.actual.evidenceIds.length === 0 || input.reference.evidenceIds.length === 0) {
    return baseResult(
      input,
      'FAIL',
      'CRITICAL',
      'A Known comparison value is missing source Evidence.',
    );
  }
  if (input.actual.sourceSet.length === 0 || input.reference.sourceSet.length === 0) {
    return baseResult(
      input,
      'FAIL',
      'CRITICAL',
      'A Known comparison value is missing its source set.',
    );
  }
  const coverage = input.coverage ?? 1;
  const requiredCoverage = input.requiredCoverage ?? 1;
  if (coverage < requiredCoverage) {
    return baseResult(
      input,
      'INCONCLUSIVE',
      'HIGH',
      `Coverage ${coverage} is below the required ${requiredCoverage}.`,
    );
  }
  if (
    input.comparisonClass === 'INDEPENDENT_MARKET_QUOTE_RV' &&
    (input.sourceIndependence?.state !== 'known' ||
      input.sourceIndependence.value !== true ||
      (input.sourceIndependenceEvidenceIds?.length ?? 0) === 0)
  ) {
    return baseResult(
      input,
      'INCONCLUSIVE',
      'HIGH',
      'Independent market/RV comparison requires positively verified, evidenced source independence.',
    );
  }

  const budget = NUMERIC_BUDGETS[input.comparisonClass];
  if (budget === undefined) {
    const conservation = input.comparisonClass === 'CONSERVATION';
    const actualConservation =
      conservation && typeof actualValue.value === 'string'
        ? parseDecimal(actualValue.value)
        : undefined;
    const referenceConservation =
      conservation && typeof referenceValue.value === 'string'
        ? parseDecimal(referenceValue.value)
        : undefined;
    if (conservation && (actualConservation === undefined || referenceConservation === undefined)) {
      return baseResult(
        input,
        'FAIL',
        'HIGH',
        'A conservation check received a non-decimal Known value.',
      );
    }
    const equal =
      actualConservation !== undefined && referenceConservation !== undefined
        ? actualConservation.numerator * referenceConservation.denominator ===
          referenceConservation.numerator * actualConservation.denominator
        : actualValue.value === referenceValue.value;
    return baseResult(
      input,
      equal ? 'PASS' : 'FAIL',
      equal ? 'LOW' : 'CRITICAL',
      equal
        ? 'Exact same-Snapshot values agree.'
        : 'Exact same-Snapshot values conflict; zero mismatch is allowed.',
      {
        absoluteError:
          actualConservation === undefined || referenceConservation === undefined
            ? unknownMetric('NOT_APPLICABLE')
            : {
                state: 'known',
                value: absoluteDifference(actualConservation, referenceConservation),
              },
        relativeErrorPct: unknownMetric('NOT_APPLICABLE'),
        passThresholdPct: { state: 'known', value: '0' },
      },
    );
  }
  if (typeof actualValue.value !== 'string' || typeof referenceValue.value !== 'string') {
    return baseResult(
      input,
      'FAIL',
      'HIGH',
      'A numeric comparison class received a non-decimal Known value.',
    );
  }
  const actual = parseDecimal(actualValue.value);
  const reference = parseDecimal(referenceValue.value);
  if (actual === undefined || reference === undefined) {
    return baseResult(
      input,
      'FAIL',
      'HIGH',
      'A numeric comparison class received a malformed decimal value.',
    );
  }
  const differenceNumerator = absolute(
    actual.numerator * reference.denominator - reference.numerator * actual.denominator,
  );
  const relativeDenominator = actual.denominator * absolute(reference.numerator);
  const referenceIsZero = reference.numerator === 0n;
  const exactAtZero = differenceNumerator === 0n;
  const passes = referenceIsZero
    ? exactAtZero
    : differenceNumerator * PPM <= relativeDenominator * budget.passPpm;
  const withinWarning =
    budget.warningPpm !== undefined &&
    !referenceIsZero &&
    differenceNumerator * PPM <= relativeDenominator * budget.warningPpm;
  const explained = (input.explanationEvidenceIds?.length ?? 0) > 0;
  const disposition: DiscrepancyDisposition = passes
    ? 'PASS'
    : withinWarning || (budget.warningPpm !== undefined && explained)
      ? 'WARNING'
      : 'FAIL';
  const message = referenceIsZero
    ? exactAtZero
      ? 'The zero reference matches exactly.'
      : 'A zero reference requires exact absolute equality.'
    : disposition === 'PASS'
      ? 'Relative error is within the typed acceptance budget.'
      : disposition === 'WARNING'
        ? explained && !withinWarning
          ? 'Relative error exceeds the failure threshold but has explicit explanation Evidence.'
          : 'Relative error exceeds the pass budget but remains within the warning band.'
        : 'Relative error exceeds the typed acceptance budget.';
  return baseResult(
    input,
    disposition,
    disposition === 'PASS' ? 'LOW' : disposition === 'WARNING' ? 'MEDIUM' : 'HIGH',
    message,
    {
      absoluteError: { state: 'known', value: absoluteDifference(actual, reference) },
      relativeErrorPct: referenceIsZero
        ? unknownMetric('NOT_APPLICABLE')
        : {
            state: 'known',
            value: formatRatioPercent(differenceNumerator, relativeDenominator),
          },
      passThresholdPct: { state: 'known', value: ppmToPercent(budget.passPpm) },
      warningThresholdPct:
        budget.warningPpm === undefined
          ? unknownMetric('NOT_APPLICABLE')
          : { state: 'known', value: ppmToPercent(budget.warningPpm) },
      numericDenominatorIncluded: !referenceIsZero,
    },
  );
}

export function auditDiscrepancies(
  checks: readonly DiscrepancyCheckInput[],
  metadata: AnalysisMetadata,
): DiscrepancyAuditResult {
  const results = checks.map((check) => compareKnown(check, metadata.snapshot));
  const summary = {
    total: results.length,
    passed: results.filter((item) => item.disposition === 'PASS').length,
    warnings: results.filter((item) => item.disposition === 'WARNING').length,
    failed: results.filter((item) => item.disposition === 'FAIL').length,
    inconclusive: results.filter((item) => item.disposition === 'INCONCLUSIVE').length,
    numericDenominator: results.filter((item) => item.numericDenominatorIncluded).length,
    coverageGaps: results.filter((item) => item.disposition === 'INCONCLUSIVE').length,
  };
  const status: DiscrepancyAuditStatus =
    results.length === 0
      ? 'INCONCLUSIVE'
      : summary.failed > 0
        ? 'FAIL'
        : summary.inconclusive > 0
          ? 'INCONCLUSIVE'
          : summary.warnings > 0
            ? 'PASS_WITH_WARNINGS'
            : 'PASS';
  return DiscrepancyAuditResultSchema.parse({
    status,
    checks: results,
    summary,
    metadata: {
      ...metadata,
      modelVersion: DISCREPANCY_MODEL_VERSION,
      sourceSet: normalizedIds([
        ...metadata.sourceSet,
        ...results.flatMap((item) => item.sourceSet),
      ]),
      evidenceIds: normalizedIds([
        ...metadata.evidenceIds,
        ...results.flatMap((item) => item.evidenceIds),
        ...results.flatMap((item) => item.explanationEvidenceIds),
        ...results.flatMap((item) => item.sourceIndependenceEvidenceIds),
      ]),
    },
  });
}
