import { describe, expect, it } from 'vitest';

import type { AppConfig } from '../../src/config.js';
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
    ethereumChainId: 1,
    bscChainId: 56,
    solanaCommitment: 'finalized',
    gmgnConfigured: false,
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
          'bsc.example',
          'bitcoin.example',
          'solana.example',
        ],
        ethereumRpcUrl: 'https://ethereum.example',
        bscRpcUrl: 'https://bsc.example',
        bitcoinEsploraUrl: 'https://bitcoin.example/api',
        solanaRpcUrl: 'https://solana.example',
      }),
    );
    expect([...runtime.evmAdapters.keys()]).toEqual([1, 56]);
    expect(runtime.bitcoinAdapter?.config.id).toBe('bitcoin-esplora');
    expect(runtime.solanaAdapter?.config.commitment).toBe('finalized');
  });

  it('allows an explicitly opted-in local development provider boundary', () => {
    const runtime = createRuntime(
      baseConfig({
        environment: 'development',
        allowPrivateProviderUrls: true,
        ethereumRpcUrl: 'http://127.0.0.1:8545',
      }),
    );
    expect(runtime.evmAdapters.has(1)).toBe(true);
  });
});
