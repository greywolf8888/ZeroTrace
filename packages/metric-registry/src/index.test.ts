import { describe, expect, it } from 'vitest';

import type { AnalysisSnapshot } from '@zerotrace/schemas';

import {
  createCoreMetricRegistry,
  MetricRegistry,
  type MetricDefinition,
  type MetricFormula,
  type MetricObservation,
  type MetricRegistryError,
  type MetricUnit,
} from './index.js';

const snapshot: AnalysisSnapshot = {
  ledger: 'EVM',
  chainId: 'eip155:1',
  blockNumber: '100',
  blockHash: `0x${'1'.repeat(64)}`,
  finality: 'finalized',
  capturedAt: '2026-01-01T00:00:00.000Z',
  providerVersions: { archive: 'test-v1' },
  adapterVersions: { evm: 'test-v1' },
  configHash: '2'.repeat(64),
  entityModelVersion: 'entity-v1',
  labelSnapshot: 'labels-v1',
};

const coverage = {
  data: { state: 'known' as const, value: 1 },
  source: { state: 'known' as const, value: 0.9 },
  history: { state: 'known' as const, value: 0.8 },
};

function observation(
  metricId: string,
  value: string,
  knownAt: string,
  revision: number,
): MetricObservation {
  return {
    observationId: `${metricId}-${revision}`,
    metricId,
    version: '1.0.0',
    subjectKey: 'EVM:eip155:1:token:0x01',
    value: { state: 'known', value },
    unit: { dimensions: { count: 1 } },
    eventTime: '2026-01-01T00:00:00.000Z',
    knownAt,
    revision,
    snapshot,
    coverage,
    sourceSet: ['archive-test'],
    evidenceIds: [`ev_${String(revision).padStart(24, '0')}`],
    evidenceScore: 80 - revision,
  };
}

const testDefinitionCommon = {
  chineseName: '测试指标',
  chineseDescription: '仅供测试的指标定义。',
  basis: 'RAW' as const,
  ledgers: ['EVM'] as const,
  assetScope: ['*'] as const,
  protocolScope: ['*'] as const,
  granularities: ['SNAPSHOT'] as const,
  staleAfterSeconds: 60,
  modelVersion: 'test-v1',
  limitations: ['测试。'] as const,
};

const countUnit: MetricUnit = { dimensions: { count: 1 } };
const scalarUnit: MetricUnit = { dimensions: {} };

function sourceDefinition(metricId = 'test.source'): MetricDefinition {
  return {
    ...testDefinitionCommon,
    kind: 'SOURCE',
    metricId,
    version: '1.0.0',
    outputUnit: countUnit,
    dependencies: [],
  };
}

function derivedDefinition(
  metricId: string,
  formula: MetricFormula,
  outputUnit: MetricUnit = scalarUnit,
  dependencies: MetricDefinition['dependencies'] = [],
): MetricDefinition {
  return {
    ...testDefinitionCommon,
    kind: 'DERIVED',
    metricId,
    version: '1.0.0',
    outputUnit,
    dependencies,
    formula,
  };
}

