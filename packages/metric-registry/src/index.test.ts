import { describe, expect, it } from 'vitest';

import type { AnalysisSnapshot } from '@zerotrace/schemas';

import {
  createCoreMetricRegistry,
  MetricRegistry,
  type MetricDefinition,
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
});
