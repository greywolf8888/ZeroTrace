import { describe, expect, it } from 'vitest';

import { loadTokenHistoryBackfillWorkerConfig } from './token-history-backfill-config.js';

const baseEnv = {
  POSTGRES_URL: 'postgresql://zerotrace:worker@database.example/zerotrace',
  CLICKHOUSE_URL: 'http://clickhouse.example:8123',
  OBJECT_STORE_ENDPOINT: 'http://objects.example:9000',
  OBJECT_STORE_ACCESS_KEY: 'worker-access',
  OBJECT_STORE_SECRET_KEY: 'worker-secret',
  EVM_BSC_RPC_URLS: 'https://bsc-a.example,https://bsc-b.example',
  SQD_PORTAL_URL: 'https://portal.sqd.dev',
};

describe('Token History backfill worker configuration', () => {
  it('uses the public BSC RPC by default and expands an Ethereum template only with a key', () => {
    const config = loadTokenHistoryBackfillWorkerConfig(
      {
        ...baseEnv,
        ETH_RPC_URL: 'https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}',
        ALCHEMY_API_KEY: 'template-key',
      },
      ['--once'],
    );
    expect(config.bscRpcUrls).toEqual(['https://bsc-a.example/', 'https://bsc-b.example/']);
    expect(config.ethereumRpcUrls).toEqual(['https://eth-mainnet.g.alchemy.com/v2/template-key']);
    expect(config.once).toBe(true);
    expect(config.providerAllowedHosts).toEqual([
      'bsc-a.example',
      'bsc-b.example',
      'eth-mainnet.g.alchemy.com',
    ]);
    expect(config.checkpointBatchSize).toBe(50);
  });

  it('keeps an unconfigured Ethereum chain explicit instead of retaining a template literal', () => {
    const config = loadTokenHistoryBackfillWorkerConfig(baseEnv, []);
    expect(config.ethereumRpcUrls).toEqual([]);
    expect(config.bscRpcUrls).toEqual(['https://bsc-a.example/', 'https://bsc-b.example/']);
  });

  it('requires durable storage and rejects unsupported worker arguments', () => {
    expect(() =>
      loadTokenHistoryBackfillWorkerConfig({ ...baseEnv, POSTGRES_URL: '' }, []),
    ).toThrow('POSTGRES_URL is required');
    expect(() => loadTokenHistoryBackfillWorkerConfig(baseEnv, ['--token'])).toThrow(
      'Unknown Token History backfill argument',
    );
  });

  it('accepts a bounded checkpoint batch size for interruption drills', () => {
    expect(
      loadTokenHistoryBackfillWorkerConfig(
        { ...baseEnv, TOKEN_HISTORY_CHECKPOINT_BATCH_SIZE: '1' },
        [],
      ).checkpointBatchSize,
    ).toBe(1);
    expect(() =>
      loadTokenHistoryBackfillWorkerConfig(
        { ...baseEnv, TOKEN_HISTORY_CHECKPOINT_BATCH_SIZE: '1001' },
        [],
      ),
    ).toThrow('TOKEN_HISTORY_CHECKPOINT_BATCH_SIZE must be between 1 and 1000.');
  });

  it('accepts only a canonical schedule selector for targeted operator replays', () => {
    const scheduleId = 'cps_0123456789abcdef01234567';
    expect(
      loadTokenHistoryBackfillWorkerConfig(
        { ...baseEnv, CAPTURE_WORKER_SCHEDULE_ID: scheduleId },
        [],
      ).scheduleId,
    ).toBe(scheduleId);
    expect(() =>
      loadTokenHistoryBackfillWorkerConfig(
        { ...baseEnv, CAPTURE_WORKER_SCHEDULE_ID: 'schedule-anything' },
        [],
      ),
    ).toThrow('CAPTURE_WORKER_SCHEDULE_ID must be a valid capture schedule ID.');
  });

  it('enables strict independent-provider reads only when explicitly requested', () => {
    expect(
      loadTokenHistoryBackfillWorkerConfig(
        { ...baseEnv, TOKEN_HISTORY_REQUIRE_INDEPENDENT_RPC: 'true' },
        [],
      ).requireIndependentRpc,
    ).toBe(true);
    expect(loadTokenHistoryBackfillWorkerConfig(baseEnv, []).requireIndependentRpc).toBeUndefined();
    expect(() =>
      loadTokenHistoryBackfillWorkerConfig(
        { ...baseEnv, TOKEN_HISTORY_REQUIRE_INDEPENDENT_RPC: 'yes' },
        [],
      ),
    ).toThrow('TOKEN_HISTORY_REQUIRE_INDEPENDENT_RPC must be true or false.');
  });
});
