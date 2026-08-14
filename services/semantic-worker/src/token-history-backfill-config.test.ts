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
});
