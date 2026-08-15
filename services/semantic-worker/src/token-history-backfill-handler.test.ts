import { createServer, type Server } from 'node:http';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { CaptureRunSchema } from '@zerotrace/schemas';
import { hashPayload } from '@zerotrace/evidence';

import {
  createTokenHistoryBackfillHandler,
  createTokenHistoryLiveCaptureHandler,
  type TokenHistoryBackfillHandlerResources,
} from './token-history-backfill-handler.js';
import type { TokenHistoryBackfillWorkerConfig } from './token-history-backfill-config.js';

function config(overrides: Partial<TokenHistoryBackfillWorkerConfig> = {}) {
  return {
    postgresUrl: 'postgresql://worker@database.example/zerotrace',
    clickhouseUrl: 'http://clickhouse.example:8123',
    objectStoreEndpoint: 'http://objects.example:9000',
    objectStoreAccessKey: 'access',
    objectStoreSecretKey: 'secret',
    objectStoreBucket: 'zerotrace-raw',
    ethereumRpcUrls: [],
    bscRpcUrls: ['https://bsc.example/'],
    sqdPortalUrl: 'https://portal.sqd.dev',
    providerAllowedHosts: ['bsc.example'],
    sqdAllowedHosts: ['portal.sqd.dev'],
    allowPrivateProviderUrls: false,
    requestTimeoutMs: 1_000,
    ethereumRequestsPerSecond: 0,
    bscRequestsPerSecond: 0,
    sqdRequestsPerSecond: 0,
    maxAttempts: 1,
    retryBaseDelayMs: 0,
    retryMaxDelayMs: 0,
    maxFactRows: 10,
    checkpointBatchSize: 50,
    owner: 'test-worker',
    pollIntervalMs: 250,
    leaseSeconds: 30,
    batchSize: 1,
    once: true,
    ...overrides,
  } satisfies TokenHistoryBackfillWorkerConfig;
}

function resources(): TokenHistoryBackfillHandlerResources {
  return {} as TokenHistoryBackfillHandlerResources;
}

const TOKEN = '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777';
const SOURCE_IDS = ['bsc-rpc@bsc.example#1', 'bsc-rpc@bsc-2.example#2'];
const HASH_A = `0x${'a'.repeat(64)}`;
const HASH_B = `0x${'b'.repeat(64)}`;

function liveParameters() {
  return {
    schemaVersion: 'token-live-capture-v1' as const,
    dataset: 'binance-mainnet' as const,
    token: TOKEN,
    initialFromBlock: '900',
    windowBlocks: 1_000,
    modelVersion: 'token-live-capture-v1.0.0',
    policyVersion: 'token-history-policy-v1.0.0',
  };
}

