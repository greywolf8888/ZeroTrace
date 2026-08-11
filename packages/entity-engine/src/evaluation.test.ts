import { describe, expect, it } from 'vitest';

import {
  knownValue,
  unknownValue,
  type AnalysisMetadata,
  type EntityResolution,
} from '@zerotrace/schemas';

import { evaluateEntityResolutionCorpus, type EntityEvaluationCase } from './evaluation.js';

const modelVersion = 'entity-evaluation-test-v1';
const predictionEvidenceId = `ev_${'a'.repeat(24)}`;

function metadata(evidenceIds: string[] = [predictionEvidenceId]): AnalysisMetadata {
  return {
    snapshot: null,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 1,
    simulationCoverage: 0,
    freshness: null,
    sourceSet: ['evaluation-fixture'],
    modelVersion,
    confidence: 1,
    evidenceIds,
  };
}

function resolution(options: {
  id: string;
  classification: EntityResolution['classification'];
  same: number | null;
  coordination: number | null;
  independent?: number | null;
}): EntityResolution {
  const probability = (value: number | null) =>
    value === null ? unknownValue('INSUFFICIENT_DATA') : knownValue(value);
  return {
    subjectA: `${options.id}-a`,
    subjectB: `${options.id}-b`,
    classification: options.classification,
    sameControllerProbability: probability(options.same),
    coordinationProbability: probability(options.coordination),
    independenceProbability: probability(options.independent ?? 0.1),
    positiveEvidenceIds: [predictionEvidenceId],
    negativeEvidenceIds: [],
    serviceSuppressionApplied: false,
    metadata: metadata(),
  };
}

function item(options: {
  id: string;
  classification: EntityResolution['classification'];
  same: number | null;
  coordination: number | null;
  independent?: number | null;
  truth: EntityEvaluationCase['truth'];
}): EntityEvaluationCase {
  return {
    id: options.id,
    truth: options.truth,
    expectedClassifications: [options.classification],
    labelReferences: [`golden:${options.id}`],
    resolution: resolution(options),
  };
}

function anchored(entry: EntityEvaluationCase): EntityEvaluationCase {
  return {
    ...entry,
    labelReferences: [`source:real-label:${entry.id}`],
    resolution: {
      ...entry.resolution,
      metadata: {
        ...entry.resolution.metadata,
        snapshot: {
          ledger: 'EVM',
          chainId: 'eip155:56',
          blockNumber: '1',
          blockHash: `0x${'1'.repeat(64)}`,
          parentBlockHash: `0x${'2'.repeat(64)}`,
          blockTimestamp: '2026-08-10T14:59:00.000Z',
          finality: 'finalized',
          capturedAt: '2026-08-10T15:00:00.000Z',
          providerVersions: { fixture: '1' },
          adapterVersions: { fixture: '1' },
          configHash: '3'.repeat(64),
          entityModelVersion: modelVersion,
          labelSnapshot: 'labels-v1',
        },
      },
    },
  };
}

