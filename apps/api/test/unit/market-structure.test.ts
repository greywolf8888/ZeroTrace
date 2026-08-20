import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { createRuntime } from '../../src/runtime.js';

function baseConfig(): AppConfig {
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
    storageRoot: '/tmp/zerotrace-storage-plane-test',
    localDevAuth: false,
  };
}

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:56',
  blockNumber: '1000',
  blockHash: `0x${'a'.repeat(64)}`,
  finality: 'finalized' as const,
  capturedAt: '2026-08-19T00:00:00.000Z',
  providerVersions: { rpc: '1' },
  adapterVersions: { evm: '1' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-unapplied',
};

describe('market-structure v2 API', { timeout: 60_000 }, () => {
  const apps: Awaited<ReturnType<typeof createApp>>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('creates an investigation and materializes supply reality with evidence closure', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v2/investigations',
      payload: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'TOKEN',
        identifier: `0x${'c'.repeat(40)}`,
      },
    });
    expect(created.statusCode).toBe(201);
    const body = created.json() as { id: string };
    expect(body.id.startsWith('inv_')).toBe(true);

    const report = await app.inject({
      method: 'POST',
      url: `/api/v2/tokens/EVM/eip155:56/0x${'c'.repeat(40)}/supply-reality`,
      payload: {
        snapshot,
        protocolSupplyAtomic: '100',
        historicalMintAtomic: '100',
        historicalBurnAtomic: '0',
        burnAlreadyReflectedInSupply: false,
        originCoverageComplete: true,
        registryEvidenceId: `ev_${'2'.repeat(24)}`,
        terminalEvidenceId: `ev_${'3'.repeat(24)}`,
        cells: [
          {
            id: 'cel_aaaaaaaaaaaaaaaaaaaaaaaa',
            token: { ledger: 'EVM', chainId: 'eip155:56', token: `0x${'c'.repeat(40)}` },
            snapshot,
            amountAtomic: '100',
            owner: 'controller',
            custodyType: 'WALLET',
            economicController: 'CONFIRMED_CONTROLLER',
            liquidityStatus: 'SELLABLE_NOW',
            roleAssessmentIds: [],
            lotIds: [],
            evidenceIds: [`ev_${'1'.repeat(24)}`],
          },
        ],
      },
    });
    expect(report.statusCode).toBe(200);
    const envelope = report.json() as {
      evidenceClosure: string[];
      snapshot: typeof snapshot;
      payload: { conservation: { identityHolds: boolean } };
    };
    expect(envelope.snapshot.blockHash).toBe(snapshot.blockHash);
    expect(envelope.evidenceClosure.length).toBeGreaterThan(0);
    expect(envelope.payload.conservation.identityHolds).toBe(true);
  });

  it('rejects isolated RV summation on the exit-scenario route', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const rejected = await app.inject({
      method: 'POST',
      url: `/api/v2/tokens/EVM/eip155:56/0x${'c'.repeat(40)}/exit-scenarios`,
      payload: {
        snapshot,
        venues: [],
        cohorts: [],
        strategy: 'PRO_RATA',
        seed: 1,
        metadata: {
          snapshot,
          dataCoverage: 1,
          sourceCoverage: 1,
          historyCoverage: 1,
          simulationCoverage: 1,
          freshness: '2026-08-19T00:00:00.000Z',
          sourceSet: ['unit'],
          modelVersion: 'market-reality-v1.0.0',
          confidence: 0.5,
          evidenceIds: [`ev_${'1'.repeat(24)}`],
        },
        isolatedQuotes: ['1', '2'],
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(JSON.stringify(rejected.json())).toContain('ISOLATED_RV_SUM_REJECTED');
  });

  it('exports a Chinese case package and rejects unaudited LLM legal conclusions', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const exported = await app.inject({
      method: 'GET',
      url: '/api/v2/cases/cse_aaaaaaaaaaaaaaaaaaaaaaaa/export?investigationId=inv_aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(exported.statusCode).toBe(200);
    expect(JSON.stringify(exported.json())).toContain('链上盘面结构取证案件');
    const llm = await app.inject({
      method: 'POST',
      url: '/api/v2/llm/validate',
      payload: {
        taskType: 'CASE_NARRATIVE',
        knownEvidenceIds: [`ev_${'1'.repeat(24)}`],
        userUntrustedText: '诈骗已成立',
        output: {
          narrative: 'ok',
          evidenceIds: [`ev_${'1'.repeat(24)}`],
          uncertainty: [],
          unsupportedClaims: [],
          suggestedQueries: [],
        },
      },
    });
    expect(llm.statusCode).toBe(400);
    expect(JSON.stringify(llm.json())).toContain('LLM_VALIDATION_FAILED');
  });

  it('serves the latest supply-reality envelope from process memory after materialize', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const token = `0x${'c'.repeat(40)}`;
    const created = await app.inject({
      method: 'POST',
      url: `/api/v2/tokens/EVM/eip155:56/${token}/supply-reality`,
      payload: {
        snapshot,
        protocolSupplyAtomic: '100',
        historicalMintAtomic: '100',
        historicalBurnAtomic: '0',
        burnAlreadyReflectedInSupply: false,
        originCoverageComplete: true,
        registryEvidenceId: `ev_${'2'.repeat(24)}`,
        terminalEvidenceId: `ev_${'3'.repeat(24)}`,
        cells: [
          {
            id: 'cel_aaaaaaaaaaaaaaaaaaaaaaaa',
            token: { ledger: 'EVM', chainId: 'eip155:56', token },
            snapshot,
            amountAtomic: '100',
            owner: 'controller',
            custodyType: 'WALLET',
            economicController: 'CONFIRMED_CONTROLLER',
            liquidityStatus: 'SELLABLE_NOW',
            roleAssessmentIds: [],
            lotIds: [],
            evidenceIds: [`ev_${'1'.repeat(24)}`],
          },
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const latest = await app.inject({
      method: 'GET',
      url: `/api/v2/tokens/EVM/eip155:56/${token}/supply-reality/latest`,
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({ reportType: 'supply-reality-v1' });
  });

  it('fails closed in admissible mode without a durable forensic store', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const token = `0x${'c'.repeat(40)}`;
    const created = await app.inject({
      method: 'POST',
      url: `/api/v2/tokens/EVM/eip155:56/${token}/supply-reality`,
      payload: {
        analysisMode: 'ADMISSIBLE',
        snapshot,
        protocolSupplyAtomic: '100',
        historicalMintAtomic: '100',
        historicalBurnAtomic: '0',
        burnAlreadyReflectedInSupply: false,
        originCoverageComplete: true,
        registryEvidenceId: `ev_${'2'.repeat(24)}`,
        terminalEvidenceId: `ev_${'3'.repeat(24)}`,
        cells: [
          {
            id: 'cel_aaaaaaaaaaaaaaaaaaaaaaaa',
            token: { ledger: 'EVM', chainId: 'eip155:56', token },
            snapshot,
            amountAtomic: '100',
            owner: 'controller',
            custodyType: 'WALLET',
            economicController: 'CONFIRMED_CONTROLLER',
            liquidityStatus: 'SELLABLE_NOW',
            roleAssessmentIds: [],
            lotIds: [],
            evidenceIds: [`ev_${'1'.repeat(24)}`],
          },
        ],
      },
    });
    expect(created.statusCode).toBe(503);
    expect(JSON.stringify(created.json())).toContain('FORENSIC_STORE_UNAVAILABLE');
  });

  it('replays a stored envelope and compares resultHash', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const token = `0x${'c'.repeat(40)}`;
    const created = await app.inject({
      method: 'POST',
      url: '/api/v2/investigations',
      payload: {
        ledger: 'EVM',
        chainId: 'eip155:56',
        subjectType: 'TOKEN',
        identifier: token,
      },
    });
    const investigation = created.json() as { id: string };
    const report = await app.inject({
      method: 'POST',
      url: `/api/v2/tokens/EVM/eip155:56/${token}/supply-reality`,
      payload: {
        investigationId: investigation.id,
        snapshot,
        protocolSupplyAtomic: '100',
        historicalMintAtomic: '100',
        historicalBurnAtomic: '0',
        burnAlreadyReflectedInSupply: false,
        originCoverageComplete: true,
        registryEvidenceId: `ev_${'2'.repeat(24)}`,
        terminalEvidenceId: `ev_${'3'.repeat(24)}`,
        cells: [
          {
            id: 'cel_aaaaaaaaaaaaaaaaaaaaaaaa',
            token: { ledger: 'EVM', chainId: 'eip155:56', token },
            snapshot,
            amountAtomic: '100',
            owner: 'controller',
            custodyType: 'WALLET',
            economicController: 'CONFIRMED_CONTROLLER',
            liquidityStatus: 'SELLABLE_NOW',
            roleAssessmentIds: [],
            lotIds: [],
            evidenceIds: [`ev_${'1'.repeat(24)}`],
          },
        ],
      },
    });
    expect(report.statusCode).toBe(200);
    const envelope = report.json() as { resultHash: string };
    const replayed = await app.inject({
      method: 'POST',
      url: `/api/v2/investigations/${investigation.id}/replay`,
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({
      replayed: true,
      match: true,
      storedResultHash: envelope.resultHash,
      recomputedResultHash: envelope.resultHash,
    });
  });

  it('analyzes a token from the formal entry without JSON paste and stays offline without a provider', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const analyzed = await app.inject({
      method: 'POST',
      url: '/api/v2/tokens/EVM/eip155:56/0xAeCBD0E461047d6B7Cfc82e637AD197097407777/analyze',
      payload: { snapshotPolicy: 'FINALIZED', analysisMode: 'FULL_LIFETIME' },
    });
    expect(analyzed.statusCode).toBe(200);
    expect(analyzed.json()).toMatchObject({
      status: 'OFFLINE',
      reason: 'PROVIDER_UNCONFIGURED',
    });
    const unsupported = await app.inject({
      method: 'POST',
      url: '/api/v2/tokens/SOLANA/solana-mainnet/So11111111111111111111111111111111111111112/analyze',
      payload: { snapshotPolicy: 'FINALIZED', analysisMode: 'FULL_LIFETIME' },
    });
    expect(unsupported.statusCode).toBe(200);
    expect(unsupported.json()).toMatchObject({ status: 'UNSUPPORTED' });
  });

  it('refuses forensic token analyze without a durable job queue', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const analyzed = await app.inject({
      method: 'POST',
      url: '/api/v2/tokens/EVM/eip155:56/0xAeCBD0E461047d6B7Cfc82e637AD197097407777/analyze',
      payload: {
        snapshotPolicy: 'FINALIZED',
        analysisMode: 'FULL_LIFETIME',
        forensicMode: 'FORENSIC',
      },
    });
    expect(analyzed.statusCode).toBe(503);
    expect(analyzed.json()).toMatchObject({
      error: { code: 'JOB_QUEUE_UNAVAILABLE' },
    });
  });

  it('returns 404 for unknown jobs and serves the analyze job after offline materialize', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const missing = await app.inject({
      method: 'GET',
      url: '/api/v2/jobs/job_aaaaaaaaaaaaaaaaaaaaaaaa',
    });
    expect(missing.statusCode).toBe(404);
    const analyzed = await app.inject({
      method: 'POST',
      url: '/api/v2/tokens/EVM/eip155:56/0xAeCBD0E461047d6B7Cfc82e637AD197097407777/analyze',
      payload: { snapshotPolicy: 'FINALIZED', analysisMode: 'BOUNDED_WINDOW' },
    });
    expect(analyzed.statusCode).toBe(200);
    const body = analyzed.json() as { job: { id: string }; status: string };
    const stored = await app.inject({
      method: 'GET',
      url: `/api/v2/jobs/${body.job.id}`,
    });
    expect(stored.statusCode).toBe(200);
    expect(stored.json()).toMatchObject({ id: body.job.id, status: 'SUCCEEDED' });
  });

  it('does not invent forensic cases when campaign storage is absent', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const hex = 'a'.repeat(24);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/forensics/cases',
      payload: { campaignId: `cc_${hex}` },
    });
    expect(created.statusCode).toBe(503);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/forensics/cases/fcb_cc_${hex}`,
        })
      ).statusCode,
    ).toBe(503);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/control/events/be_${hex}` })).statusCode,
    ).toBe(503);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/control/evidence/cei_${hex}` })).statusCode,
    ).toBe(503);
    const missingRepo = await createApp({
      config: baseConfig(),
      runtime: Object.assign(createRuntime(baseConfig()), {
        controlCampaignReports: {
          get: async () => undefined,
          findByBehaviorEventId: async () => undefined,
          findByEvidenceItemId: async () => undefined,
        },
      }),
      logger: false,
    });
    apps.push(missingRepo);
    expect(
      (
        await missingRepo.inject({
          method: 'POST',
          url: '/api/v1/forensics/cases',
          payload: { campaignId: `cc_${hex}` },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await missingRepo.inject({
          method: 'GET',
          url: `/api/v1/control/events/be_${hex}`,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await missingRepo.inject({
          method: 'GET',
          url: `/api/v1/control/evidence/cei_${hex}`,
        })
      ).statusCode,
    ).toBe(404);
    expect((await missingRepo.inject({ method: 'GET', url: '/api/v1/assets' })).statusCode).toBe(
      501,
    );
  });

  it('rejects caller-supplied role scores in forensic mode', async () => {
    const app = await createApp({ config: baseConfig(), logger: false });
    apps.push(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v2/tokens/EVM/eip155:56/0xAeCBD0E461047d6B7Cfc82e637AD197097407777/roles',
      headers: { 'x-zerotrace-forensic': '1' },
      payload: {
        snapshot,
        registryEvidenceId: `ev_${'1'.repeat(24)}`,
        terminalEvidenceId: `ev_${'2'.repeat(24)}`,
        candidates: [],
        protocolSupplyAtomic: '1',
        executableSellableAtomic: '1',
        nonServiceNonPoolAtomic: '1',
        marketWideExitU: '1',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('CALLER_SUPPLIED_INTERNAL_FORBIDDEN');
  });
});
