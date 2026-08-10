import { describe, expect, it } from 'vitest';

import {
  AnalysisMetadataSchema,
  AnalysisSnapshotSchema,
  AnchorReconciliationResultSchema,
  ChainAnchorReadSchema,
  ClaimAuditPolicySchema,
  ClaimRuleSchema,
  FlapLifetimeMaterializationSchema,
  FlapLifetimeRollbackSchema,
  LaunchMechanismSnapshotSchema,
  ProviderHealthSchema,
  knownValue,
  unavailableValue,
  unknownValue,
} from './index.js';

const lifetimeEvidenceId = `ev_${'1'.repeat(24)}`;
const historyEvidenceId = `ev_${'2'.repeat(24)}`;

function flapLifetimeMaterialization() {
  const capturedAt = '2026-08-10T00:00:00.000Z';
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '200',
    blockHash: `0x${'a'.repeat(64)}`,
    parentBlockHash: `0x${'b'.repeat(64)}`,
    finality: 'finalized' as const,
    capturedAt,
    providerVersions: { 'bsc-rpc': 'json-rpc' },
    adapterVersions: { evm: '0.1.0' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'entity-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
  return {
    platform: 'flap' as const,
    token: `0x${'d'.repeat(40)}`,
    dataset: 'binance-mainnet' as const,
    datasetStartBlock: '0',
    targetBlock: '200',
    originScanId: '11111111-1111-4111-8111-111111111111',
    originSearchCoverage: 1,
    origin: knownValue({
      contractCreator: `0x${'e'.repeat(40)}`,
      launchCreator: `0x${'f'.repeat(40)}`,
      bytecodeFingerprint: '3'.repeat(64),
      creationTrace: {
        transactionHash: `0x${'4'.repeat(64)}`,
        blockNumber: '100',
        blockHash: `0x${'5'.repeat(64)}`,
        transactionIndex: '1',
        traceAddress: [0],
      },
      tokenCreatedPosition: {
        transactionHash: `0x${'4'.repeat(64)}`,
        blockNumber: '100',
        blockHash: `0x${'5'.repeat(64)}`,
        transactionIndex: '1',
        logIndex: '2',
      },
      evidenceIds: [`ev_${'3'.repeat(24)}`, `ev_${'4'.repeat(24)}`],
    }),
    historyProjection: {
      scanId: '22222222-2222-4222-8222-222222222222',
      fromBlock: '100',
      toBlock: '200',
      segmentCount: 1,
      transactionCount: 1,
      unrecognizedPortalLogCount: 0,
      requestedRangeCoverage: 1,
      terminalEvidenceId: historyEvidenceId,
    },
    lifetimeCoverage: knownValue(true),
    terminalEvidenceId: lifetimeEvidenceId,
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: capturedAt,
      sourceSet: ['bsc-rpc', 'sqd:binance-mainnet'],
      modelVersion: 'flap-lifetime-materialization-v1',
      confidence: 0.95,
      evidenceIds: [historyEvidenceId, lifetimeEvidenceId],
    },
    evidence: [
      {
        id: lifetimeEvidenceId,
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        kind: 'DERIVED_FEATURE' as const,
        source: 'zerotrace:flap-lifetime-materialization-v1',
        locator: `flap-lifetime:${`0x${'d'.repeat(40)}`}@200`,
        payloadHash: '6'.repeat(64),
        observedAt: capturedAt,
        blockOrSlot: '200',
        finality: 'finalized',
        summary: 'Fixture lifetime materialization.',
      },
    ],
  };
}

function flapLifetimeRollback() {
  const materialization = flapLifetimeMaterialization();
  const terminalEvidenceId = `ev_${'5'.repeat(24)}`;
  const capturedAt = '2026-08-10T00:05:00.000Z';
  const snapshot = {
    ...materialization.metadata.snapshot,
    blockNumber: '220',
    blockHash: `0x${'7'.repeat(64)}`,
    parentBlockHash: `0x${'8'.repeat(64)}`,
    capturedAt,
  };
  return {
    chainId: 'eip155:56' as const,
    token: materialization.token,
    reason: 'FINALIZED_REORG' as const,
    invalidatedHeads: [
      {
        headId: `flh_${'6'.repeat(24)}`,
        scanId: materialization.originScanId,
        targetBlock: materialization.targetBlock,
        targetHash: materialization.metadata.snapshot.blockHash,
        terminalEvidenceId: materialization.terminalEvidenceId,
      },
    ],
    rollbackTo: null,
    observedTarget: { blockNumber: '220', blockHash: snapshot.blockHash },
    lineageCoverage: 1,
    alertId: `dqa_${'7'.repeat(24)}`,
    terminalEvidenceId,
    metadata: {
      snapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 1,
      simulationCoverage: 0,
      freshness: capturedAt,
      sourceSet: ['bsc-rpc-a', 'bsc-rpc-b'],
      modelVersion: 'flap-lifetime-rollback-v1',
      confidence: 1,
      evidenceIds: [materialization.terminalEvidenceId, terminalEvidenceId],
    },
    evidence: [
      {
        id: terminalEvidenceId,
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        kind: 'DERIVED_FEATURE' as const,
        source: 'zerotrace:flap-lifetime-rollback-v1',
        locator: `flap-lifetime-rollback:${materialization.token}:200-220`,
        payloadHash: '9'.repeat(64),
        observedAt: capturedAt,
        blockOrSlot: '220',
        finality: 'finalized',
        summary: 'Fixture finalized lifetime rollback.',
      },
    ],
  };
}

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