describe('MetricRegistry', () => {
  it('evaluates exact unit-safe formulas with replayable evidence metadata', () => {
    const registry = createCoreMetricRegistry();
    const result = registry.evaluate({
      metricId: 'derived.transfers_per_active_address',
      version: '1.0.0',
      subjectKey: 'EVM:eip155:1:token:0x01',
      asOf: '2026-01-03T00:00:00.000Z',
      snapshot,
      observations: [
        observation('raw.transfer_count', '10', '2026-01-02T00:00:00.000Z', 1),
        observation('raw.active_address_count', '4', '2026-01-02T00:00:00.000Z', 1),
      ],
    });

    expect(result.value).toEqual({
      state: 'known',
      value: { numerator: '5', denominator: '2', exactDecimal: '2.5' },
    });
    expect(result.snapshot).toEqual(snapshot);
    expect(result.coverage.history).toEqual({ state: 'known', value: 0.8 });
    expect(result.sourceSet).toEqual(['archive-test']);
    expect(result.evidenceIds).toHaveLength(1);
    expect(result.confidence).toMatchObject({
      kind: 'EVIDENCE_SCORE_NOT_CALIBRATED_PROBABILITY',
      score: 79,
    });
    expect(result.replay.inputObservationIds).toHaveLength(2);
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('prevents future-revision leakage at point-in-time asOf', () => {
    const registry = createCoreMetricRegistry();
    const result = registry.evaluate({
      metricId: 'raw.transfer_count',
      version: '1.0.0',
      subjectKey: 'EVM:eip155:1:token:0x01',
      asOf: '2026-01-03T00:00:00.000Z',
      snapshot,
      observations: [
        observation('raw.transfer_count', '10', '2026-01-02T00:00:00.000Z', 1),
        observation('raw.transfer_count', '999', '2026-01-04T00:00:00.000Z', 2),
      ],
    });

    expect(result.value).toMatchObject({ state: 'known', value: { exactDecimal: '10' } });
    expect(result.replay.inputObservationIds).toEqual(['raw.transfer_count-1']);
  });

  it('keeps zero-denominator, provider-down, stale, and missing states distinct', () => {
    const registry = createCoreMetricRegistry();
    const base = {
      version: '1.0.0',
      subjectKey: 'EVM:eip155:1:token:0x01',
      snapshot,
    } as const;
    const zero = registry.evaluate({
      ...base,
      metricId: 'derived.transfers_per_active_address',
      asOf: '2026-01-02T00:00:00.000Z',
      observations: [
        observation('raw.transfer_count', '10', '2026-01-02T00:00:00.000Z', 1),
        observation('raw.active_address_count', '0', '2026-01-02T00:00:00.000Z', 1),
      ],
    });
    const missing = registry.evaluate({
      ...base,
      metricId: 'raw.transfer_count',
      asOf: '2026-01-02T00:00:00.000Z',
      observations: [],
    });
    const providerObservation: MetricObservation = {
      ...observation('raw.transfer_count', '10', '2026-01-02T00:00:00.000Z', 1),
      value: { state: 'provider_down', provider: 'archive-test', detail: '测试不可用。' },
    };
    const providerDown = registry.evaluate({
      ...base,
      metricId: 'raw.transfer_count',
      asOf: '2026-01-02T00:00:00.000Z',
      observations: [providerObservation],
    });
    const stale = registry.evaluate({
      ...base,
      metricId: 'raw.transfer_count',
      asOf: '2026-01-04T00:00:01.000Z',
      observations: [observation('raw.transfer_count', '10', '2026-01-02T00:00:00.000Z', 1)],
    });

    expect(zero.value).toMatchObject({ state: 'unknown', reason: 'UNDEFINED_DIVISION' });
    expect(missing.value).toMatchObject({ state: 'unknown', reason: 'NO_PIT_OBSERVATION' });
    expect(providerDown.value).toMatchObject({ state: 'provider_down', provider: 'archive-test' });
    expect(stale.value).toMatchObject({ state: 'stale' });
    expect(stale.freshness.state).toBe('STALE');
  });

  it('rejects dependency cycles and incompatible units', () => {
    const common = {
      chineseName: '测试指标',
      chineseDescription: '仅供测试的指标定义。',
      basis: 'RAW' as const,
      ledgers: ['EVM'] as const,
      assetScope: ['*'],
      protocolScope: ['*'],
      granularities: ['SNAPSHOT'],
      staleAfterSeconds: 60,
      modelVersion: 'test-v1',
      limitations: ['测试。'],
    };
    const unit: MetricUnit = { dimensions: { count: 1 } };
    const cycle: MetricDefinition[] = [
      {
        ...common,
        kind: 'DERIVED',
        metricId: 'test.a',
        version: '1.0.0',
        outputUnit: unit,
        dependencies: [{ metricId: 'test.b', version: '1.0.0' }],
        formula: { op: 'ref', metricId: 'test.b', version: '1.0.0' },
      },
      {
        ...common,
        kind: 'DERIVED',
        metricId: 'test.b',
        version: '1.0.0',
        outputUnit: unit,
        dependencies: [{ metricId: 'test.a', version: '1.0.0' }],
        formula: { op: 'ref', metricId: 'test.a', version: '1.0.0' },
      },
    ];
    expect(() => new MetricRegistry(cycle)).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'DEPENDENCY_CYCLE' }),
    );

    const source: MetricDefinition = {
      ...common,
      kind: 'SOURCE',
      metricId: 'test.source',
      version: '1.0.0',
      outputUnit: unit,
      dependencies: [],
    };
    const badOutput: MetricDefinition = {
      ...common,
      kind: 'DERIVED',
      metricId: 'test.bad_output',
      version: '1.0.0',
      outputUnit: { dimensions: { usd: 1 } },
      dependencies: [{ metricId: 'test.source', version: '1.0.0' }],
      formula: { op: 'ref', metricId: 'test.source', version: '1.0.0' },
    };
    expect(() => new MetricRegistry([source, badOutput])).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'UNIT_MISMATCH' }),
    );
  });

  it('evaluates every exact arithmetic operation without floating-point coercion', () => {
    const definitions: MetricDefinition[] = [
      derivedDefinition(
        'calc.add',
        {
          op: 'add',
          operands: [
            { op: 'constant', value: '1.20', unit: countUnit },
            { op: 'constant', value: '2.8', unit: countUnit },
          ],
        },
        countUnit,
      ),
      derivedDefinition(
        'calc.subtract',
        {
          op: 'subtract',
          operands: [
            { op: 'constant', value: '1', unit: countUnit },
            { op: 'constant', value: '3', unit: countUnit },
          ],
        },
        countUnit,
      ),
      derivedDefinition(
        'calc.min',
        {
          op: 'min',
          operands: [
            { op: 'constant', value: '2', unit: countUnit },
            { op: 'constant', value: '1', unit: countUnit },
            { op: 'constant', value: '3', unit: countUnit },
          ],
        },
        countUnit,
      ),
      derivedDefinition(
        'calc.max',
        {
          op: 'max',
          operands: [
            { op: 'constant', value: '2', unit: countUnit },
            { op: 'constant', value: '3', unit: countUnit },
            { op: 'constant', value: '1', unit: countUnit },
          ],
        },
        countUnit,
      ),
      derivedDefinition(
        'calc.multiply',
        {
          op: 'multiply',
          left: { op: 'constant', value: '2', unit: countUnit },
          right: { op: 'constant', value: '3', unit: { dimensions: { usd: 1 } } },
        },
        { dimensions: { count: 1, usd: 1 } },
      ),
      derivedDefinition('calc.divide', {
        op: 'divide',
        left: { op: 'constant', value: '1', unit: countUnit },
        right: { op: 'constant', value: '3', unit: countUnit },
      }),
    ];
    const registry = new MetricRegistry(definitions);
    const calculate = (metricId: string) =>
      registry.evaluate({
        metricId,
        version: '1.0.0',
        subjectKey: 'test-subject',
        asOf: '2026-01-01T00:00:00.000Z',
        snapshot,
        observations: [],
      });

    expect(registry.list().map((definition) => definition.metricId)).toEqual([
      'calc.add',
      'calc.divide',
      'calc.max',
      'calc.min',
      'calc.multiply',
      'calc.subtract',
    ]);
    expect(calculate('calc.add').value).toMatchObject({
      state: 'known',
      value: { exactDecimal: '4' },
    });
    expect(calculate('calc.subtract').value).toMatchObject({
      state: 'known',
      value: { exactDecimal: '-2' },
    });
    expect(calculate('calc.min').value).toMatchObject({
      state: 'known',
      value: { exactDecimal: '1' },
    });
    expect(calculate('calc.max').value).toMatchObject({
      state: 'known',
      value: { exactDecimal: '3' },
    });
    expect(calculate('calc.multiply').value).toMatchObject({
      state: 'known',
      value: { exactDecimal: '6' },
    });
    expect(calculate('calc.divide').value).toEqual({
      state: 'known',
      value: { numerator: '1', denominator: '3', exactDecimal: null },
    });
    expect(calculate('calc.divide').freshness.state).toBe('UNKNOWN');
  });

  it('propagates unavailable, unknown, provider-down, and stale states by priority', () => {
    const source = sourceDefinition();
    const derived = derivedDefinition(
      'test.derived',
      {
        op: 'add',
        operands: [
          { op: 'ref', metricId: 'test.source', version: '1.0.0' },
          { op: 'constant', value: '1', unit: countUnit },
        ],
      },
      countUnit,
      [{ metricId: 'test.source', version: '1.0.0' }],
    );
    const registry = new MetricRegistry([source, derived]);
    const evaluate = (candidate: MetricObservation, asOf = candidate.knownAt) =>
      registry.evaluate({
        metricId: 'test.derived',
        version: '1.0.0',
        subjectKey: candidate.subjectKey,
        asOf,
        snapshot,
        observations: [candidate],
      });
    const base = observation('test.source', '10', '2026-01-01T00:00:00.000Z', 1);
    const providerDown = evaluate({
      ...base,
      value: { state: 'provider_down', provider: 'archive-test', detail: '提供商下线。' },
    });
    const unavailable = evaluate({
      ...base,
      value: { state: 'unavailable', reason: 'NO_ARCHIVE', detail: '历史不可用。' },
      coverage: {
        ...base.coverage,
        data: { state: 'unavailable', reason: 'NO_ARCHIVE' },
      },
    });
    const unknown = evaluate({
      ...base,
      value: { state: 'unknown', reason: 'DEPENDENCY_UNKNOWN', detail: '依赖未知。' },
      coverage: { ...base.coverage, source: { state: 'unknown', reason: 'PARTIAL_SOURCE' } },
    });
    const stale = evaluate(base, '2026-01-01T00:01:01.000Z');

    expect(providerDown.value.state).toBe('provider_down');
    expect(unavailable.value.state).toBe('unavailable');
    expect(unavailable.coverage.data.state).toBe('unavailable');
    expect(unknown.value.state).toBe('unknown');
    expect(unknown.coverage.source.state).toBe('unknown');
    expect(stale.value.state).toBe('stale');
  });

  it('rejects malformed definitions, units, dependency declarations, and formulas', () => {
    const malformed: MetricDefinition[] = [
      { ...sourceDefinition(), metricId: 'Invalid' },
      { ...sourceDefinition(), version: 'one' },
      { ...sourceDefinition(), chineseName: ' ' },
      { ...sourceDefinition(), chineseDescription: '' },
      { ...sourceDefinition(), modelVersion: '' },
      { ...sourceDefinition(), staleAfterSeconds: 1.5 },
      { ...sourceDefinition(), staleAfterSeconds: 0 },
      { ...sourceDefinition(), ledgers: [] },
      { ...sourceDefinition(), granularities: [] },
      { ...sourceDefinition(), outputUnit: { dimensions: { Bad: 1 } } },
      { ...sourceDefinition(), outputUnit: { dimensions: { count: 1.5 } } },
      { ...sourceDefinition(), outputUnit: { dimensions: { count: 9 } } },
      {
        ...sourceDefinition(),
        dependencies: [
          { metricId: 'test.other', version: '1.0.0' },
          { metricId: 'test.other', version: '1.0.0' },
        ],
      },
      {
        ...sourceDefinition(),
        dependencies: [{ metricId: 'test.other', version: '1.0.0' }],
      },
    ];
    for (const definition of malformed) {
      expect(() => new MetricRegistry([definition])).toThrowError(
        expect.objectContaining<Partial<MetricRegistryError>>({ code: 'INVALID_DEFINITION' }),
      );
    }

    const source = sourceDefinition();
    expect(() => new MetricRegistry([source, source])).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'DUPLICATE_DEFINITION' }),
    );
    const missing = derivedDefinition(
      'test.missing',
      { op: 'ref', metricId: 'test.absent', version: '1.0.0' },
      countUnit,
      [{ metricId: 'test.absent', version: '1.0.0' }],
    );
    expect(() => new MetricRegistry([missing])).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'MISSING_DEPENDENCY' }),
    );

    const missingReference = derivedDefinition(
      'test.missing_reference',
      { op: 'constant', value: '1', unit: countUnit },
      countUnit,
      [{ metricId: 'test.source', version: '1.0.0' }],
    );
    expect(() => new MetricRegistry([source, missingReference])).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'INVALID_DEFINITION' }),
    );
    const other = sourceDefinition('test.other');
    const wrongReference = derivedDefinition(
      'test.wrong_reference',
      { op: 'ref', metricId: 'test.other', version: '1.0.0' },
      countUnit,
      [{ metricId: 'test.source', version: '1.0.0' }],
    );
    expect(() => new MetricRegistry([source, other, wrongReference])).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'INVALID_DEFINITION' }),
    );
    const tooFew = derivedDefinition(
      'test.too_few',
      { op: 'add', operands: [{ op: 'constant', value: '1', unit: countUnit }] },
      countUnit,
    );
    expect(() => new MetricRegistry([tooFew])).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'INVALID_DEFINITION' }),
    );
    const mixedUnits = derivedDefinition(
      'test.mixed_units',
      {
        op: 'add',
        operands: [
          { op: 'constant', value: '1', unit: countUnit },
          { op: 'constant', value: '1', unit: scalarUnit },
        ],
      },
      countUnit,
    );
    expect(() => new MetricRegistry([mixedUnits])).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'UNIT_MISMATCH' }),
    );
  });

  it('validates evaluation time, observations, exact values, coverage, and units', () => {
    const registry = createCoreMetricRegistry();
    const base = observation('raw.transfer_count', '10', '2026-01-01T00:00:00.000Z', 1);
    const evaluate = (candidate: MetricObservation) =>
      registry.evaluate({
        metricId: 'raw.transfer_count',
        version: '1.0.0',
        subjectKey: base.subjectKey,
        asOf: '2026-01-01T00:00:00.000Z',
        snapshot,
        observations: [candidate],
      });
    const malformed = [
      { ...base, observationId: '' },
      { ...base, subjectKey: '' },
      { ...base, revision: 1.5 },
      { ...base, revision: -1 },
      { ...base, evidenceScore: -1 },
      { ...base, evidenceScore: 101 },
      { ...base, eventTime: 'invalid' },
      { ...base, knownAt: 'invalid' },
      { ...base, value: { state: 'known' as const, value: '01' } },
      {
        ...base,
        value: { state: 'known' as const, value: '1'.repeat(161) },
      },
      {
        ...base,
        coverage: { ...base.coverage, data: { state: 'known' as const, value: -0.1 } },
      },
      {
        ...base,
        coverage: { ...base.coverage, data: { state: 'known' as const, value: 1.1 } },
      },
    ] satisfies MetricObservation[];
    for (const candidate of malformed) expect(() => evaluate(candidate)).toThrow();

    expect(() =>
      registry.evaluate({
        metricId: 'unknown.metric',
        version: '1.0.0',
        subjectKey: base.subjectKey,
        asOf: '2026-01-01T00:00:00.000Z',
        snapshot,
        observations: [],
      }),
    ).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'INVALID_EVALUATION' }),
    );
    expect(() =>
      registry.evaluate({
        metricId: 'raw.transfer_count',
        version: '1.0.0',
        subjectKey: base.subjectKey,
        asOf: 'invalid',
        snapshot,
        observations: [],
      }),
    ).toThrow();
    expect(() =>
      registry.evaluate({
        metricId: 'raw.transfer_count',
        version: '1.0.0',
        subjectKey: base.subjectKey,
        asOf: '2025-12-31T23:59:59.000Z',
        snapshot,
        observations: [],
      }),
    ).toThrow('Snapshot 不得晚于');
    expect(() => evaluate({ ...base, unit: { dimensions: { usd: 1 } } })).toThrowError(
      expect.objectContaining<Partial<MetricRegistryError>>({ code: 'UNIT_MISMATCH' }),
    );
  });

  it('filters every point-in-time scope and deterministically selects the latest revision', () => {
    const registry = createCoreMetricRegistry();
    const base = observation('raw.transfer_count', '10', '2026-01-01T00:00:00.000Z', 1);
    const wrongSnapshot = { ...snapshot, blockNumber: '99' };
    const filtered: MetricObservation[] = [
      { ...base, metricId: 'raw.active_address_count' },
      { ...base, version: '2.0.0' },
      { ...base, subjectKey: 'other-subject' },
      { ...base, snapshot: wrongSnapshot },
      { ...base, eventTime: '2026-01-01T00:00:01.000Z' },
      { ...base, knownAt: '2026-01-01T00:00:01.000Z' },
    ];
    const missing = registry.evaluate({
      metricId: 'raw.transfer_count',
      version: '1.0.0',
      subjectKey: base.subjectKey,
      asOf: '2026-01-01T00:00:00.000Z',
      snapshot,
      observations: filtered,
    });
    expect(missing.value).toMatchObject({ state: 'unknown', reason: 'NO_PIT_OBSERVATION' });

    const selected = registry.evaluate({
      metricId: 'raw.transfer_count',
      version: '1.0.0',
      subjectKey: base.subjectKey,
      asOf: '2026-01-01T00:00:00.000Z',
      snapshot,
      observations: [
        { ...base, observationId: 'observation-a', value: { state: 'known', value: '1' } },
        {
          ...base,
          observationId: 'observation-b',
          revision: 2,
          value: { state: 'known', value: '2' },
        },
        {
          ...base,
          observationId: 'observation-c',
          revision: 2,
          value: { state: 'known', value: '3' },
        },
      ],
    });
    expect(selected.replay.inputObservationIds).toEqual(['observation-c']);
    expect(selected.value).toMatchObject({ state: 'known', value: { exactDecimal: '3' } });
  });
});
