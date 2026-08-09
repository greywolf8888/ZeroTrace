import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BitcoinUtxoLedgerAdapter,
  EvmLedgerAdapter,
  ProviderRegistry,
  SolanaLedgerAdapter,
  type JsonRpcTransport,
  type RestTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import {
  AnchorDataQualityService,
  MemoryDataQualityRepository,
  type AnchorReconciliationTarget,
  type ChainAnchorReader,
} from '@zerotrace/data-quality';
import { createEvidence, EvidenceLedger, hashPayload } from '@zerotrace/evidence';
import type { ChainAnchorRead } from '@zerotrace/schemas';
import { StorageError, type EvidenceRepository } from '@zerotrace/storage';

import { createApp } from '../../apps/api/src/app.js';
import type { AppConfig } from '../../apps/api/src/config.js';
import type { AppRuntime } from '../../apps/api/src/runtime.js';

const config: AppConfig = {
  environment: 'test',
  host: '127.0.0.1',
  port: 8080,
  corsOrigins: ['http://localhost:5173'],
  logLevel: 'silent',
  requestTimeoutMs: 1_000,
  healthCacheTtlMs: 0,
  dataQualityMinSources: 2,
  providerAllowedHosts: [],
  allowPrivateProviderUrls: false,
  providerResilience: {
    maxAttempts: 3,
    retryBaseDelayMs: 0,
    retryMaxDelayMs: 0,
    circuitFailureThreshold: 5,
    circuitResetMs: 30_000,
    cacheTtlMs: 0,
    cacheMaxEntries: 100,
  },
  ethereumRpcUrls: [],
  ethereumChainId: 1,
  ethereumSnapshotTag: 'finalized',
  ethereumRequestsPerSecond: 0,
  bscRpcUrls: [],
  bscChainId: 56,
  bscSnapshotTag: 'finalized',
  bscRequestsPerSecond: 0,
  bitcoinEsploraUrls: [],
  bitcoinEsploraRequestsPerSecond: 0,
  solanaRpcUrls: [],
  solanaRequestsPerSecond: 0,
  solanaCommitment: 'finalized',
  gmgnConfigured: false,
  jupiterConfigured: false,
  etherscanConfigured: false,
  duneConfigured: false,
  nansenConfigured: false,
  arkhamConfigured: false,
};

function testDataQuality(
  evidenceLedger: EvidenceLedger,
  targets: readonly AnchorReconciliationTarget[] = [
    { ledger: 'EVM', chainId: 'eip155:1', readers: [] },
    { ledger: 'EVM', chainId: 'eip155:56', readers: [] },
    { ledger: 'BITCOIN', chainId: 'bitcoin-mainnet', readers: [] },
    { ledger: 'SOLANA', chainId: 'solana-mainnet', readers: [] },
  ],
): AnchorDataQualityService {
  return new AnchorDataQualityService({
    targets,
    repository: new MemoryDataQualityRepository(),
    evidence: {
      put: async (evidence, sourceEvidenceIds = [], snapshot) =>
        evidenceLedger.get(evidence.id) ??
        evidenceLedger.add(evidence, sourceEvidenceIds, snapshot),
    },
    requiredSources: config.dataQualityMinSources,
  });
}

class FakeTransport implements JsonRpcTransport {
  readonly endpointId = 'ethereum-rpc';
  readonly #responses: Record<string, unknown>;
  readonly #sourceIds: Record<string, string>;

  constructor(responses: Record<string, unknown>, sourceIds: Record<string, string> = {}) {
    this.#responses = responses;
    this.#sourceIds = sourceIds;
  }

  async request<T>(method: string): Promise<T> {
    return this.#responses[method] as T;
  }

  async requestSourced<T>(
    method: string,
    _params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    return {
      value: this.#responses[method] as T,
      endpointId: this.#sourceIds[method] ?? this.endpointId,
    };
  }
}

