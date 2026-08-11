import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { createRuntime } from '../../src/runtime.js';

function baseConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
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
    dataQualityMinSources: 2,
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
    sourcifyRequestsPerSecond: 0,
    gmgnConfigured: false,
    jupiterConfigured: false,
    etherscanConfigured: false,
    duneConfigured: false,
    nansenConfigured: false,
    arkhamConfigured: false,
    ...overrides,
  };
}

describe('application runtime wiring', () => {
  it('starts with all chain providers explicitly unconfigured', async () => {
    const runtime = createRuntime(baseConfig());
    expect(runtime.evmAdapters.size).toBe(0);
    expect(runtime.bitcoinAdapter).toBeUndefined();
    expect(runtime.solanaAdapter).toBeUndefined();
    expect(runtime.evidenceLedger.values()).toEqual([]);
    expect(runtime.dataQuality.durable).toBe(false);
    expect(runtime.dataQuality.configuredSources()).toEqual({
      'eip155:1': 0,
      'eip155:56': 0,
      'bitcoin-mainnet': 0,
      'solana-mainnet': 0,
    });

    const health = await runtime.providerRegistry.health();
    expect(health.map((provider) => [provider.id, provider.status])).toEqual([
      ['bitcoin-esplora', 'UNCONFIGURED'],
      ['bsc-rpc', 'UNCONFIGURED'],
      ['ethereum-rpc', 'UNCONFIGURED'],
      ['solana-rpc', 'UNCONFIGURED'],
    ]);
    expect(health.every((provider) => provider.head.state === 'unavailable')).toBe(true);
  });

  it('wires every configured adapter without making a startup network request', () => {
    const runtime = createRuntime(
      baseConfig({
        providerAllowedHosts: [
          'ethereum.example',
          'ethereum-fallback.example',
          'bsc.example',
          'bitcoin.example',
          'solana.example',
          'sqd.example',
          'sourcify.example',
        ],
        ethereumRpcUrls: ['https://ethereum.example', 'https://ethereum-fallback.example'],
        bscRpcUrls: ['https://bsc.example'],
        bitcoinEsploraUrls: ['https://bitcoin.example/api'],
        solanaRpcUrls: ['https://solana.example'],
        sqdPortalUrl: 'https://sqd.example',
        sourcifyV2Url: 'https://sourcify.example/server',
      }),
    );
    expect([...runtime.evmAdapters.keys()]).toEqual([1, 56]);
    expect(runtime.evmSourceAdapters?.get(1)).toHaveLength(2);
    expect(runtime.evmSourceAdapters?.get(56)).toHaveLength(1);
    expect(runtime.bitcoinAdapter?.config.id).toBe('bitcoin-esplora');
    expect(runtime.solanaAdapter?.config.commitment).toBe('finalized');
    expect(runtime.sqdBscLogReader).toBeDefined();
    expect(runtime.sqdBscCreationReader).toBeDefined();
    expect(runtime.evmSourceVerification?.sourceId).toBe('sourcify-v2@sourcify.example');
    expect(runtime.dataQuality.configuredSources()).toEqual({
      'eip155:1': 2,
      'eip155:56': 1,
      'bitcoin-mainnet': 1,
      'solana-mainnet': 1,
    });
  });

  it('uses hostname-based source identifiers without exposing provider URL paths', async () => {
    const runtime = createRuntime(
      baseConfig({
        providerAllowedHosts: ['ethereum.example'],
        ethereumRpcUrls: ['https://ethereum.example/v2/private-path-value'],
      }),
    );
    const adapter = runtime.evmAdapters.get(1);
    expect(adapter?.sourceId).toBe('ethereum-rpc@ethereum.example');
    expect(adapter?.sourceId).not.toContain('private-path-value');
  });

  it('allows an explicitly opted-in local development provider boundary', () => {
    const runtime = createRuntime(
      baseConfig({
        environment: 'development',
        allowPrivateProviderUrls: true,
        ethereumRpcUrls: ['http://127.0.0.1:8545'],
      }),
    );
    expect(runtime.evmAdapters.has(1)).toBe(true);
  });

  it('wires PostgreSQL Evidence storage lazily when configured', async () => {
    const runtime = createRuntime(
      baseConfig({ postgresUrl: 'postgresql://zerotrace:secret@postgres.example/zerotrace' }),
    );
    expect(runtime.evidenceRepository).toBeDefined();
    expect(runtime.semanticCheckpoints).toBeDefined();
    expect(runtime.flapHistoryProjection).toBeDefined();
    expect(runtime.entityInvestigationGraphs).toBeDefined();
    expect(runtime.captureSchedules).toBeDefined();
    expect(runtime.ageInvestigationGraphProjection).toBeUndefined();
    expect(runtime.dataQualityStorage).toBeDefined();
    expect(runtime.dataQuality.durable).toBe(true);
    await runtime.close?.();
  });

  it('wires the optional Apache AGE projection without startup I/O', async () => {
    const runtime = createRuntime(
      baseConfig({
        ageUrl: 'postgresql://zerotrace:secret@graph.example/zerotrace_graph',
      }),
    );
    expect(runtime.ageInvestigationGraphProjection).toBeDefined();
    expect(runtime.entityInvestigationGraphs).toBeUndefined();
    await runtime.close?.();
  });

  it('wires each finalized-ingestion store without startup I/O', async () => {
    const runtime = createRuntime(
      loadConfig({
        NODE_ENV: 'test',
        POSTGRES_URL: 'postgresql://zerotrace:secret@postgres.example/zerotrace',
        CLICKHOUSE_URL: 'https://clickhouse.example',
        OBJECT_STORE_ENDPOINT: 'https://objects.example',
        OBJECT_STORE_ACCESS_KEY: 'access-key',
        OBJECT_STORE_SECRET_KEY: 'object-secret',
      }),
    );

    expect(runtime.ingestionStorage.rawFacts).toBeDefined();
    expect(runtime.ingestionStorage.checkpoints).toBeDefined();
    expect(runtime.ingestionStorage.artifacts).toBeDefined();
    await runtime.close?.();
  });
});
