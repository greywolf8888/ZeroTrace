import { afterEach, describe, expect, it } from 'vitest';

import { applyPaperCommand, type PaperExperiment } from '@zerotrace/asset-ledger';
import type { PostgresPaperSimulationRepository } from '@zerotrace/storage';

import { createApp } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { createRuntime, type AppRuntime } from '../../src/runtime.js';

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
    storageRoot: '/tmp/zerotrace-paper-api-test',
    localDevAuth: false,
  };
}

const policy = {
  version: 'V11.0',
  targetPositionBps: 500,
  maxSinglePositionBps: 1_000,
  maxControllerGroupBps: 1_500,
  maxNarrativeGroupBps: 2_500,
  maxTotalInvestedBps: 6_000,
  minimumUncommittedCashBps: 1_500,
  minimumFeeReserveBps: 500,
  opaqueTokenStressLossBps: 10_000,
};

function memoryRepository(): PostgresPaperSimulationRepository {
  let state: PaperExperiment | undefined;
  return {
    async create(experiment: PaperExperiment) {
      state ??= structuredClone(experiment);
      return structuredClone(state);
    },
    async get(id: string) {
      return state?.id === id ? structuredClone(state) : undefined;
    },
    async apply(input: Parameters<PostgresPaperSimulationRepository['apply']>[0]) {
      if (state === undefined || state.id !== input.experimentId) throw new Error('not found');
      state = applyPaperCommand(state, input.command);
      return structuredClone(state);
    },
    async listOutbox(input: Parameters<PostgresPaperSimulationRepository['listOutbox']>[0]) {
      if (state === undefined || state.id !== input.experimentId) throw new Error('not found');
      const start =
        input.after === undefined
          ? 0
          : state.outbox.findIndex((record) => record.id === input.after) + 1;
      const limit = input.limit ?? 50;
      const records = state.outbox.slice(start, start + limit);
      return {
        records: structuredClone(records),
        nextCursor:
          start + records.length < state.outbox.length ? (records.at(-1)?.id ?? null) : null,
      };
    },
  } as unknown as PostgresPaperSimulationRepository;
}

describe('模拟实验 HTTP', () => {
  const apps: Awaited<ReturnType<typeof createApp>>[] = [];
  const runtimes: AppRuntime[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.close?.()));
  });

  it('创建、幂等执行命令并读取稳定发件箱，始终声明只读链访问', async () => {
    const runtime = createRuntime(baseConfig());
    runtimes.push(runtime);
    runtime.paperSimulation = memoryRepository();
    const app = await createApp({ config: baseConfig(), runtime, logger: false });
    apps.push(app);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/paper/experiments',
      payload: {
        name: 'SOL 模拟主实验',
        chain: 'SOLANA',
        initialPrincipalAtomic: '1000000000',
        policy,
        createdAt: '2026-08-31T00:00:00.000Z',
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      mode: 'PAPER',
      chainAccess: 'READ_ONLY',
      experiment: { chain: 'SOLANA', revision: 0 },
    });
    expect(String(created.json().warning)).toContain('不会签名');
    const experimentId = String(created.json().experiment.id);
    const payload = {
      expectedRevision: 0,
      command: {
        type: 'ENTER_CANDIDATE',
        commandId: 'candidate-1',
        assetId: 'So11111111111111111111111111111111111111112',
        strategyVersion: 'strategy-v1',
        candidateEpoch: 'epoch-1',
        eventAt: '2026-08-31T00:01:00.000Z',
        reasons: ['满足有界观察条件'],
        evidenceIds: [`ev_${'1'.repeat(24)}`],
      },
    };
    const applied = await app.inject({
      method: 'POST',
      url: `/api/v1/paper/experiments/${experimentId}/commands`,
      payload,
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().experiment).toMatchObject({ revision: 1 });
    expect(applied.json().experiment.outbox).toHaveLength(1);

    const replay = await app.inject({
      method: 'POST',
      url: `/api/v1/paper/experiments/${experimentId}/commands`,
      payload,
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().experiment).toMatchObject({ revision: 1 });
    expect(replay.json().experiment.outbox).toHaveLength(1);

    const outbox = await app.inject({
      method: 'GET',
      url: `/api/v1/paper/experiments/${experimentId}/outbox?limit=1`,
    });
    expect(outbox.statusCode).toBe(200);
    expect(outbox.json()).toMatchObject({
      mode: 'PAPER',
      deliverySemantics: 'AT_LEAST_ONCE_WITH_BUSINESS_KEY_DEDUP',
    });
    expect(outbox.json().records).toHaveLength(1);
  });

  it('无持久仓库时失败关闭，并拒绝权限或签名类额外字段', async () => {
    const config = baseConfig();
    const runtime = createRuntime(config);
    runtimes.push(runtime);
    const app = await createApp({ config, runtime, logger: false });
    apps.push(app);

    const unavailable = await app.inject({
      method: 'POST',
      url: '/api/v1/paper/experiments',
      payload: {
        name: 'BSC 模拟主实验',
        chain: 'BSC',
        initialPrincipalAtomic: '1000000000000000000',
        policy,
      },
    });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json().error.code).toBe('PAPER_STORAGE_NOT_INITIALIZED');

    runtime.paperSimulation = memoryRepository();
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/paper/experiments',
      payload: {
        name: 'BSC 模拟主实验',
        chain: 'BSC',
        initialPrincipalAtomic: '1000000000000000000',
        policy,
        privateKey: 'forbidden',
      },
    });
    expect(forbidden.statusCode).toBe(400);
    expect(forbidden.json().error.code).toBe('INVALID_REQUEST');
  });
});