function snapshot(
  blockNumber: string,
  blockHash: string,
  sourceIds: readonly string[] = SOURCE_IDS,
) {
  return {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber,
    blockHash,
    parentBlockHash: HASH_A,
    finality: 'finalized' as const,
    blockTimestamp: '2026-08-14T00:00:00.000Z',
    capturedAt: '2026-08-14T00:00:00.000Z',
    providerVersions: Object.fromEntries(sourceIds.map((sourceId) => [sourceId, 'json-rpc'])),
    adapterVersions: { evm: '0.1.0' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-empty-v1',
  };
}

function previousSuccess(
  blockNumber: string,
  blockHash: string,
  sourceIds: readonly string[] = SOURCE_IDS,
) {
  const previousSnapshot = snapshot(blockNumber, blockHash, sourceIds);
  const evidenceId = 'ev_aaaaaaaaaaaaaaaaaaaaaaaa';
  return run({
    captureKind: 'TOKEN_LIVE_CAPTURE',
    parameters: liveParameters(),
    status: 'SUCCEEDED',
    lease: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    result: {
      state: 'known',
      value: {
        resultRef: `token-live-capture:previous#sha256=${'d'.repeat(64)}`,
        snapshot: previousSnapshot,
        terminalEvidenceId: evidenceId,
        evidenceIds: [evidenceId],
        sourceSet: [...sourceIds].sort(),
        modelVersion: 'token-live-capture-v1.0.0',
        coverage: 1,
        freshness: previousSnapshot.capturedAt,
        confidence: 1,
      },
    },
    completedAt: { state: 'known', value: '2026-08-14T00:00:00.000Z' },
  });
}

function monitorResources(runs: readonly ReturnType<typeof run>[]) {
  const put = vi.fn(
    async (
      _evidence: { id: string; kind: string; payloadHash: string },
      _sourceEvidenceIds: readonly string[] = [],
    ) => undefined,
  );
  return {
    ...resources(),
    schedules: { listRunsForSchedule: vi.fn(async () => [...runs]) },
    evidence: { put },
  } as unknown as TokenHistoryBackfillHandlerResources & { evidence: { put: typeof put } };
}

async function openRpcPair(
  resolveBlock: (blockTag: unknown) => { number: string; hash: string },
): Promise<{ urls: readonly string[]; close: () => Promise<void> }> {
  const servers: Server[] = [];
  const urls: string[] = [];
  try {
    for (const host of ['127.0.0.1', '127.0.0.2']) {
      const server = createServer((request, response) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk: string) => {
          body += chunk;
        });
        request.on('end', () => {
          const parsed = JSON.parse(body) as { id?: number; params?: readonly unknown[] };
          const block = resolveBlock(parsed.params?.[0]);
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id ?? 1,
              result: {
                number: `0x${BigInt(block.number).toString(16)}`,
                hash: block.hash,
                parentHash: HASH_A,
                timestamp: '0x68a4a800',
              },
            }),
          );
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, host, () => resolve());
      });
      const address = server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('RPC test server did not expose a TCP address.');
      }
      servers.push(server);
      urls.push(`http://${host}:${address.port}/`);
    }
  } catch (error) {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    throw error;
  }
  return {
    urls,
    close: async () => {
      await Promise.all(
        servers.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve());
            }),
        ),
      );
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function run(overrides: Record<string, unknown> = {}) {
  return CaptureRunSchema.parse({
    schemaVersion: 'capture-run-v1',
    id: 'cpr_0123456789abcdef01234567',
    scheduleId: 'cps_0123456789abcdef01234567',
    captureKind: 'TOKEN_HISTORY_BACKFILL',
    operation: 'READ_ONLY_CAPTURE',
    target: {
      ledger: 'EVM',
      chainId: 'eip155:56',
      subjectType: 'TOKEN',
      normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
    },
    parameters: {
      schemaVersion: 'token-history-backfill-v1',
      dataset: 'binance-mainnet',
      token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      fromBlock: '113485950',
      toBlock: '113495949',
      modelVersion: 'token-history-backfill-v1.0.0',
      policyVersion: 'token-history-policy-v1.0.0',
    },
    scheduledFor: '2026-08-14T00:00:00.000Z',
    status: 'LEASED',
    attempt: 1,
    maxAttempts: 3,
    availableAt: '2026-08-14T00:00:00.000Z',
    lease: {
      state: 'known',
      value: {
        owner: 'test-worker',
        token: '0123456789abcdef0123456789abcdef',
        expiresAt: '2026-08-14T00:05:00.000Z',
      },
    },
    result: { state: 'unknown', reason: 'NOT_QUERIED' },
    failure: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    completedAt: { state: 'unknown', reason: 'NOT_APPLICABLE' },
    ...overrides,
  });
}

