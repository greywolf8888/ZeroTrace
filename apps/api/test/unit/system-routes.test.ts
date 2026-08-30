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
      extended: Array<{ id: string; status: string; realMainnetAcceptance: string }>;
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
    expect(body.core.find((item) => item.id === 'query-lab-ast-guard')?.status).toBe(
      'IMPLEMENTED_PLAN_ONLY_EXECUTION_DISABLED',
    );
    expect(body.extended.find((item) => item.id === 'Z90')).toMatchObject({
      status: 'BLOCKED_BY_NAMED_GATES',
      realMainnetAcceptance: 'NOT_PASSED',
    });

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

    const researchSources = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/research-sources',
    });
    expect(researchSources.statusCode).toBe(200);
    expect(researchSources.json()).toMatchObject({
      procurementBudgetMicrousd: '0',
      paidEnabledByDefault: false,
      credentialsAreSpendConsent: false,
      procurement: {
        status: 'UNAVAILABLE',
        remainingMicrousd: null,
        paidEnabled: false,
      },
      xUpstreamEvidenceRule: 'ALL_X_TOOLS_ONE_UPSTREAM_GROUP',
    });
    expect(researchSources.json().sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: 'xapid',
          status: 'UNVERIFIED_IDENTITY',
          enabled: false,
          endpointConfigured: false,
          dispatchAllowed: false,
          contentPolicy: expect.objectContaining({
            status: 'UNCONFIGURED',
            externalAi: 'PROHIBITED',
          }),
        }),
      ]),
    );
    const unavailablePlan = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-query-plans',
      payload: {
        providerId: 'xapid',
        queryVersion: 'query-v1',
        identity: { chain: 'BSC', address: `0x${'1'.repeat(40)}` },
      },
    });
    expect(unavailablePlan.statusCode).toBe(409);
    expect(unavailablePlan.json().error).toMatchObject({
      code: 'RESEARCH_SOURCE_NOT_READY',
      sourceStatus: 'UNVERIFIED_IDENTITY',
    });

    const slots = await app.inject({ method: 'GET', url: '/api/v1/provider-slots' });
    expect(slots.statusCode).toBe(200);
    expect(slots.json().slots.NODEREAL_API_KEY).toBe('UNCONFIGURED');
    expect(slots.json().note).toContain('UNCONFIGURED');
  });

  it('仅为已核验的固定来源合同编译查询计划，不预留费用或发出网络请求', async () => {
    const config = baseConfig();
    const runtime = createRuntime(config);
    runtime.socialSources = [
      {
        id: 'xapid',
        origin: 'https://social-source.example.com',
        identityVerified: true,
        rightsApproved: true,
        enabled: true,
        contractVersion: 'xapid-test-contract-v1',
        upstreamGroup: 'X',
        documentation: 'https://social-source.example.com/docs',
        contentPolicy: {
          policyVersion: 'xapid-test-rights-v1',
          sourceId: 'xapid',
          contractVersion: 'xapid-test-contract-v1',
          rightsStatus: 'VERIFIED',
          rightsEvidenceIds: [`ev_${'a'.repeat(24)}`],
          retention: 'METADATA_ONLY',
          maxRetentionSeconds: null,
          deletionMode: 'UNVERIFIED',
          deletionCheckMaxAgeSeconds: 3600,
          externalAi: 'PROHIBITED',
          verifiedAt: '2026-08-01T00:00:00.000Z',
          expiresAt: '2027-08-01T00:00:00.000Z',
        },
        authentication: { kind: 'NONE', secretRef: null, headerName: null },
        search: {
          path: '/v1/search',
          queryParameter: 'query',
          cursorParameter: 'cursor',
          countParameter: 'limit',
          latestParameter: null,
          latestValue: null,
          maxCount: 100,
          maxQueryChars: 512,
          itemsPath: ['data'],
          cursorPath: ['nextCursor'],
          missingCursorMeansEnd: true,
          successPath: null,
          successValue: null,
          idPath: ['id'],
          textPath: ['text'],
          createdAtPath: ['createdAt'],
          authorIdPath: ['authorId'],
          authorHandlePath: ['authorHandle'],
        },
      },
    ];
    let rightsEvidenceAvailable = true;
    runtime.evidenceRepository = {
      async get(id: string) {
        return rightsEvidenceAvailable && id === `ev_${'a'.repeat(24)}`
          ? { evidence: { id, source: 'verified-rights-contract' } }
          : undefined;
      },
    } as unknown as NonNullable<typeof runtime.evidenceRepository>;
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const planned = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-query-plans',
      payload: {
        providerId: 'xapid',
        queryVersion: 'query-v1',
        pageSize: 25,
        identity: {
          chain: 'BSC',
          address: `0x${'A'.repeat(40)}`,
          verifiedHandle: 'ZeroTrace_1',
          aliases: ['项目别名'],
        },
      },
    });
    expect(planned.statusCode).toBe(200);
    expect(planned.json()).toMatchObject({
      mode: 'READ_ONLY_RESEARCH_PLAN',
      sourceId: 'xapid',
      assetKey: `BSC:0x${'a'.repeat(40)}`,
      queryVersion: 'query-v1',
      contractVersion: 'xapid-test-contract-v1',
      contentPolicyVersion: 'xapid-test-rights-v1',
      upstreamEvidenceGroup: 'X',
      networkRequestPerformed: false,
      dispatchState: 'NOT_RESERVED',
    });
    expect(planned.json().plans).toHaveLength(4);
    expect(planned.json().plans[0]).toMatchObject({
      role: 'IDENTITY',
      plan: { sourceId: 'xapid', cursor: null, queryVersion: 'query-v1' },
    });
    expect(String(planned.json().plans[0].plan.url)).toContain('limit=25');

    rightsEvidenceAvailable = false;
    const missingRightsEvidence = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-query-plans',
      payload: {
        providerId: 'xapid',
        queryVersion: 'query-v1',
        identity: { chain: 'BSC', address: `0x${'a'.repeat(40)}` },
      },
    });
    expect(missingRightsEvidence.statusCode).toBe(409);
    expect(missingRightsEvidence.json().error.code).toBe('RESEARCH_RIGHTS_EVIDENCE_INCOMPLETE');

    const invalid = await app.inject({
      method: 'POST',
      url: '/api/v1/research/social-query-plans',
      payload: {
        providerId: 'xapid',
        queryVersion: 'query-v1',
        identity: { chain: 'BSC', address: '0x01' },
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe('INVALID_REQUEST');
  });
});
