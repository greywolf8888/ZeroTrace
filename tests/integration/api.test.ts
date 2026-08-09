import { afterEach, describe, expect, it } from 'vitest';

import {
  BitcoinUtxoLedgerAdapter,
  EvmLedgerAdapter,
  ProviderRegistry,
  SolanaLedgerAdapter,
  type JsonRpcTransport,
  type RestTransport,
} from '@zerotrace/chain-adapters';
import { createEvidence, EvidenceLedger } from '@zerotrace/evidence';

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
  ethereumRequestsPerSecond: 0,
  bscRpcUrls: [],
  bscChainId: 56,
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

class FakeTransport implements JsonRpcTransport {
  readonly endpointId = 'ethereum-rpc';
  readonly #responses: Record<string, unknown>;

  constructor(responses: Record<string, unknown>) {
    this.#responses = responses;
  }

  async request<T>(method: string): Promise<T> {
    return this.#responses[method] as T;
  }
}

class FakeRestTransport implements RestTransport {
  readonly endpointId = 'bitcoin-esplora';
  readonly #responses: Record<string, unknown>;

  constructor(responses: Record<string, unknown>) {
    this.#responses = responses;
  }

  async getText(path: string): Promise<string> {
    return String(this.#responses[path]);
  }

  async getJson<T>(path: string): Promise<T> {
    return this.#responses[path] as T;
  }
}

function runtimeWithEvm(): AppRuntime {
  const evm = new EvmLedgerAdapter(
    { id: 'ethereum-rpc', chainId: 1, chainName: 'Ethereum' },
    new FakeTransport({
      eth_chainId: '0x1',
      eth_blockNumber: '0x10',
      eth_getBlockByNumber: {
        number: '0x10',
        hash: '0x' + 'a'.repeat(64),
        timestamp: '0x65',
      },
      eth_getBalance: '0x0',
      eth_getCode: '0x',
    }),
  );
  return {
    providerRegistry: new ProviderRegistry([evm]),
    evmAdapters: new Map([[1, evm]]),
    evidenceLedger: new EvidenceLedger(),
  };
}

function runtimeWithAllLedgers(): AppRuntime {
  const evm = new EvmLedgerAdapter(
    { id: 'ethereum-rpc', chainId: 1, chainName: 'Ethereum' },
    new FakeTransport({
      eth_chainId: '0x1',
      eth_blockNumber: '0x10',
      eth_getBlockByNumber: {
        number: '0x10',
        hash: '0x' + 'a'.repeat(64),
        timestamp: '0x65',
      },
      eth_getBalance: '0x0',
      eth_getCode: '0x6000',
    }),
  );
  const bitcoin = new BitcoinUtxoLedgerAdapter(
    { id: 'bitcoin-esplora' },
    new FakeRestTransport({
      '/blocks/tip/height': '840000',
      '/blocks/tip/hash': 'b'.repeat(64),
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
    }),
  );
  const solana = new SolanaLedgerAdapter(
    { id: 'solana-rpc', commitment: 'finalized' },
    new FakeTransport({
      getHealth: 'ok',
      getSlot: 300_000_000,
      getLatestBlockhash: { value: { blockhash: '11111111111111111111111111111111' } },
      getAccountInfo: {
        context: { slot: 300_000_000 },
        value: {
          lamports: 123,
          owner: '11111111111111111111111111111111',
          executable: false,
        },
      },
    }),
  );
  return {
    providerRegistry: new ProviderRegistry([evm, bitcoin, solana]),
    evmAdapters: new Map([[1, evm]]),
    bitcoinAdapter: bitcoin,
    solanaAdapter: solana,
    evidenceLedger: new EvidenceLedger(),
  };
}

const fixtureSnapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:1',
  blockNumber: '16',
  blockHash: '0x' + 'a'.repeat(64),
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

function addFixtureEvidence(runtime: AppRuntime, blockOrSlot = '16') {
  const evidence = createEvidence({
    ledger: 'EVM',
    chainId: 'eip155:1',
    kind: 'CONTRACT_STATE',
    source: 'fixture',
    locator: 'pool:pool-1@' + blockOrSlot,
    payload: { baseReserve: '1000', quoteReserve: '1000', feeBps: '0', blockOrSlot },
    blockOrSlot,
    finality: 'snapshot-block',
    summary: 'Pool reserves at fixture block.',
  });
  runtime.evidenceLedger.add(evidence);
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
    expect(body.metadata.snapshot).toMatchObject({ ledger: 'EVM', blockNumber: '16' });
    expect(body.evidence).toHaveLength(1);
    expect(runtime.evidenceLedger.get(body.evidence[0].id)).toBeDefined();
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
      finality: 'snapshot-block',
      summary: 'Pool reserves at fixture block.',
    });
    runtime.evidenceLedger.add(sourceEvidence);
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
            capturedAt: '2026-08-09T00:00:00.000Z',
            providerVersions: { fixture: '1' },
            adapterVersions: { evm: '0.1.0' },
            configHash: 'b'.repeat(64),
            entityModelVersion: 'not-used',
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
    expect(health.json()).toMatchObject({ status: 'UP', readOnly: true });

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.json().boundaries).toEqual({
      transactionSigning: 'FORBIDDEN',
      transactionBroadcasting: 'FORBIDDEN',
      privateKeyStorage: 'FORBIDDEN',
    });

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

    const noProviders: AppRuntime = {
      providerRegistry: new ProviderRegistry([]),
      evmAdapters: new Map(),
      evidenceLedger: new EvidenceLedger(),
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
  });
});
