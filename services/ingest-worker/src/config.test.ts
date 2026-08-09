import { describe, expect, it } from 'vitest';

import { loadIngestWorkerConfig } from './config.js';

const env = {
  POSTGRES_URL: 'postgresql://zerotrace:test@postgres:5432/zerotrace',
  CLICKHOUSE_URL: 'http://clickhouse:8123',
  OBJECT_STORE_ENDPOINT: 'http://minio:9000',
  OBJECT_STORE_ACCESS_KEY: 'test-access',
  OBJECT_STORE_SECRET_KEY: 'test-secret',
  SQD_PROVIDER_ALLOW_HOSTS: 'portal.sqd.dev',
};

describe('ingest worker config', () => {
  it('loads a bounded supported finalized range', () => {
    expect(
      loadIngestWorkerConfig(env, ['--dataset', 'bitcoin-mainnet', '--from', '100', '--to', '120']),
    ).toMatchObject({
      dataset: 'bitcoin-mainnet',
      fromBlock: 100,
      toBlock: 120,
      requestsPerSecond: 2,
      providerPolicy: { allowPrivateNetworks: false },
    });
  });

  it('rejects unsupported datasets, unknown arguments, unsafe ranges, and missing durable stores', () => {
    expect(() =>
      loadIngestWorkerConfig(env, ['--dataset', 'unknown-mainnet', '--from', '0', '--to', '1']),
    ).toThrow(/supported/);
    expect(() =>
      loadIngestWorkerConfig(env, [
        '--dataset',
        'ethereum-mainnet',
        '--from',
        '0',
        '--to',
        '1',
        '--write-chain',
        'true',
      ]),
    ).toThrow(/Unknown/);
    expect(() =>
      loadIngestWorkerConfig({ ...env, SQD_MAX_RANGE_BLOCKS: '1' }, [
        '--dataset',
        'ethereum-mainnet',
        '--from',
        '0',
        '--to',
        '1',
      ]),
    ).toThrow(/exceeds/);
    expect(() =>
      loadIngestWorkerConfig({ ...env, POSTGRES_URL: '' }, [
        '--dataset',
        'ethereum-mainnet',
        '--from',
        '0',
        '--to',
        '0',
      ]),
    ).toThrow(/POSTGRES_URL/);
  });
});