describe('entity precision and calibration evaluation', () => {
  it('enforces the Master Prompt precision and false-merge gates without treating abstention as zero', () => {
    const report = evaluateEntityResolutionCorpus({
      kind: 'STRUCTURAL_GOLDEN',
      revision: 'fixture-v1',
      evaluatedAt: '2026-08-10T15:00:00.000Z',
      modelVersion,
      cases: [
        item({
          id: 'same',
          classification: 'CONFIRMED_SAME_CONTROLLER',
          same: 0.999,
          coordination: 0.8,
          truth: {
            sameController: true,
            coordinated: null,
            independent: false,
            serviceHub: false,
            coinjoin: false,
          },
        }),
        item({
          id: 'coordination',
          classification: 'COORDINATED_BUT_INDEPENDENT',
          same: 0.2,
          coordination: 0.99,
          independent: 0.8,
          truth: {
            sameController: false,
            coordinated: true,
            independent: true,
            serviceHub: false,
            coinjoin: false,
          },
        }),
        item({
          id: 'service',
          classification: 'SERVICE_INFRASTRUCTURE',
          same: 0.01,
          coordination: 0.05,
          truth: {
            sameController: false,
            coordinated: null,
            independent: null,
            serviceHub: true,
            coinjoin: false,
          },
        }),
        item({
          id: 'coinjoin',
          classification: 'UNKNOWN',
          same: 0.001,
          coordination: 0.02,
          truth: {
            sameController: false,
            coordinated: null,
            independent: null,
            serviceHub: false,
            coinjoin: true,
          },
        }),
      ],
    });

    expect(report.status).toBe('PASS');
    expect(report.sameControllerPrecision).toMatchObject({
      status: 'PASS',
      selectedCases: 1,
      precision: { state: 'known', value: '1' },
    });
    expect(report.coordinationPrecision.status).toBe('PASS');
    expect(report.serviceHubFalseMerge.falseMergeRate).toEqual({ state: 'known', value: '0' });
    expect(report.coinjoinFalseMerge).toMatchObject({ status: 'PASS', falseMergeCases: 0 });
    expect(report.corpus.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computes exact Brier and expected-calibration error diagnostics', () => {
    const report = evaluateEntityResolutionCorpus({
      kind: 'STRUCTURAL_GOLDEN',
      revision: 'diagnostic-v1',
      evaluatedAt: '2026-08-10T15:00:00.000Z',
      modelVersion,
      cases: [
        item({
          id: 'positive',
          classification: 'UNKNOWN',
          same: 0.8,
          coordination: 0.1,
          truth: {
            sameController: true,
            coordinated: false,
            independent: false,
            serviceHub: false,
            coinjoin: false,
          },
        }),
        item({
          id: 'negative',
          classification: 'UNKNOWN',
          same: 0.2,
          coordination: 0.1,
          truth: {
            sameController: false,
            coordinated: false,
            independent: true,
            serviceHub: false,
            coinjoin: false,
          },
        }),
      ].map(anchored),
    });

    expect(report.calibration.sameController).toMatchObject({
      evaluatedCases: 2,
      brierScore: { state: 'known', value: '0.04' },
      expectedCalibrationError: { state: 'known', value: '0.2' },
    });
    expect(report.calibration.status).toBe('DIAGNOSTIC_ONLY');
  });

  it('gates real-world Brier/ECE only after at least 100 labeled cases per axis', () => {
    const protectedCases = [
      item({
        id: 'service-real',
        classification: 'SERVICE_INFRASTRUCTURE',
        same: 0,
        coordination: 0,
        independent: 1,
        truth: {
          sameController: false,
          coordinated: false,
          independent: true,
          serviceHub: true,
          coinjoin: false,
        },
      }),
      item({
        id: 'coinjoin-real',
        classification: 'UNKNOWN',
        same: 0,
        coordination: 0,
        independent: 1,
        truth: {
          sameController: false,
          coordinated: false,
          independent: true,
          serviceHub: false,
          coinjoin: true,
        },
      }),
    ];
    const sameCases = Array.from({ length: 49 }, (_, index) =>
      item({
        id: `same-real-${index}`,
        classification: 'CONFIRMED_SAME_CONTROLLER',
        same: 1,
        coordination: 0,
        independent: 0,
        truth: {
          sameController: true,
          coordinated: false,
          independent: false,
          serviceHub: false,
          coinjoin: false,
        },
      }),
    );
    const coordinationCases = Array.from({ length: 49 }, (_, index) =>
      item({
        id: `coordination-real-${index}`,
        classification: 'COORDINATED_BUT_INDEPENDENT',
        same: 0,
        coordination: 1,
        independent: 1,
        truth: {
          sameController: false,
          coordinated: true,
          independent: true,
          serviceHub: false,
          coinjoin: false,
        },
      }),
    );
    const cases = [...protectedCases, ...sameCases, ...coordinationCases].map(anchored);
    const evaluate = (selectedCases: EntityEvaluationCase[]) =>
      evaluateEntityResolutionCorpus({
        kind: 'LABELED_REAL_WORLD',
        revision: `real-world-${selectedCases.length}`,
        evaluatedAt: '2026-08-10T15:00:00.000Z',
        modelVersion,
        cases: selectedCases,
      });

    const accepted = evaluate(cases);
    expect(accepted.status, JSON.stringify(accepted, null, 2)).toBe('PASS');
    expect(accepted.calibration).toMatchObject({
      status: 'PASS',
      sameController: {
        status: 'PASS',
        evaluatedCases: 100,
        brierScore: { state: 'known', value: '0' },
        expectedCalibrationError: { state: 'known', value: '0' },
      },
    });
    expect(evaluate(cases.slice(0, 99)).calibration.status).toBe('INSUFFICIENT_DATA');
  });

  it('keeps empty precision denominators and calibration axes explicitly unknown', () => {
    const report = evaluateEntityResolutionCorpus({
      kind: 'STRUCTURAL_GOLDEN',
      revision: 'abstention-v1',
      evaluatedAt: '2026-08-10T15:00:00.000Z',
      modelVersion,
      cases: [
        item({
          id: 'abstention',
          classification: 'UNKNOWN',
          same: null,
          coordination: null,
          independent: null,
          truth: {
            sameController: null,
            coordinated: null,
            independent: null,
            serviceHub: false,
            coinjoin: false,
          },
        }),
      ],
    });

    expect(report.status).toBe('INSUFFICIENT_DATA');
    expect(report.sameControllerPrecision.precision).toMatchObject({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(report.calibration.sameController.brierScore.state).toBe('unknown');
    expect(report.corpus.probabilityCoverage).toBe('0');
  });

  it('fails high-confidence false positives and protected service/CoinJoin merges', () => {
    const report = evaluateEntityResolutionCorpus({
      kind: 'STRUCTURAL_GOLDEN',
      revision: 'regression-v1',
      evaluatedAt: '2026-08-10T15:00:00.000Z',
      modelVersion,
      cases: [
        item({
          id: 'false-same',
          classification: 'HIGHLY_PROBABLE_SAME_CONTROLLER',
          same: 0.99,
          coordination: 0.2,
          truth: {
            sameController: false,
            coordinated: false,
            independent: true,
            serviceHub: false,
            coinjoin: false,
          },
        }),
        item({
          id: 'coordination',
          classification: 'COORDINATED_BUT_INDEPENDENT',
          same: 0.1,
          coordination: 0.99,
          truth: {
            sameController: false,
            coordinated: true,
            independent: true,
            serviceHub: false,
            coinjoin: false,
          },
        }),
        item({
          id: 'service-merge',
          classification: 'PROBABLE_SAME_CONTROLLER',
          same: 0.95,
          coordination: 0.8,
          truth: {
            sameController: false,
            coordinated: null,
            independent: null,
            serviceHub: true,
            coinjoin: false,
          },
        }),
        item({
          id: 'coinjoin-merge',
          classification: 'PROBABLE_SAME_CONTROLLER',
          same: 0.95,
          coordination: 0.8,
          truth: {
            sameController: false,
            coordinated: null,
            independent: null,
            serviceHub: false,
            coinjoin: true,
          },
        }),
      ],
    });

    expect(report.status).toBe('FAIL');
    expect(report.sameControllerPrecision.status).toBe('FAIL');
    expect(report.serviceHubFalseMerge.status).toBe('FAIL');
    expect(report.coinjoinFalseMerge.status).toBe('FAIL');
  });

  it('rejects real-world calibration claims without Snapshot-bound prediction Evidence', () => {
    expect(() =>
      evaluateEntityResolutionCorpus({
        kind: 'LABELED_REAL_WORLD',
        revision: 'unsafe-v1',
        evaluatedAt: '2026-08-10T15:00:00.000Z',
        modelVersion,
        cases: [
          item({
            id: 'unanchored',
            classification: 'UNKNOWN',
            same: 0.5,
            coordination: 0.5,
            truth: {
              sameController: null,
              coordinated: null,
              independent: null,
              serviceHub: false,
              coinjoin: false,
            },
          }),
        ],
      }),
    ).toThrow(/Snapshot.*prediction Evidence/);
  });
});