describe('Token History backfill capture handler', () => {
  it('fails closed when the immutable target and parameters disagree', async () => {
    const mismatched = run({
      target: {
        ledger: 'EVM',
        chainId: 'eip155:1',
        subjectType: 'TOKEN',
        normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      },
    });
    await expect(
      createTokenHistoryBackfillHandler(config(), resources())(mismatched),
    ).rejects.toMatchObject({
      code: 'TOKEN_HISTORY_BACKFILL_TARGET_MISMATCH',
      sourceRetryable: false,
    });
  });

  it('keeps missing Ethereum RPC configuration explicit', async () => {
    const ethereumRun = run({
      target: {
        ledger: 'EVM',
        chainId: 'eip155:1',
        subjectType: 'TOKEN',
        normalizedIdentifier: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      },
      parameters: {
        schemaVersion: 'token-history-backfill-v1',
        dataset: 'ethereum-mainnet',
        token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
        fromBlock: '100',
        toBlock: '101',
        modelVersion: 'token-history-backfill-v1.0.0',
        policyVersion: 'token-history-policy-v1.0.0',
      },
    });
    await expect(
      createTokenHistoryBackfillHandler(config(), resources())(ethereumRun),
    ).rejects.toMatchObject({
      code: 'TOKEN_HISTORY_BACKFILL_RPC_UNCONFIGURED',
      sourceRetryable: false,
    });
  });

  it('rejects malformed parameters before contacting providers', async () => {
    const malformed = run({ parameters: { schemaVersion: 'not-a-backfill' } });
    await expect(
      createTokenHistoryBackfillHandler(config(), resources())(malformed),
    ).rejects.toMatchObject({
      code: 'TOKEN_HISTORY_BACKFILL_INVALID_PARAMETERS',
      sourceRetryable: false,
    });
  });

  it('requires durable schedule history before starting a live monitor', async () => {
    const liveRun = run({
      captureKind: 'TOKEN_LIVE_CAPTURE',
      parameters: liveParameters(),
    });
    await expect(
      createTokenHistoryLiveCaptureHandler(config(), resources())(liveRun),
    ).rejects.toMatchObject({
      code: 'TOKEN_LIVE_CAPTURE_SCHEDULER_UNAVAILABLE',
      sourceRetryable: false,
    });
  });

  it('keeps the complete strict-provider source set on a durable heartbeat', async () => {
    const endpoints = await openRpcPair(() => ({ number: '1000', hash: HASH_A }));
    try {
      const sourceIds = endpoints.urls.map(
        (url, index) => `bsc-rpc@${new URL(url).hostname}#${index + 1}`,
      );
      const monitor = monitorResources([previousSuccess('1000', HASH_A, sourceIds)]);
      const result = await createTokenHistoryLiveCaptureHandler(
        config({
          requireIndependentRpc: true,
          bscRpcUrls: [...endpoints.urls],
          providerAllowedHosts: endpoints.urls.map((url) => new URL(url).hostname),
          allowPrivateProviderUrls: true,
        }),
        monitor,
      )(
        run({
          captureKind: 'TOKEN_LIVE_CAPTURE',
          parameters: liveParameters(),
        }),
      );

      expect(result.sourceSet).toEqual(sourceIds);
      expect(result.evidenceIds).toHaveLength(sourceIds.length + 1);
      expect(monitor.evidence.put).toHaveBeenCalledTimes(sourceIds.length + 1);
      const providerEvidence = monitor.evidence.put.mock.calls
        .slice(0, sourceIds.length)
        .map((call) => call[0]);
      expect(providerEvidence.map((evidence) => evidence.kind)).toEqual(
        sourceIds.map(() => 'PROVIDER_OBSERVATION'),
      );
      expect(providerEvidence.map((evidence) => evidence.id).sort()).toEqual(
        result.evidenceIds.filter((id) => id !== result.terminalEvidenceId).sort(),
      );
      const heartbeatCall = monitor.evidence.put.mock.calls[sourceIds.length];
      const heartbeatEvidence = heartbeatCall?.[0];
      expect(heartbeatEvidence?.kind).toBe('DERIVED_FEATURE');
      expect(heartbeatCall?.[1]).toEqual(providerEvidence.map((evidence) => evidence.id).sort());
      expect(heartbeatEvidence?.payloadHash).toBe(
        hashPayload({
          schemaVersion: 'token-live-capture-heartbeat-v1',
          scheduleId: 'cps_0123456789abcdef01234567',
          token: TOKEN,
          fromBlock: '1001',
          finalizedHead: '1000',
          state: 'NO_NEW_FINALIZED_RANGE',
          providerSources: sourceIds,
        }),
      );
    } finally {
      await endpoints.close();
    }
  });

  it('fails closed when the durable finalized cursor no longer matches the chain', async () => {
    const endpoints = await openRpcPair((blockTag) =>
      blockTag === 'finalized' ? { number: '1000', hash: HASH_B } : { number: '999', hash: HASH_B },
    );
    try {
      const sourceIds = endpoints.urls.map(
        (url, index) => `bsc-rpc@${new URL(url).hostname}#${index + 1}`,
      );
      const monitor = monitorResources([previousSuccess('999', HASH_A, sourceIds)]);

      await expect(
        createTokenHistoryLiveCaptureHandler(
          config({
            requireIndependentRpc: true,
            bscRpcUrls: [...endpoints.urls],
            providerAllowedHosts: endpoints.urls.map((url) => new URL(url).hostname),
            allowPrivateProviderUrls: true,
          }),
          monitor,
        )(
          run({
            captureKind: 'TOKEN_LIVE_CAPTURE',
            parameters: liveParameters(),
          }),
        ),
      ).rejects.toMatchObject({
        code: 'TOKEN_LIVE_CAPTURE_REORG_DETECTED',
        sourceRetryable: true,
      });
      expect(monitor.evidence.put).not.toHaveBeenCalled();
    } finally {
      await endpoints.close();
    }
  });
});