class FakeRestTransport implements RestTransport {
  readonly endpointId = 'bitcoin-esplora';
  readonly #responses: Record<string, unknown>;
  readonly #sourceIds: Record<string, string>;

  constructor(responses: Record<string, unknown>, sourceIds: Record<string, string> = {}) {
    this.#responses = responses;
    this.#sourceIds = sourceIds;
  }

  async getText(path: string): Promise<string> {
    return String(this.#responses[path]);
  }

  async getJson<T>(path: string): Promise<T> {
    return this.#responses[path] as T;
  }

  async getTextSourced(path: string): Promise<TransportObservation<string>> {
    return {
      value: String(this.#responses[path]),
      endpointId: this.#sourceIds[path] ?? this.endpointId,
    };
  }

  async getJsonSourced<T>(path: string): Promise<TransportObservation<T>> {
    return {
      value: this.#responses[path] as T,
      endpointId: this.#sourceIds[path] ?? this.endpointId,
    };
  }
}

function runtimeWithEvm(): AppRuntime {
  const evm = new EvmLedgerAdapter(
    { id: 'ethereum-rpc', chainId: 1, chainName: 'Ethereum' },
    new FakeTransport(
      {
        eth_chainId: '0x1',
        eth_blockNumber: '0x10',
        eth_getBlockByNumber: {
          number: '0x10',
          hash: '0x' + 'a'.repeat(64),
          parentHash: '0x' + '9'.repeat(64),
          timestamp: '0x65',
        },
        eth_getBalance: '0x0',
        eth_getCode: '0x',
      },
      {
        eth_getBlockByNumber: 'ethereum-anchor',
        eth_getBalance: 'ethereum-state-a',
        eth_getCode: 'ethereum-state-b',
      },
    ),
  );
  const evidenceLedger = new EvidenceLedger();
  return {
    providerRegistry: new ProviderRegistry([evm]),
    evmAdapters: new Map([[1, evm]]),
    evidenceLedger,
    dataQuality: testDataQuality(evidenceLedger),
    ingestionStorage: {},
  };
}

const defaultSolanaAccount = {
  data: ['', 'base64'],
  lamports: 123,
  owner: '11111111111111111111111111111111',
  executable: false,
  rentEpoch: 0,
  space: 0,
};

function runtimeWithAllLedgers(solanaAccountValue: unknown = defaultSolanaAccount): AppRuntime {
  const evm = new EvmLedgerAdapter(
    { id: 'ethereum-rpc', chainId: 1, chainName: 'Ethereum' },
    new FakeTransport({
      eth_chainId: '0x1',
      eth_blockNumber: '0x10',
      eth_getBlockByNumber: {
        number: '0x10',
        hash: '0x' + 'a'.repeat(64),
        parentHash: '0x' + '9'.repeat(64),
        timestamp: '0x65',
      },
      eth_getBalance: '0x0',
      eth_getCode: '0x6000',
    }),
  );
  const bitcoin = new BitcoinUtxoLedgerAdapter(
    { id: 'bitcoin-esplora' },
    new FakeRestTransport(
      {
        '/blocks/tip/height': '840000',
        '/block-height/840000': 'b'.repeat(64),
        [`/block/${'b'.repeat(64)}`]: {
          id: 'b'.repeat(64),
          height: 840000,
          previousblockhash: 'a'.repeat(64),
        },
        '/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4': {
          address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
          chain_stats: {
            funded_txo_count: 2,
            funded_txo_sum: 500,
            spent_txo_count: 1,
            spent_txo_sum: 200,
            tx_count: 3,
          },
          mempool_stats: {
            funded_txo_count: 1,
            funded_txo_sum: 10,
            spent_txo_count: 1,
            spent_txo_sum: 20,
            tx_count: 2,
          },
        },
      },
      {
        '/blocks/tip/height': 'bitcoin-anchor-a',
        '/block-height/840000': 'bitcoin-anchor-b',
        [`/block/${'b'.repeat(64)}`]: 'bitcoin-anchor-b',
        '/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4': 'bitcoin-state',
      },
    ),
  );
  const solana = new SolanaLedgerAdapter(
    { id: 'solana-rpc', commitment: 'finalized' },
    new FakeTransport(
      {
        getHealth: 'ok',
        getSlot: 300_000_000,
        getBlock: {
          blockhash: '11111111111111111111111111111111',
          previousBlockhash: '22222222222222222222222222222222',
          parentSlot: 299_999_999,
          blockTime: 1_700_000_000,
        },
        getAccountInfo: {
          context: { slot: 300_000_000 },
          value: solanaAccountValue,
        },
      },
      {
        getSlot: 'solana-anchor-a',
        getBlock: 'solana-anchor-b',
        getAccountInfo: 'solana-state',
      },
    ),
  );
  const evidenceLedger = new EvidenceLedger();
  return {
    providerRegistry: new ProviderRegistry([evm, bitcoin, solana]),
    evmAdapters: new Map([[1, evm]]),
    bitcoinAdapter: bitcoin,
    solanaAdapter: solana,
    evidenceLedger,
    dataQuality: testDataQuality(evidenceLedger),
    ingestionStorage: {},
  };
}

function repository(overrides: Partial<EvidenceRepository> = {}): EvidenceRepository {
  return {
    put: vi.fn(async (evidence, sourceEvidenceIds = [], snapshot) => ({
      evidence,
      sourceEvidenceIds: [...sourceEvidenceIds].sort(),
      ...(snapshot === undefined ? {} : { snapshot }),
    })),
    get: vi.fn(async () => undefined),
    drilldown: vi.fn(async () => []),
    health: vi.fn(async () => ({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
      checkedAt: new Date().toISOString(),
    })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

const fixtureSnapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:1',
  blockNumber: '16',
  blockHash: '0x' + 'a'.repeat(64),
  finality: 'finalized' as const,
  capturedAt: '2026-08-09T00:00:00.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { evm: '0.1.0' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'none',
};

function fixtureMetadata(evidenceId: string) {
  return {
    snapshot: fixtureSnapshot,
    dataCoverage: 1,
    sourceCoverage: 1,
    historyCoverage: 0,
    simulationCoverage: 1,
    freshness: '2026-08-09T00:00:00.000Z',
    sourceSet: ['fixture'],
    modelVersion: 'fixture-v0.1.0',
    confidence: 1,
    evidenceIds: [evidenceId],
  };
}

function evmAnchorReader(source: string, blockHash: string): ChainAnchorReader {
  const observedAt = '2026-08-10T01:00:00.000Z';
  const parentHash = '0x' + '9'.repeat(64);
  const read: ChainAnchorRead = {
    anchor: {
      ledger: 'EVM',
      chainId: 'eip155:1',
      position: '100',
      hash: blockHash,
      parentPosition: '99',
      parentHash,
      finality: 'finalized',
      source,
      observedAt,
    },
    snapshot: {
      ...fixtureSnapshot,
      blockNumber: '100',
      blockHash,
      parentBlockHash: parentHash,
      capturedAt: observedAt,
      providerVersions: { [source]: 'json-rpc' },
      configHash: hashPayload({ source }),
    },
    payload: { number: '0x64', hash: blockHash, parentHash },
  };
  return {
    sourceId: source,
    ledger: 'EVM',
    chainId: 'eip155:1',
    readHead: async () => read,
    readAt: async () => read,
  };
}

function addFixtureEvidence(runtime: AppRuntime, blockOrSlot = '16') {
  const evidence = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:1',
    kind: 'CONTRACT_STATE',
    source: 'fixture',
    locator: 'pool:pool-1@' + blockOrSlot,
    payload: { baseReserve: '1000', quoteReserve: '1000', feeBps: '0', blockOrSlot },
    blockOrSlot,
    finality: 'finalized',
    summary: 'Pool reserves at fixture block.',
  });
  runtime.evidenceLedger.add(evidence, [], { ...fixtureSnapshot, blockNumber: blockOrSlot });
  return evidence;
}

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('ZeroTrace API contract', () => {
  it('advertises the read-only runtime boundary', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'UP', readOnly: true });
  });

