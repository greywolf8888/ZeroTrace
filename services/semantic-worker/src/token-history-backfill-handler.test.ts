import { describe, expect, it } from 'vitest';

import { CaptureRunSchema } from '@zerotrace/schemas';

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
      parameters: {
        schemaVersion: 'token-live-capture-v1',
        dataset: 'binance-mainnet',
        token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
        initialFromBlock: '100',
        windowBlocks: 1_000,
        modelVersion: 'token-live-capture-v1.0.0',
        policyVersion: 'token-history-policy-v1.0.0',
      },
    });
    await expect(
      createTokenHistoryLiveCaptureHandler(config(), resources())(liveRun),
    ).rejects.toMatchObject({
      code: 'TOKEN_LIVE_CAPTURE_SCHEDULER_UNAVAILABLE',
      sourceRetryable: false,
    });
  });
});
