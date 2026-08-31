import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { createRuntime } from '../../src/runtime.js';
import {
  authorizePlatformRoute,
  classifyPlatformRoute,
} from '../../src/plugins/platform-security.js';

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
    storageRoot: '/tmp/zerotrace-platform-security-test',
    localDevAuth: false,
    ...overrides,
  };
}

describe('platform security', { timeout: 60_000 }, () => {
  const apps: Awaited<ReturnType<typeof createApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('keeps anonymous production traffic closed except health probes', async () => {
    const config = baseConfig({ environment: 'production' });
    const app = await createApp({ config, runtime: createRuntime(config), logger: false });
    apps.push(app);

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    const metrics = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metrics.statusCode).toBe(200);

    const blocked = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(blocked.statusCode).toBe(503);
    expect(blocked.json().error.code).toBe('AUTH_NOT_CONFIGURED');
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(503);
  });

  it('accepts only the matching loopback desktop session token', async () => {
    const token = '0123456789abcdef0123456789abcdef';
    const config = baseConfig({
      environment: 'production',
      desktopAuthToken: {
        reveal: () => token,
        toJSON: () => '[REDACTED]' as const,
      },
    });
    const app = await createApp({ config, runtime: createRuntime(config), logger: false });
    apps.push(app);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('DESKTOP_AUTH_REQUIRED');

    const wrong = await app.inject({
      method: 'GET',
      url: '/api/v1/capabilities',
      headers: { 'x-zerotrace-desktop-token': 'fedcba9876543210fedcba9876543210' },
    });
    expect(wrong.statusCode).toBe(401);

    const accepted = await app.inject({
      method: 'GET',
      url: '/api/v1/capabilities',
      headers: { 'x-zerotrace-desktop-token': token },
    });
    expect(accepted.statusCode).toBe(200);
  });

  it('does not treat OIDC identity configuration as resource authorization', async () => {
    const config = baseConfig({
      environment: 'production',
      oidcIssuer: 'https://idp.example',
      oidcAudience: 'zerotrace',
      oidcJwksUri: 'https://idp.example/.well-known/jwks.json',
    });
    const app = await createApp({ config, runtime: createRuntime(config), logger: false });
    apps.push(app);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(missing.statusCode).toBe(503);
    expect(missing.json().error.code).toBe('AUTHORIZATION_NOT_CONFIGURED');

    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/capabilities',
      headers: { authorization: 'Basic not-a-bearer-token' },
    });
    expect(malformed.statusCode).toBe(503);
    expect(malformed.json().error.code).toBe('AUTHORIZATION_NOT_CONFIGURED');
  });

  it('requires a bearer token after explicit tenant and role claim configuration', async () => {
    const config = baseConfig({
      environment: 'production',
      oidcIssuer: 'https://idp.example',
      oidcAudience: 'zerotrace',
      oidcJwksUri: 'https://idp.example/.well-known/jwks.json',
      tenantId: 'tenant-1',
      oidcTenantClaim: 'zerotrace.tenant',
      oidcRolesClaim: 'zerotrace.roles',
      oidcMfaClaim: 'zerotrace.mfa',
    });
    const app = await createApp({ config, runtime: createRuntime(config), logger: false });
    apps.push(app);

    const missing = await app.inject({ method: 'GET', url: '/api/v1/capabilities' });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('OIDC_AUTHORIZATION_REQUIRED');
    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/capabilities',
      headers: { authorization: 'Basic not-a-bearer-token' },
    });
    expect(malformed.statusCode).toBe(401);
    expect(malformed.json().error.code).toBe('OIDC_TOKEN_INVALID');
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/capabilities',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'GET',
      },
    });
    expect(preflight.statusCode).toBe(204);
  });

  it('classifies read, investigation write and MFA-gated admin routes fail closed', () => {
    expect(classifyPlatformRoute('GET', '/api/v1/forensics/cases/case-1')).toBe('ANALYSIS_READ');
    expect(classifyPlatformRoute('POST', '/api/v1/query/plan')).toBe('ANALYSIS_READ');
    expect(classifyPlatformRoute('POST', '/api/v1/research/social-query-plans')).toBe(
      'ANALYSIS_READ',
    );
    expect(classifyPlatformRoute('POST', '/api/v1/paper/experiments/exp-1/commands')).toBe(
      'INVESTIGATION_WRITE',
    );
    expect(classifyPlatformRoute('POST', '/api/v2/jobs/job-1/cancel')).toBe('ADMIN_OPERATION');
    expect(
      classifyPlatformRoute(
        'POST',
        `/api/v1/research/social-observation-windows/sow_${'a'.repeat(24)}/fetch-next`,
      ),
    ).toBe('ADMIN_OPERATION');
    expect(classifyPlatformRoute('POST', '/api/v1/research/social-observation-tombstones')).toBe(
      'ADMIN_OPERATION',
    );
    expect(classifyPlatformRoute('DELETE', '/api/v1/forensics/cases/case-1')).toBeNull();

    const readonly = {
      subject: 'reader',
      roles: ['readonly'] as const,
      tenantId: 'tenant-1',
      mfaSatisfied: false,
    };
    const investigator = {
      ...readonly,
      subject: 'investigator',
      roles: ['investigator'] as const,
    };
    const admin = { ...readonly, subject: 'admin', roles: ['admin'] as const };
    expect(authorizePlatformRoute(readonly, 'ANALYSIS_READ', 'tenant-1')).toBe(true);
    expect(authorizePlatformRoute(readonly, 'INVESTIGATION_WRITE', 'tenant-1')).toBe(false);
    expect(authorizePlatformRoute(investigator, 'INVESTIGATION_WRITE', 'tenant-1')).toBe(true);
    expect(authorizePlatformRoute(investigator, 'ANALYSIS_READ', 'tenant-2')).toBe(false);
    expect(authorizePlatformRoute(admin, 'ADMIN_OPERATION', 'tenant-1')).toBe(false);
    expect(
      authorizePlatformRoute({ ...admin, mfaSatisfied: true }, 'ADMIN_OPERATION', 'tenant-1'),
    ).toBe(true);
  });
});
