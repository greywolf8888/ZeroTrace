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
      profile: 'block-headers',
      fromBlock: 100,
      toBlock: 120,
      requestsPerSecond: 2,
      providerPolicy: { allowPrivateNetworks: false },
    });
  });

  it('accepts the explicit transaction profile', () => {
    expect(
      loadIngestWorkerConfig(env, [
        '--dataset',
        'solana-mainnet',
        '--profile',
        'transactions',
        '--from',
        '100',
        '--to',
        '100',
      ]),
    ).toMatchObject({ dataset: 'solana-mainnet', profile: 'transactions' });
  });

  it('accepts the explicit ledger-record profile', () => {
    expect(
      loadIngestWorkerConfig(env, [
        '--dataset',
        'bitcoin-mainnet',
        '--profile',
        'ledger-records',
        '--from',
        '170',
        '--to',
        '170',
      ]),
    ).toMatchObject({ dataset: 'bitcoin-mainnet', profile: 'ledger-records' });
  });

  it('loads token-history with a configured BSC public RPC without exposing credentials', () => {
    expect(
      loadIngestWorkerConfig({ ...env, BSC_RPC_URL: 'https://bsc-dataseed.bnbchain.org' }, [
        '--dataset',
        'binance-mainnet',
        '--profile',
        'token-history',
        '--token',
        `0x${'a'.repeat(40)}`,
        '--from',
        '1',
        '--to',
        '2',
      ]),
    ).toMatchObject({
      profile: 'token-history',
      token: `0x${'a'.repeat(40)}`,
      evmRpcUrl: 'https://bsc-dataseed.bnbchain.org',
      evmChainId: 56,
    });
  });

  it('falls back to the legacy EVM RPC variable when the preferred variable is blank', () => {
    expect(
      loadIngestWorkerConfig(
        {
          ...env,
          BSC_RPC_URL: '',
          EVM_BSC_RPC_URL: 'https://bsc-dataseed-public.bnbchain.org',
        },
        [
          '--dataset',
          'binance-mainnet',
          '--profile',
          'token-history',
          '--token',
          `0x${'a'.repeat(40)}`,
          '--from',
          '1',
          '--to',
          '2',
        ],
      ),
    ).toMatchObject({ evmRpcUrl: 'https://bsc-dataseed-public.bnbchain.org' });
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
      loadIngestWorkerConfig(env, [
        '--dataset',
        'ethereum-mainnet',
        '--profile',
        'all-data',
        '--from',
        '0',
        '--to',
        '1',
      ]),
    ).toThrow(/profile/);
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
