import { describe, expect, it } from 'vitest';

import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  AnchorReconciliationResultSchema,
  ChainAnchorReadSchema,
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
        cacheBypasses: 2,
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

  it('requires a chain anchor to match its replay Snapshot and source set', () => {
    const snapshot = {
      ledger: 'EVM' as const,
      chainId: 'eip155:1',
      blockNumber: '10',
      blockHash: `0x${'a'.repeat(64)}`,
      parentBlockHash: `0x${'b'.repeat(64)}`,
      finality: 'finalized' as const,
      capturedAt: '2026-08-10T00:00:00.000Z',
      providerVersions: { 'rpc-a': 'json-rpc' },
      adapterVersions: { evm: 'test' },
      configHash: 'c'.repeat(64),
      entityModelVersion: 'entity-unapplied',
      labelSnapshot: 'labels-unapplied',
    };
    const read = {
      anchor: {
        ledger: 'EVM' as const,
        chainId: 'eip155:1',
        position: '10',
        hash: `0x${'a'.repeat(64)}`,
        parentPosition: '9',
        parentHash: `0x${'b'.repeat(64)}`,
        finality: 'finalized' as const,
        source: 'rpc-a',
        observedAt: snapshot.capturedAt,
      },
      snapshot,
      payload: { number: '0xa' },
    };

    expect(ChainAnchorReadSchema.safeParse(read).success).toBe(true);
    expect(
      ChainAnchorReadSchema.safeParse({
        ...read,
        anchor: { ...read.anchor, hash: `0x${'d'.repeat(64)}` },
      }).success,
    ).toBe(false);
    expect(
      ChainAnchorReadSchema.safeParse({
        ...read,
        anchor: { ...read.anchor, source: 'rpc-unknown' },
      }).success,
    ).toBe(false);
    expect(
      ChainAnchorReadSchema.safeParse({
        ...read,
        anchor: { ...read.anchor, parentHash: `0x${'e'.repeat(64)}` },
      }).success,
    ).toBe(false);
    expect(
      ChainAnchorReadSchema.safeParse({
        ...read,
        anchor: { ...read.anchor, parentPosition: undefined, parentHash: undefined },
      }).success,
    ).toBe(false);
  });
});

describe('data-quality states', () => {
  it('keeps insufficient reconciliation explicitly unknown rather than an empty agreement', () => {
    const result = AnchorReconciliationResultSchema.safeParse({
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      status: 'INSUFFICIENT_SOURCES',
      requiredSources: 2,
      configuredSources: 1,
      observedSources: 1,
      comparisonPosition: knownValue('840000'),
      canonicalAnchor: unknownValue('INSUFFICIENT_DATA'),
      sourceIndependence: unknownValue('NOT_QUERIED'),
      snapshotSet: [],
      sources: [],
      alerts: [],
      metadata: {
        snapshot: null,
        dataCoverage: 1,
        sourceCoverage: 1,
        historyCoverage: 0,
        simulationCoverage: 0,
        freshness: '2026-08-10T00:00:00.000Z',
        sourceSet: ['esplora-a'],
        modelVersion: 'anchor-reconciliation-v1',
        confidence: 0,
        evidenceIds: [],
      },
    });

    expect(result.success).toBe(true);
  });
});
