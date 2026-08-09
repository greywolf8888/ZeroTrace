import { describe, expect, it } from 'vitest';

import {
  AnalysisMetadataSchema,
  ProviderHealthSchema,
  knownValue,
  unavailableValue,
  unknownValue,
} from './index.js';

describe('knowledge values', () => {
  it('keeps known zero distinct from unknown', () => {
    expect(knownValue(0)).toEqual({ state: 'known', value: 0 });
    expect(unknownValue('INSUFFICIENT_DATA')).toEqual({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
    expect(unknownValue('STALE', 'Head is behind.')).toEqual({
      state: 'unknown',
      reason: 'STALE',
      detail: 'Head is behind.',
    });
    expect(unavailableValue('PROVIDER_DOWN')).toEqual({
      state: 'unavailable',
      reason: 'PROVIDER_DOWN',
    });
    expect(unavailableValue('RATE_LIMITED', 'Retry later.')).toEqual({
      state: 'unavailable',
      reason: 'RATE_LIMITED',
      detail: 'Retry later.',
    });
  });

  it('rejects a provider health payload that represents an unknown head as zero', () => {
    const result = ProviderHealthSchema.safeParse({
      id: 'solana-mainnet-rpc',
      ledger: 'SOLANA',
      status: 'DOWN',
      capabilities: ['CURRENT_STATE'],
      checkedAt: new Date().toISOString(),
      latencyMs: null,
      lastSuccessAt: null,
      head: { state: 'known', value: 0 },
      lag: { state: 'unknown', reason: 'PROVIDER_DOWN' },
    });

    expect(result.success).toBe(false);
  });
});

describe('analysis metadata', () => {
  it('requires explicit coverage dimensions', () => {
    const result = AnalysisMetadataSchema.safeParse({
      snapshot: null,
      dataCoverage: 0,
      sourceCoverage: 0,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: null,
      sourceSet: [],
      modelVersion: 'entity-v0.1.0',
      confidence: 0,
      evidenceIds: [],
    });

    expect(result.success).toBe(true);
  });
});
