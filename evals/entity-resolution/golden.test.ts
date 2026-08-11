import { describe, expect, it } from 'vitest';

import { evaluateEntityStructuralGolden } from './golden.js';

describe('entity structural golden corpus', () => {
  it('passes precision, coordination, Service Hub, CoinJoin and classification regression gates', () => {
    const report = evaluateEntityStructuralGolden();

    expect(report.status).toBe('PASS');
    expect(report.corpus).toMatchObject({
      kind: 'STRUCTURAL_GOLDEN',
      totalCases: 7,
      fullyScoredCases: 6,
      abstainedCases: 1,
      probabilityCoverage: '0.857142',
    });
    expect(report.sameControllerPrecision).toMatchObject({
      status: 'PASS',
      selectedCases: 1,
      incorrectCases: 0,
    });
    expect(report.coordinationPrecision).toMatchObject({
      status: 'PASS',
      selectedCases: 1,
      incorrectCases: 0,
    });
    expect(report.serviceHubFalseMerge).toMatchObject({
      status: 'PASS',
      evaluatedCases: 2,
      falseMergeCases: 0,
    });
    expect(report.coinjoinFalseMerge).toMatchObject({
      status: 'PASS',
      evaluatedCases: 1,
      falseMergeCases: 0,
    });
    expect(report.classificationRegression).toEqual({
      status: 'PASS',
      evaluatedCases: 7,
      mismatchedCases: [],
    });
    expect(report.calibration.status).toBe('DIAGNOSTIC_ONLY');
  });
});
