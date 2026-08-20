import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    storageRoot: join(tmpdir(), 'zerotrace-storage-quota-test'),
    localDevAuth: false,
    ...overrides,
  };
}

describe('storage quota HTTP', () => {
  const apps: Awaited<ReturnType<typeof createApp>>[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reports unknown quota labels when the storage plane is unavailable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zt-quota-missing-'));
    dirs.push(dir);
    const config = baseConfig({ storageRoot: dir });
    const runtime = createRuntime(config);
    const runtimeWithoutPlane = { ...runtime };
    delete runtimeWithoutPlane.storagePlane;
    const app = await createApp({
      config,
      runtime: runtimeWithoutPlane,
      logger: false,
    });
    apps.push(app);
    const quota = await app.inject({ method: 'GET', url: '/api/v1/storage/quota' });
    expect(quota.statusCode).toBe(200);
    expect(quota.json()).toMatchObject({
      profile: 'LOW_COST_CASE',
      level: 'OK',
      labels: {
        used: '当前使用 未知',
        fullAt: '预计满盘日期 未知（存储平面未初始化）',
      },
    });
    const profile = await app.inject({ method: 'GET', url: '/api/v1/storage/profile' });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().profile).toBe('LOW_COST_CASE');
    expect(profile.json().quota).toBeUndefined();
    expect(String(profile.json().note)).toContain('Unknown');
    await runtime.close?.();
  });

  it('inspects the live storage plane without coercing unused disk to zero evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zt-quota-live-'));
    dirs.push(dir);
    const app = await createApp({
      config: baseConfig({ storageRoot: dir }),
      logger: false,
    });
    apps.push(app);
    const quota = await app.inject({ method: 'GET', url: '/api/v1/storage/quota' });
    expect(quota.statusCode).toBe(200);
    const body = quota.json() as { labels: { used: string; permanent: string } };
    expect(body.labels.used).toContain('当前使用');
    expect(body.labels.permanent).toContain('不可删除证据');
    const profile = await app.inject({ method: 'GET', url: '/api/v1/storage/profile' });
    expect(profile.json()).toMatchObject({ profile: 'LOW_COST_CASE', root: dir });
    expect(profile.json().quota.labels.used).toContain('当前使用');
  });
});
