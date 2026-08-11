import { describe, expect, it } from 'vitest';

import {
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type AnalysisSnapshot,
} from '@zerotrace/schemas';

import {
  auditDiscrepancies,
  type ComparisonObservation,
  type DiscrepancyCheckInput,
} from './discrepancy.js';

const snapshot: AnalysisSnapshot = {
  ledger: 'EVM',
  chainId: 'eip155:56',
  blockNumber: '100',
  blockHash: `0x${'1'.repeat(64)}`,
  finality: 'finalized',
  capturedAt: '2026-08-10T00:00:00.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { fixture: '1' },
  configHash: '2'.repeat(64),
  entityModelVersion: 'fixture',
  labelSnapshot: 'fixture',
};

const metadata: AnalysisMetadata = {
  snapshot,
  dataCoverage: 1,
  sourceCoverage: 1,
  historyCoverage: 0,
  simulationCoverage: 0,
  freshness: '2026-08-10T00:00:00.000Z',
  sourceSet: ['actual', 'reference'],
  modelVersion: 'discrepancy-fixture-v1',
  confidence: 1,
  evidenceIds: [],
};

function observation(
  value: ComparisonObservation['value'],
  source: string,
  overrides: Partial<ComparisonObservation> = {},
): ComparisonObservation {
  return {
    value,
    snapshot,
    evidenceIds: [`ev_${source}`],
    sourceSet: [source],
    modelVersion: `${source}-v1`,
    ...overrides,
  };
}

function check(
  comparisonClass: DiscrepancyCheckInput['comparisonClass'],
  actual: ComparisonObservation['value'],
  reference: ComparisonObservation['value'],
  overrides: Partial<DiscrepancyCheckInput> = {},
): DiscrepancyCheckInput {
  return {
    fieldPath: 'launch.realQuoteReserve',
    comparisonClass,
    actual: observation(actual, 'actual'),
    reference: observation(reference, 'reference'),
    ...(comparisonClass === 'INDEPENDENT_MARKET_QUOTE_RV'
      ? {
          sourceIndependence: knownValue(true),
          sourceIndependenceEvidenceIds: ['ev_source_independence'],
        }
      : {}),
    ...overrides,
  };
}

