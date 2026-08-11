import { describe, expect, it } from 'vitest';

import { loadSupplyContinuityWorkerConfig } from './supply-continuity-config.js';

const args = ['--token', `0x${'a'.repeat(40)}`, '--from', '100000', '--to', '100255'];
const env = {
  EVM_BSC_RPC_URLS: 'https://bsc-a.example,https://bsc-b.example',
  SQD_PORTAL_URL: 'https://portal.example',
  POSTGRES_URL: 'postgresql://zerotrace:private@postgres.example/zerotrace',
};

describe('supply-continuity worker configuration', () => {
  it('loads bounded all-block state segments', () => {
    const config = loadSupplyContinuityWorkerConfig(env, args);
    expect(config).toMatchObject({
      token: `0x${'a'.repeat(40)}`,
      fromBlock: 100_000,
      toBlock: 100_255,
      segmentSize: 128,
      maxTransfers: 25_000,
      providerAllowedHosts: ['bsc-a.example', 'bsc-b.example'],
      sqdAllowedHosts: ['portal.example'],
    });
    expect(JSON.stringify({ ...config, postgresUrl: '[REDACTED]' })).not.toContain('private');
  });

  it('rejects write-like arguments, genesis, and oversized segment counts', () => {
    expect(() =>
      loadSupplyContinuityWorkerConfig(env, [...args, '--private-key', 'secret']),
    ).toThrow('Unknown supply-continuity argument');
    expect(() =>
      loadSupplyContinuityWorkerConfig(env, ['--token', args[1] ?? '', '--from', '0', '--to', '1']),
    ).toThrow('--from must be between 1');
    expect(() => loadSupplyContinuityWorkerConfig(env, [...args, '--segment-size', '1'])).toThrow(
      'Requested range exceeds 32 segments',
    );
  });

  it('requires durable storage and safe provider URLs', () => {
    expect(() => loadSupplyContinuityWorkerConfig({ ...env, POSTGRES_URL: '' }, args)).toThrow(
      'POSTGRES_URL is required',
    );
    expect(() =>
      loadSupplyContinuityWorkerConfig({ ...env, SQD_PORTAL_URL: 'http://portal.example' }, args),
    ).toThrow('must use HTTPS');
  });
});