  it('classifies identifiers without doing a network lookup', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=0x52908400098527886e0f7030069857d2e4169ee7',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().candidates[0]).toMatchObject({ ledger: 'EVM', type: 'ADDRESS' });
  });

  it('binds a subject fact to a snapshot and evidence record', async () => {
    const runtime = runtimeWithEvm();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/0x52908400098527886e0f7030069857d2e4169ee7?chainId=eip155:1',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.facts.nativeBalanceAtomic).toEqual({ state: 'known', value: '0' });
    expect(body.metadata.snapshot).toMatchObject({
      ledger: 'EVM',
      blockNumber: '16',
      finality: 'finalized',
      providerVersions: { 'ethereum-anchor': 'json-rpc' },
    });
    expect(body.metadata.sourceSet).toEqual([
      'ethereum-anchor',
      'ethereum-state-a',
      'ethereum-state-b',
    ]);
    expect(body.evidence[0]).toMatchObject({
      finality: 'finalized',
      source: 'ethereum-state-a|ethereum-state-b',
    });
    expect(body.evidence).toHaveLength(1);
    expect(runtime.evidenceLedger.get(body.evidence[0].id)).toBeDefined();
  });

  it('persists subject Evidence with its replayable Snapshot when durable storage is configured', async () => {
    const runtime = runtimeWithEvm();
    const durable = repository();
    runtime.evidenceRepository = durable;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/0x52908400098527886e0f7030069857d2e4169ee7?chainId=eip155:1',
    });

    expect(response.statusCode).toBe(200);
    expect(durable.put).toHaveBeenCalledOnce();
    expect(vi.mocked(durable.put).mock.calls[0]?.[2]).toMatchObject({
      ledger: 'EVM',
      blockNumber: '16',
    });
  });

  it('returns explicit unknowns for an engine with no evidence', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/entities/resolve',
      payload: {
        subjectA: 'a',
        subjectB: 'b',
        features: [],
        metadata: {
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
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().sameControllerProbability).toEqual({
      state: 'unknown',
      reason: 'INSUFFICIENT_DATA',
    });
  });

  it('marks unfinished capabilities as 501 instead of returning placeholders', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/api/v1/claims' });
    expect(response.statusCode).toBe(501);
    expect(response.json().status).toMatchObject({ state: 'unknown', reason: 'NOT_IMPLEMENTED' });
  });

  it('rejects an RV calculation without a snapshot and ledger-backed evidence', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: ['ev_missing'],
        },
        inputQuantity: '100',
        metadata: {
          snapshot: null,
          dataCoverage: 1,
          sourceCoverage: 1,
          historyCoverage: 0,
          simulationCoverage: 1,
          freshness: null,
          sourceSet: ['fixture'],
          modelVersion: 'rv-v0.1.0',
          confidence: 1,
          evidenceIds: ['ev_missing'],
        },
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('UNGROUNDED_ANALYSIS');
  });

  it('persists derived RV evidence and supports source drilldown', async () => {
    const runtime = runtimeWithEvm();
    const sourceEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'CONTRACT_STATE',
      source: 'fixture',
      locator: 'pool:pool-1@16',
      payload: { baseReserve: '1000', quoteReserve: '1000', feeBps: '0' },
      blockOrSlot: '16',
      finality: 'finalized',
      summary: 'Pool reserves at fixture block.',
    });
    runtime.evidenceLedger.add(sourceEvidence, [], fixtureSnapshot);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: [sourceEvidence.id],
        },
        inputQuantity: '100',
        metadata: {
          snapshot: {
            ledger: 'EVM',
            chainId: 'eip155:1',
            blockNumber: '16',
            blockHash: '0x' + 'a'.repeat(64),
            finality: 'finalized',
            capturedAt: '2026-08-09T00:00:00.000Z',
            providerVersions: { fixture: '1' },
            adapterVersions: { evm: '0.1.0' },
            configHash: 'b'.repeat(64),
            entityModelVersion: 'entity-v0.1.0',
            labelSnapshot: 'none',
          },
          dataCoverage: 1,
          sourceCoverage: 1,
          historyCoverage: 0,
          simulationCoverage: 1,
          freshness: '2026-08-09T00:00:00.000Z',
          sourceSet: ['fixture'],
          modelVersion: 'rv-v0.1.0',
          confidence: 1,
          evidenceIds: [sourceEvidence.id],
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.realizableValue).toEqual({ state: 'known', value: '91' });
    expect(body.evidence).toHaveLength(1);
    expect(body.evidence[0]).toMatchObject({ kind: 'DERIVED_FEATURE', ledger: 'EVM' });
    expect(runtime.evidenceLedger.drilldown(body.evidence[0].id)).toHaveLength(2);
  });

  it('reports system, chain, platform, metrics, and provider capability truth', async () => {
    const app = await createApp({ config, runtime: runtimeWithAllLedgers(), logger: false });
    apps.push(app);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'UP', readOnly: true });
    expect(ready.json().providers).toHaveLength(3);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({
      status: 'UP',
      readOnly: true,
      ingestionStorage: { status: 'UNCONFIGURED', configured: 0, required: 3 },
    });

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().boundaries).toEqual({
      transactionSigning: 'FORBIDDEN',
      transactionBroadcasting: 'FORBIDDEN',
      privateKeyStorage: 'FORBIDDEN',
    });
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'finalized-historical-ingestion',
        status: 'STORAGE_REQUIRED',
      }),
    );

    const chains = await app.inject({ method: 'GET', url: '/api/v1/chains' });
    expect(chains.json().chains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chainId: 'eip155:1', configured: true }),
        expect.objectContaining({ chainId: 'bitcoin-mainnet', configured: true }),
        expect.objectContaining({ chainId: 'solana-mainnet', configured: true }),
      ]),
    );

    const platforms = await app.inject({ method: 'GET', url: '/api/v1/platforms' });
    expect(platforms.json()).toMatchObject({ gmgnConfigured: false });
    expect(platforms.json().platforms.length).toBeGreaterThan(5);

    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.headers['content-type']).toContain('text/plain');
    expect(metrics.body).toContain('zerotrace_http_requests_total');
  });

  it('surfaces cross-source anchor disagreement as Unknown with Evidence-linked alerts', async () => {
    const runtime = runtimeWithEvm();
    runtime.dataQuality = testDataQuality(runtime.evidenceLedger, [
      {
        ledger: 'EVM',
        chainId: 'eip155:1',
        readers: [
          evmAnchorReader('ethereum-a', '0x' + 'a'.repeat(64)),
          evmAnchorReader('ethereum-b', '0x' + 'b'.repeat(64)),
        ],
      },
    ]);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/v1/data-quality/anchors' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'DEGRADED',
      durable: false,
      configuredSources: { 'eip155:1': 2 },
      storage: { status: 'EPHEMERAL', backend: 'MEMORY', durable: false },
      results: [
        {
          status: 'DISAGREEMENT',
          comparisonPosition: { state: 'known', value: '100' },
          canonicalAnchor: { state: 'unknown', reason: 'CONFLICTING_SOURCES' },
          sourceIndependence: { state: 'unknown', reason: 'NOT_QUERIED' },
          metadata: { snapshot: null, sourceCoverage: 1, confidence: 1 },
          alerts: [{ kind: 'CROSS_SOURCE_DISAGREEMENT', severity: 'CRITICAL' }],
        },
      ],
    });
    const result = response.json().results[0];
    expect(result.metadata.evidenceIds.length).toBeGreaterThanOrEqual(3);
    expect(
      result.metadata.evidenceIds.every(
        (evidenceId: string) => runtime.evidenceLedger.get(evidenceId) !== undefined,
      ),
    ).toBe(true);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({
      status: 'DEGRADED',
      dataQuality: { status: 'DEGRADED' },
    });
    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'cross-source-anchor-reconciliation',
        status: 'IMPLEMENTED_EPHEMERAL_PENDING_INDEPENDENT_VALIDATION',
      }),
    );
  });

  it('reports each durable ingestion backend and degrades aggregate health on failure', async () => {
    const runtime = runtimeWithAllLedgers();
    runtime.ingestionStorage = {
      rawFacts: {
        health: vi.fn(async () => ({
          status: 'UP' as const,
          backend: 'CLICKHOUSE' as const,
          durable: true as const,
          checkedAt: new Date().toISOString(),
          table: 'zerotrace.raw_chain_facts' as const,
          logicalDeduplication: 'REPLACING_MERGE_TREE' as const,
        })),
      },
      checkpoints: {
        health: vi.fn(async () => ({
          status: 'UP' as const,
          backend: 'POSTGRES' as const,
          durable: true as const,
          checkedAt: new Date().toISOString(),
        })),
      },
      artifacts: {
        health: vi.fn(async () => ({
          status: 'DOWN' as const,
          backend: 'S3_COMPATIBLE' as const,
          durable: true as const,
          checkedAt: new Date().toISOString(),
          bucket: 'zerotrace-raw',
          versioning: true as const,
          errorCode: 'OBJECT_STORE_UNAVAILABLE' as const,
        })),
      },
    };
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ status: 'UP' });
    expect(ready.json()).not.toHaveProperty('ingestionStorage');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.json()).toMatchObject({
      status: 'DEGRADED',
      ingestionStorage: {
        status: 'DOWN',
        configured: 3,
        required: 3,
        rawFacts: { status: 'UP', backend: 'CLICKHOUSE' },
        checkpoints: { status: 'UP', backend: 'POSTGRES' },
        artifacts: {
          status: 'DOWN',
          backend: 'S3_COMPATIBLE',
          errorCode: 'OBJECT_STORE_UNAVAILABLE',
        },
      },
    });

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().core).toContainEqual(
      expect.objectContaining({
        id: 'finalized-historical-ingestion',
        status: 'IMPLEMENTED_DURABLE',
        detail: expect.stringContaining('EVM logs/traces/state diffs'),
      }),
    );
  });

  it('fails readiness explicitly when configured durable storage is down', async () => {
    const runtime = runtimeWithEvm();
    runtime.evidenceRepository = repository({
      health: vi.fn(async () => ({
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt: new Date().toISOString(),
        errorCode: 'STORAGE_UNAVAILABLE',
      })),
      put: vi.fn(async () => {
        throw new StorageError('STORAGE_UNAVAILABLE', 'Durable Evidence storage is unavailable.', {
          retryable: true,
        });
      }),
    });
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      status: 'DEGRADED',
      storage: { status: 'DOWN', durable: true, errorCode: 'STORAGE_UNAVAILABLE' },
    });
    const subject = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/0x52908400098527886e0f7030069857d2e4169ee7?chainId=eip155:1',
    });
    expect(subject.statusCode).toBe(503);
    expect(subject.json().error).toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      retryable: true,
    });
  });

  it('normalizes Bitcoin and Solana subject state with evidence', async () => {
    const runtime = runtimeWithAllLedgers();
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const bitcoin = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/BITCOIN/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
    });
    expect(bitcoin.statusCode).toBe(200);
    expect(bitcoin.json().facts).toMatchObject({
      confirmedBalanceSats: { state: 'known', value: '300' },
      mempoolDeltaSats: { state: 'known', value: '-10' },
      transactionCount: { state: 'known', value: '3' },
    });
    expect(bitcoin.json().metadata.snapshot).toMatchObject({
      height: '840000',
      blockHash: 'b'.repeat(64),
      finality: 'best-chain',
      providerVersions: {
        'bitcoin-anchor-a': 'esplora-http',
        'bitcoin-anchor-b': 'esplora-http',
      },
    });
    expect(bitcoin.json().metadata.sourceSet).toEqual([
      'bitcoin-anchor-a',
      'bitcoin-anchor-b',
      'bitcoin-state',
    ]);
    expect(bitcoin.json().evidence[0].source).toBe('bitcoin-state');

    const bitcoinEvidenceId = bitcoin.json().evidence[0].id;
    const evidence = await app.inject({
      method: 'GET',
      url: '/api/v1/evidence/' + bitcoinEvidenceId,
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.json().evidence.ledger).toBe('BITCOIN');

    const drilldown = await app.inject({
      method: 'GET',
      url: '/api/v1/evidence/' + bitcoinEvidenceId + '/drilldown',
    });
    expect(drilldown.json().nodes).toHaveLength(1);

    const solana = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/SOLANA/11111111111111111111111111111111',
    });
    expect(solana.statusCode).toBe(200);
    expect(solana.json().facts).toMatchObject({
      exists: { state: 'known', value: true },
      lamports: { state: 'known', value: '123' },
      owner: { state: 'known', value: '11111111111111111111111111111111' },
      executable: { state: 'known', value: false },
    });
    expect(solana.json().metadata.snapshot).toMatchObject({
      slot: '300000000',
      blockhash: '11111111111111111111111111111111',
      commitment: 'finalized',
      providerVersions: {
        'solana-anchor-a': 'solana-json-rpc',
        'solana-anchor-b': 'solana-json-rpc',
      },
    });
    expect(solana.json().metadata.sourceSet).toEqual([
      'solana-anchor-a',
      'solana-anchor-b',
      'solana-state',
    ]);
    expect(solana.json().evidence[0].source).toBe('solana-state');
  });

  it('treats an explicit null Solana account as known absence rather than Unknown', async () => {
    const app = await createApp({ config, runtime: runtimeWithAllLedgers(null), logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/SOLANA/11111111111111111111111111111111',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().facts).toEqual({
      exists: { state: 'known', value: false },
      lamports: { state: 'known', value: '0' },
      owner: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      executable: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
    });
  });

  it('returns explicit validation, lookup, and unconfigured-provider errors', async () => {
    const app = await createApp({ config, runtime: runtimeWithEvm(), logger: false });
    apps.push(app);

    const invalidSearch = await app.inject({ method: 'GET', url: '/api/v1/search?q=' });
    expect(invalidSearch.statusCode).toBe(400);
    expect(invalidSearch.json().error.code).toBe('INVALID_REQUEST');
    expect(invalidSearch.json().issues.length).toBeGreaterThan(0);

    const invalidLedger = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/DOGE/not-an-address',
    });
    expect(invalidLedger.statusCode).toBe(400);
    expect(invalidLedger.json().error.code).toBe('INVALID_LEDGER');

    const invalidIdentifier = await app.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/not-an-address',
    });
    expect(invalidIdentifier.statusCode).toBe(400);
    expect(invalidIdentifier.json().error.code).toBe('INVALID_IDENTIFIER');

    const missingEvidence = await app.inject({
      method: 'GET',
      url: '/api/v1/evidence/ev_missing',
    });
    expect(missingEvidence.statusCode).toBe(404);
    const missingDrilldown = await app.inject({
      method: 'GET',
      url: '/api/v1/evidence/ev_missing/drilldown',
    });
    expect(missingDrilldown.statusCode).toBe(404);

    const evidenceLedger = new EvidenceLedger();
    const noProviders: AppRuntime = {
      providerRegistry: new ProviderRegistry([]),
      evmAdapters: new Map(),
      evidenceLedger,
      dataQuality: testDataQuality(evidenceLedger),
      ingestionStorage: {},
    };
    const degraded = await createApp({ config, runtime: noProviders, logger: false });
    apps.push(degraded);
    const unavailable = await degraded.inject({
      method: 'GET',
      url: '/api/v1/subjects/EVM/0x52908400098527886e0f7030069857d2e4169ee7?chainId=eip155:1',
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().facts).toMatchObject({
      state: 'unavailable',
      reason: 'PROVIDER_UNCONFIGURED',
    });
  });

  it('grounds entity and exit-race derivations in snapshot-compatible evidence', async () => {
    const runtime = runtimeWithEvm();
    const source = addFixtureEvidence(runtime);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const entity = await app.inject({
      method: 'POST',
      url: '/api/v1/entities/resolve',
      payload: {
        subjectA: 'controller',
        subjectB: 'module',
        features: [
          {
            kind: 'SHARED_ONCHAIN_AUTHORITY',
            strength: 1,
            reliability: 1,
            evidenceId: source.id,
          },
        ],
        metadata: fixtureMetadata(source.id),
      },
    });
    expect(entity.statusCode).toBe(200);
    expect(entity.json()).toMatchObject({
      classification: 'CONFIRMED_SAME_CONTROLLER',
      evidence: [expect.objectContaining({ kind: 'DERIVED_FEATURE' })],
    });

    const scenario = await app.inject({
      method: 'POST',
      url: '/api/v1/scenarios/exit-race',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: [source.id],
        },
        participants: [
          { id: 'first', inputQuantity: '100' },
          { id: 'second', inputQuantity: '100' },
        ],
        order: 'SEQUENTIAL',
        seed: 42,
        metadata: fixtureMetadata(source.id),
      },
    });
    expect(scenario.statusCode).toBe(200);
    expect(scenario.json()).toMatchObject({
      iterations: 1,
      evidence: [expect.objectContaining({ kind: 'DERIVED_FEATURE' })],
    });
  });

  it('rejects missing or snapshot-incompatible analysis evidence', async () => {
    const runtime = runtimeWithEvm();
    const wrongBlock = addFixtureEvidence(runtime, '15');
    const wrongHash = addFixtureEvidence(runtime);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const missing = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: ['ev_missing'],
        },
        inputQuantity: '100',
        metadata: fixtureMetadata('ev_missing'),
      },
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().evidenceIssue).toEqual({
      kind: 'MISSING',
      evidenceIds: ['ev_missing'],
    });

    const incompatible = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: [wrongBlock.id],
        },
        inputQuantity: '100',
        metadata: fixtureMetadata(wrongBlock.id),
      },
    });
    expect(incompatible.statusCode).toBe(422);
    expect(incompatible.json().evidenceIssue).toEqual({
      kind: 'SNAPSHOT_INCOMPATIBLE',
      evidenceIds: [wrongBlock.id],
    });

    const conflictingAnchor = await app.inject({
      method: 'POST',
      url: '/api/v1/rv/constant-product',
      payload: {
        pool: {
          id: 'pool-1',
          baseReserve: '1000',
          quoteReserve: '1000',
          feeBps: '0',
          sellEnabled: true,
          evidenceIds: [wrongHash.id],
        },
        inputQuantity: '100',
        metadata: {
          ...fixtureMetadata(wrongHash.id),
          snapshot: { ...fixtureSnapshot, blockHash: '0x' + 'c'.repeat(64) },
        },
      },
    });
    expect(conflictingAnchor.statusCode).toBe(422);
    expect(conflictingAnchor.json().evidenceIssue).toEqual({
      kind: 'SNAPSHOT_INCOMPATIBLE',
      evidenceIds: [wrongHash.id],
    });
  });
});