describe('launch mechanism snapshots', () => {
  it('requires terminal mechanism fields to preserve explicit Unknown values', () => {
    const unknown = unknownValue('NOT_QUERIED');
    const snapshot = LaunchMechanismSnapshotSchema.parse({
      platform: 'flap',
      platformVersion: knownValue('v5.8.6'),
      deploymentId: knownValue('eip155:56:portal'),
      ledger: 'EVM',
      chainId: 'eip155:56',
      factoryOrProgram: knownValue(`0x${'1'.repeat(40)}`),
      creator: unknown,
      lifecycle: 'PRIMARY_MARKET',
      quoteAsset: knownValue('eip155:56:native'),
      curveType: knownValue('FLAP_VIRTUAL_CONSTANT_PRODUCT'),
      realBaseReserve: unknown,
      realQuoteReserve: knownValue('10'),
      virtualBaseReserve: knownValue('20'),
      virtualQuoteReserve: knownValue('30'),
      totalSupply: unknown,
      curveSupply: unknown,
      circulatingSupply: knownValue('40'),
      remainingSupply: unknown,
      progress: knownValue('0.5'),
      graduationCondition: knownValue('circulatingSupply >= dexSupplyThresh'),
      graduationThreshold: knownValue('100'),
      currentSellCapacity: unknown,
      buyFeeBps: unknown,
      sellFeeBps: unknown,
      creatorFeeBps: unknown,
      protocolFeeBps: unknown,
      taxModel: knownValue('NONE'),
      buyTaxBps: knownValue('0'),
      sellTaxBps: knownValue('0'),
      taxAllocations: unknown,
      fundRecipient: unknown,
      taxProcessor: unknown,
      dividendContract: unknown,
      vault: unknown,
      migrationTarget: unknown,
      migrationPool: knownValue(`0x${'0'.repeat(40)}`),
      lpOwner: unknown,
      lpLocked: unknown,
      lpBurned: unknown,
      lpClaimRight: unknown,
      antiSniperOrFarmerSettings: unknown,
      rawConfigHash: 'a'.repeat(64),
      sourceBlockOrSlot: '100',
      sourceVersion: 'flap-getTokenV6-v1',
      evidenceIds: ['ev_fixture'],
    });

    expect(snapshot.currentSellCapacity).toEqual(unknown);
    expect(snapshot.buyTaxBps).toEqual({ state: 'known', value: '0' });
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

describe('Flap lifetime materialization', () => {
  it('accepts exact finalized origin-to-target coverage', () => {
    expect(FlapLifetimeMaterializationSchema.safeParse(flapLifetimeMaterialization()).success).toBe(
      true,
    );
  });

  it('rejects known lifetime coverage when history is absent or ends before the target', () => {
    const materialization = flapLifetimeMaterialization();
    expect(
      FlapLifetimeMaterializationSchema.safeParse({
        ...materialization,
        historyProjection: null,
      }).success,
    ).toBe(false);
    expect(
      FlapLifetimeMaterializationSchema.safeParse({
        ...materialization,
        historyProjection: {
          ...materialization.historyProjection,
          toBlock: '199',
        },
      }).success,
    ).toBe(false);
  });

  it('rejects a target Snapshot mismatch instead of degrading it to zero coverage', () => {
    const materialization = flapLifetimeMaterialization();
    expect(
      FlapLifetimeMaterializationSchema.safeParse({
        ...materialization,
        metadata: {
          ...materialization.metadata,
          snapshot: { ...materialization.metadata.snapshot, blockHash: `0x${'9'.repeat(64)}` },
        },
        targetBlock: '201',
      }).success,
    ).toBe(false);
  });
});

describe('Flap lifetime rollback', () => {
  it('accepts a fully evidenced invalidated suffix at one reconciled Snapshot', () => {
    expect(FlapLifetimeRollbackSchema.safeParse(flapLifetimeRollback()).success).toBe(true);
  });

  it('rejects incomplete lineage coverage and a Snapshot mismatch', () => {
    const rollback = flapLifetimeRollback();
    expect(
      FlapLifetimeRollbackSchema.safeParse({ ...rollback, lineageCoverage: 0.5 }).success,
    ).toBe(false);
    expect(
      FlapLifetimeRollbackSchema.safeParse({
        ...rollback,
        metadata: {
          ...rollback.metadata,
          snapshot: { ...rollback.metadata.snapshot, blockHash: `0x${'0'.repeat(64)}` },
        },
      }).success,
    ).toBe(false);
  });
});

describe('claim audit contracts', () => {
  const claim = {
    id: 'community-allocation',
    assetId: 'eip155:56:token',
    sourceAddress: 'tax-receiver',
    destinationAddress: 'community-fund',
    role: 'COMMUNITY_FUND',
    expectedAction: 'DISTRIBUTE',
    expectedShareBps: '2000',
    window: {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-10T00:00:00.000Z',
    },
    claimEvidenceIds: ['ev_claim'],
  };

  it('accepts an Evidence-linked bounded claim and rejects impossible percentages', () => {
    expect(ClaimRuleSchema.safeParse(claim).success).toBe(true);
    expect(ClaimRuleSchema.safeParse({ ...claim, expectedShareBps: '10001' }).success).toBe(false);
    expect(ClaimRuleSchema.safeParse({ ...claim, claimEvidenceIds: [] }).success).toBe(false);
  });

  it('requires the verified error band to be no wider than the partial band', () => {
    expect(
      ClaimAuditPolicySchema.safeParse({
        verifiedAmountToleranceBps: '50',
        partialAmountToleranceBps: '500',
        maximumAttributionHops: 4,
      }).success,
    ).toBe(true);
    expect(
      ClaimAuditPolicySchema.safeParse({
        verifiedAmountToleranceBps: '501',
        partialAmountToleranceBps: '500',
        maximumAttributionHops: 4,
      }).success,
    ).toBe(false);
  });
});
