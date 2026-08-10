import { describe, expect, it } from 'vitest';

import { loadFlapHistoryWorkerConfig } from './history-config.js';

const args = ['--token', `0x${'a'.repeat(40)}`, '--from', '100000', '--to', '199999'];

const env = {
  EVM_BSC_RPC_URLS: 'https://bsc-a.example,https://bsc-b.example',
  SQD_PORTAL_URL: 'https://portal.example',
  POSTGRES_URL: 'postgresql://zerotrace:private@postgres.example/zerotrace',
};

describe('Flap history worker configuration', () => {
  it('loads bounded outer segments and inner log-query chunks', () => {
    const config = loadFlapHistoryWorkerConfig(env, args);
    expect(config).toMatchObject({
      token: `0x${'a'.repeat(40)}`,
      fromBlock: 100_000,
      toBlock: 199_999,
      segmentSize: 50_000,
      chunkSize: 2_000,
      maxTransactions: 250,
      maxLogs: 25_000,
      providerAllowedHosts: ['bsc-a.example', 'bsc-b.example'],
      sqdAllowedHosts: ['portal.example'],
    });
    expect(JSON.stringify({ ...config, postgresUrl: '[REDACTED]' })).not.toContain('private');
  });

  it('rejects write-like arguments and unsafe range/segment limits', () => {
    expect(() => loadFlapHistoryWorkerConfig(env, [...args, '--broadcast', 'true'])).toThrow(
      'Unknown Flap history argument',
    );
    expect(() =>
      loadFlapHistoryWorkerConfig(env, [
        '--token',
        args[1] ?? '',
        '--from',
        '0',
        '--to',
        '250000000',
      ]),
    ).toThrow('Requested range exceeds');
    expect(() => loadFlapHistoryWorkerConfig(env, [...args, '--segment-size', '50001'])).toThrow(
      '--segment-size must be between 1 and 50000',
    );
    expect(() => loadFlapHistoryWorkerConfig(env, [...args, '--max-transactions', '251'])).toThrow(
      '--max-transactions must be between 1 and 250',
    );
  });

  it('requires durable storage and safe provider URLs', () => {
    expect(() => loadFlapHistoryWorkerConfig({ ...env, POSTGRES_URL: '' }, args)).toThrow(
      'POSTGRES_URL is required',
    );
    expect(() =>
      loadFlapHistoryWorkerConfig({ ...env, SQD_PORTAL_URL: 'http://portal.example' }, args),
    ).toThrow('must use HTTPS');
  });
});
