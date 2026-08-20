import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
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
    providerSlotStatus: {
      NODEREAL_API_KEY: 'UNCONFIGURED',
      ANKR_API_KEY: 'UNCONFIGURED',
      CHAINSTACK_BSC_RPC_URL: 'UNCONFIGURED',
      DRPC_API_KEY: 'UNCONFIGURED',
      HELIUS_API_KEY: 'UNCONFIGURED',
      BSC_TRACE_RPC_URL: 'UNCONFIGURED',
    },
    bscTraceRpcAuthType: 'none',
    bscTraceOperatorId: 'bsc-trace-slot',
    storageProfile: 'LOW_COST_CASE',
    storageRoot: '/tmp/zerotrace-system-routes-test',
    localDevAuth: false,
    ...overrides,
  };
}

describe('system routes', { timeout: 60_000 }, () => {
  const apps: Awaited<ReturnType<typeof createApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('exposes live, ready, health, capabilities, chains, platforms and provider slots without claiming durable storage', async () => {
    const config = baseConfig();
    const app = await createApp({ config, runtime: createRuntime(config), logger: false });
    apps.push(app);

    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ status: 'UP', readOnly: true, service: 'zerotrace-api' });

    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().status).toBe('DEGRADED');

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ service: 'zerotrace-api', readOnly: true });
    expect(health.json().storage.status).toBe('EPHEMERAL');

    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('zerotrace_');

    const anchors = await app.inject({ method: 'GET', url: '/api/v1/data-quality/anchors' });
    expect(anchors.statusCode).toBe(200);

    const capabilities = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(capabilities.statusCode).toBe(200);
    const body = capabilities.json() as {
      readOnly: boolean;
      core: Array<{ id: string; status: string }>;
      boundaries: { transactionSigning: string; transactionBroadcasting: string };
    };
    expect(body.readOnly).toBe(true);
    expect(body.boundaries.transactionSigning).toBe('FORBIDDEN');
    expect(body.boundaries.transactionBroadcasting).toBe('FORBIDDEN');
    expect(body.core.find((item) => item.id === 'evidence-ledger')?.status).toBe(
      'IMPLEMENTED_EPHEMERAL',
    );
    expect(body.core.find((item) => item.id === 'control-campaign-p0')?.status).toBe(
      'DURABLE_STORAGE_REQUIRED',
    );
    expect(body.core.find((item) => item.id === 'flap-bsc-inspection')?.status).toBe(
      'BSC_PROVIDER_REQUIRED',
    );

    const chains = await app.inject({ method: 'GET', url: '/api/v1/chains' });
    expect(chains.statusCode).toBe(200);
    expect(chains.json().chains).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ chainId: 'eip155:56', configured: false }),
        expect.objectContaining({ ledger: 'BITCOIN', configured: false }),
      ]),
    );

    const platforms = await app.inject({ method: 'GET', url: '/api/v1/platforms' });
    expect(platforms.statusCode).toBe(200);
    expect(platforms.json().gmgnConfigured).toBe(false);

    const slots = await app.inject({ method: 'GET', url: '/api/v1/provider-slots' });
    expect(slots.statusCode).toBe(200);
    expect(slots.json().slots.NODEREAL_API_KEY).toBe('UNCONFIGURED');
    expect(slots.json().note).toContain('UNCONFIGURED');
  });
});
