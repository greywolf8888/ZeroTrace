import { afterEach, describe, expect, it } from 'vitest';

import {
  applyPaperCommand,
  type PaperCommand,
  type PaperExperiment,
  type PaperReviewReport,
} from '@zerotrace/asset-ledger';
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
  const journal: PaperCommand[] = [];
  const reviews = new Map<string, PaperReviewReport>();
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
      const next = applyPaperCommand(state, input.command);
      if (next !== state) journal.push(structuredClone(input.command));
      state = next;
      return structuredClone(state);
    },
    async getCommandJournal(id: string) {
      if (state === undefined || state.id !== id) throw new Error('not found');
      return structuredClone(journal);
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
    async saveReview(report: PaperReviewReport) {
      reviews.set(report.id, structuredClone(report));
      return structuredClone(report);
    },
    async getReview(id: string) {
      const report = reviews.get(id);
      return report === undefined ? undefined : structuredClone(report);
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
    const validEvidence = new Set([`ev_${'1'.repeat(24)}`, `ev_${'2'.repeat(24)}`]);
    const runtime = createRuntime(baseConfig());
    runtimes.push(runtime);
    runtime.paperSimulation = memoryRepository();
    runtime.evidenceRepository = {
      async get(id: string) {
        if (!validEvidence.has(id)) return undefined;
        return {
          evidence: {
            id,
            ledger: 'SOLANA',
            chainId: 'solana-mainnet',
            observedAt: '2026-08-31T00:00:00.000Z',
          },
        };
      },
    } as unknown as NonNullable<AppRuntime['evidenceRepository']>;
    const app = await createApp({ config: baseConfig(), runtime, logger: false });
    apps.push(app);

    const settings = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/paper-simulation',
    });
    expect(settings.statusCode).toBe(200);
    expect(settings.json()).toMatchObject({
      version: 'V11.0',
      walletMode: 'PAPER_ONLY',
      automaticChainBridging: false,
      source: { kind: 'VERSIONED_LOCAL_CONFIG', reference: 'paper_portfolios.json' },
      policy: { targetPositionBps: 500, opaqueTokenStressLossBps: 10_000 },
    });
    expect(JSON.stringify(settings.json())).not.toContain('F:\\ZeroTrace');

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

    const forgedEvidence = await app.inject({
      method: 'POST',
      url: `/api/v1/paper/experiments/${experimentId}/commands`,
      payload: {
        ...payload,
        expectedRevision: 1,
        command: {
          ...payload.command,
          commandId: 'candidate-forged',
          candidateEpoch: 'epoch-forged',
          evidenceIds: [`ev_${'f'.repeat(24)}`],
        },
      },
    });
    expect(forgedEvidence.statusCode).toBe(400);
    expect(forgedEvidence.json().error.code).toBe('PAPER_STORAGE_INVALID');

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

    const review = await app.inject({
      method: 'POST',
      url: `/api/v1/paper/experiments/${experimentId}/reviews`,
      payload: {
        asOf: '2026-08-31T01:01:00.000Z',
        rejectedCandidates: [
          {
            candidateId: 'rejected-1',
            assetId: 'So22222222222222222222222222222222222222222',
            chain: 'SOLANA',
            strategyVersion: 'strategy-v1',
            decisionAt: '2026-08-31T00:10:00.000Z',
            evaluatedAt: '2026-08-31T01:00:00.000Z',
            rejectionReasons: ['历史退出容量不足'],
            evidenceIds: [`ev_${'2'.repeat(24)}`],
            entryCost: {
              state: 'known',
              valueAtomic: '10',
              sourceId: 'source-a',
              observedAt: '2026-08-31T00:09:00.000Z',
              availableAt: '2026-08-31T00:09:00.000Z',
            },
            laterExitProceeds: {
              state: 'known',
              valueAtomic: '30',
              sourceId: 'source-a',
              observedAt: '2026-08-31T01:00:00.000Z',
              availableAt: '2026-08-31T01:00:00.000Z',
            },
            estimatedCosts: {
              state: 'known',
              valueAtomic: '2',
              sourceId: 'source-a',
              observedAt: '2026-08-31T01:00:00.000Z',
              availableAt: '2026-08-31T01:00:00.000Z',
            },
            exitCapacity: {
              state: 'known',
              valueAtomic: '20',
              sourceId: 'source-a',
              observedAt: '2026-08-31T01:00:00.000Z',
              availableAt: '2026-08-31T01:00:00.000Z',
            },
          },
        ],
      },
    });
    expect(review.statusCode).toBe(201);
    expect(review.json()).toMatchObject({
      mode: 'PAPER',
      historicalState: true,
      report: {
        historicalState: true,
        rejectedCandidates: [
          { executableExitProceedsAtomic: '20', netCounterfactualPnlAtomic: '8' },
        ],
      },
    });
    const replayedReview = await app.inject({
      method: 'GET',
      url: `/api/v1/paper/reviews/${String(review.json().report.id)}`,
    });
    expect(replayedReview.statusCode).toBe(200);
    expect(replayedReview.json().report).toEqual(review.json().report);
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
