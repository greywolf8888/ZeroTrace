import { describe, expect, it } from 'vitest';

import { loadFlapOriginWorkerConfig } from './config.js';

const args = [
  '--token',
  '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
  '--from',
  '0',
  '--to',
  '999999',
];

const env = {
  EVM_BSC_RPC_URLS: 'https://bsc-a.example,https://bsc-b.example',
  SQD_PORTAL_URL: 'https://portal.example',
  POSTGRES_URL: 'postgresql://zerotrace:private@postgres.example/zerotrace',
};

describe('Flap origin worker configuration', () => {
  it('loads a canonical read-only BSC/SQD range without exposing database credentials', () => {
    const config = loadFlapOriginWorkerConfig(env, args);
    expect(config).toMatchObject({
      token: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      fromBlock: 0,
      toBlock: 999_999,
      chunkSize: 1_000_000,
      providerAllowedHosts: ['bsc-a.example', 'bsc-b.example'],
      sqdAllowedHosts: ['portal.example'],
    });
    expect(JSON.stringify({ ...config, postgresUrl: '[REDACTED]' })).not.toContain('private');
  });

  it('rejects unknown/write-like arguments, invalid tokens, and operationally unsafe ranges', () => {
    expect(() => loadFlapOriginWorkerConfig(env, [...args, '--broadcast', 'true'])).toThrow(
      'Unknown Flap origin argument',
    );
    expect(() =>
      loadFlapOriginWorkerConfig(env, ['--token', 'not-an-address', '--from', '0', '--to', '1']),
    ).toThrow('--token must be an EVM address');
    expect(() =>
      loadFlapOriginWorkerConfig(env, [
        '--token',
        args[1] ?? '',
        '--from',
        '0',
        '--to',
        '250000000',
      ]),
    ).toThrow('Requested range exceeds');
  });

  it('requires durable storage and HTTPS providers unless private development is explicit', () => {
    expect(() => loadFlapOriginWorkerConfig({ ...env, POSTGRES_URL: '' }, args)).toThrow(
      'POSTGRES_URL is required',
    );
    expect(() =>
      loadFlapOriginWorkerConfig({ ...env, EVM_BSC_RPC_URLS: 'http://bsc.example' }, args),
    ).toThrow('must use HTTPS');
    expect(
      loadFlapOriginWorkerConfig(
        {
          ...env,
          EVM_BSC_RPC_URLS: 'http://127.0.0.1:8545',
          ALLOW_PRIVATE_PROVIDER_URLS: 'true',
        },
        args,
      ).bscRpcUrls,
    ).toEqual(['http://127.0.0.1:8545']);
  });
});