describe('typed discrepancy audit', () => {
  it('enforces zero mismatch for exact same-Snapshot state', () => {
    const result = auditDiscrepancies(
      [check('EXACT_IDENTITY_STATE', knownValue('eip155:56'), knownValue('eip155:1'))],
      metadata,
    );

    expect(result.status).toBe('FAIL');
    expect(result.checks[0]).toMatchObject({
      disposition: 'FAIL',
      severity: 'CRITICAL',
      absoluteError: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      passThresholdPct: { state: 'known', value: '0' },
    });
  });

  it('compares conservation values as exact decimals without display-format false positives', () => {
    const result = auditDiscrepancies(
      [check('CONSERVATION', knownValue('100.0'), knownValue('100'))],
      metadata,
    );

    expect(result.status).toBe('PASS');
    expect(result.checks[0]).toMatchObject({
      disposition: 'PASS',
      absoluteError: { state: 'known', value: '0' },
    });
  });

  it('uses the exact 0.10% deterministic-derived budget without float rounding', () => {
    const result = auditDiscrepancies(
      [
        check('DETERMINISTIC_DERIVED', knownValue('100.1'), knownValue('100')),
        check('DETERMINISTIC_DERIVED', knownValue('100.1001'), knownValue('100'), {
          fieldPath: 'launch.progress',
        }),
      ],
      metadata,
    );

    expect(result.status).toBe('FAIL');
    expect(result.checks.map((item) => item.disposition)).toEqual(['PASS', 'FAIL']);
    expect(result.checks[0]?.relativeErrorPct).toEqual({ state: 'known', value: '0.1' });
    expect(result.checks[1]?.relativeErrorPct).toEqual({ state: 'known', value: '0.1001' });
  });

  it('applies quote pass, warning, failure, and evidenced-explanation bands', () => {
    const result = auditDiscrepancies(
      [
        check('INDEPENDENT_MARKET_QUOTE_RV', knownValue('100.5'), knownValue('100'), {
          fieldPath: 'quotes.passEdge',
        }),
        check('INDEPENDENT_MARKET_QUOTE_RV', knownValue('100.75'), knownValue('100'), {
          fieldPath: 'quotes.warning',
        }),
        check('INDEPENDENT_MARKET_QUOTE_RV', knownValue('101.01'), knownValue('100'), {
          fieldPath: 'quotes.failure',
        }),
        check('INDEPENDENT_MARKET_QUOTE_RV', knownValue('101.01'), knownValue('100'), {
          fieldPath: 'quotes.explained',
          explanationEvidenceIds: ['ev_fee_rounding'],
        }),
      ],
      metadata,
    );

    expect(result.status).toBe('FAIL');
    expect(result.checks.map((item) => item.disposition)).toEqual([
      'PASS',
      'WARNING',
      'FAIL',
      'WARNING',
    ]);
    expect(result.checks[1]).toMatchObject({
      passThresholdPct: { state: 'known', value: '0.5' },
      warningThresholdPct: { state: 'known', value: '1' },
    });
  });

  it('requires exact absolute equality when the numeric reference is zero', () => {
    const result = auditDiscrepancies(
      [
        check('INDEPENDENT_MARKET_QUOTE_RV', knownValue('0'), knownValue('0'), {
          fieldPath: 'quotes.zeroMatch',
        }),
        check('INDEPENDENT_MARKET_QUOTE_RV', knownValue('0.0001'), knownValue('0'), {
          fieldPath: 'quotes.zeroMismatch',
        }),
      ],
      metadata,
    );

    expect(result.checks.map((item) => item.disposition)).toEqual(['PASS', 'FAIL']);
    expect(result.checks[0]).toMatchObject({
      numericDenominatorIncluded: false,
      relativeErrorPct: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    });
  });

  it('excludes Unknown values from numeric denominators and makes the audit inconclusive', () => {
    const result = auditDiscrepancies(
      [check('INDEPENDENT_MARKET_QUOTE_RV', unknownValue('PROVIDER_DOWN'), knownValue('100'))],
      metadata,
    );

    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.summary).toMatchObject({ numericDenominator: 0, coverageGaps: 1 });
  });

  it('does not score an independent quote when source independence is unverified', () => {
    const result = auditDiscrepancies(
      [
        check('INDEPENDENT_MARKET_QUOTE_RV', knownValue('100'), knownValue('100'), {
          sourceIndependence: unknownValue('NOT_QUERIED'),
          sourceIndependenceEvidenceIds: [],
        }),
      ],
      metadata,
    );

    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.checks[0]).toMatchObject({
      disposition: 'INCONCLUSIVE',
      numericDenominatorIncluded: false,
      sourceIndependence: { state: 'unknown', reason: 'NOT_QUERIED' },
      sourceIndependenceEvidenceIds: [],
    });
  });

  it('fails conflicting Snapshot identities before comparing values', () => {
    const conflictingSnapshot: AnalysisSnapshot = {
      ...snapshot,
      blockHash: `0x${'3'.repeat(64)}`,
    };
    const result = auditDiscrepancies(
      [
        check('EXACT_IDENTITY_STATE', knownValue('same'), knownValue('same'), {
          reference: observation(knownValue('same'), 'reference', {
            snapshot: conflictingSnapshot,
          }),
        }),
      ],
      metadata,
    );

    expect(result.checks[0]).toMatchObject({ disposition: 'FAIL', severity: 'CRITICAL' });
    expect(result.checks[0]?.message).toContain('audit target Snapshot');
  });

  it('fails Known facts with missing Evidence edges', () => {
    const result = auditDiscrepancies(
      [
        check('CONSERVATION', knownValue('100'), knownValue('100'), {
          actual: observation(knownValue('100'), 'actual', { evidenceIds: [] }),
        }),
      ],
      metadata,
    );

    expect(result.checks[0]).toMatchObject({ disposition: 'FAIL', severity: 'CRITICAL' });
    expect(result.checks[0]?.message).toContain('missing source Evidence');
  });

  it('keeps holder aggregates inconclusive below the declared coverage gate', () => {
    const result = auditDiscrepancies(
      [
        check('HOLDER_ENTITY_AGGREGATE', knownValue('100'), knownValue('100'), {
          coverage: 0.8,
          requiredCoverage: 0.9,
        }),
      ],
      metadata,
    );

    expect(result.status).toBe('INCONCLUSIVE');
    expect(result.checks[0]).toMatchObject({ coverage: 0.8, requiredCoverage: 0.9 });
  });

  it('does not call an empty audit a pass', () => {
    const result = auditDiscrepancies([], metadata);
    expect(result.status).toBe('INCONCLUSIVE');
  });
});
