import { describe, expect, it } from 'vitest';

import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
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

  it('accepts explicit transport resilience diagnostics', () => {
    const result = ProviderHealthSchema.safeParse({
      id: 'ethereum-rpc',
      ledger: 'EVM',
      status: 'UP',
      capabilities: ['CURRENT_STATE'],
      checkedAt: new Date().toISOString(),
      latencyMs: 12,
      lastSuccessAt: new Date().toISOString(),
      head: { state: 'known', value: '123' },
      lag: { state: 'unknown', reason: 'NOT_QUERIED' },
      transport: {
        endpointId: 'ethereum-rpc',
        activeEndpointId: 'ethereum-rpc-2',
        circuitState: 'CLOSED',
        circuitOpenUntil: null,
        logicalRequests: 2,
        attempts: 3,
        successes: 2,
        failures: 0,
        retries: 1,
        rateLimitDelays: 0,
        cacheHits: 1,
        cacheMisses: 1,
        failovers: 1,
        lastAttemptAt: new Date().toISOString(),
        lastSuccessAt: new Date().toISOString(),
        lastFailureAt: null,
      },
    });

    expect(result.success).toBe(true);
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

describe('analysis snapshots', () => {
  it('requires explicit EVM and Bitcoin finality semantics', () => {
    const common = {
      capturedAt: '2026-08-10T00:00:00.000Z',
      providerVersions: { fixture: '1' },
      adapterVersions: { fixture: '1' },
      configHash: 'a'.repeat(64),
      entityModelVersion: 'entity-v0.1.0',
      labelSnapshot: 'labels-empty-v1',
    };
    const evm = {
      ...common,
      ledger: 'EVM',
      chainId: 'eip155:1',
      blockNumber: '1',
      blockHash: `0x${'b'.repeat(64)}`,
    };
    const bitcoin = {
      ...common,
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      height: '1',
      blockHash: 'c'.repeat(64),
    };

    expect(AnalysisSnapshotSchema.safeParse(evm).success).toBe(false);
    expect(AnalysisSnapshotSchema.safeParse({ ...evm, finality: 'finalized' }).success).toBe(true);
    expect(AnalysisSnapshotSchema.safeParse(bitcoin).success).toBe(false);
    expect(AnalysisSnapshotSchema.safeParse({ ...bitcoin, finality: 'best-chain' }).success).toBe(
      true,
    );
  });
});
