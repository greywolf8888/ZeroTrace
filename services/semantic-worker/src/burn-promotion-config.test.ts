import { describe, expect, it } from 'vitest';

import { loadBurnPromotionWorkerConfig } from './burn-promotion-config.js';

const args = ['--token', `0x${'a'.repeat(40)}`, '--from', '100000', '--to', '1099999'];
const env = {
  EVM_BSC_RPC_URLS: 'https://bsc-a.example,https://bsc-b.example',
  SQD_PORTAL_URL: 'https://portal.example',
  POSTGRES_URL: 'postgresql://zerotrace:private@postgres.example/zerotrace',
};

describe('burn promotion worker configuration', () => {
  it('loads bounded event segments and candidate limits', () => {
    const config = loadBurnPromotionWorkerConfig(env, args);
    expect(config).toMatchObject({
      token: `0x${'a'.repeat(40)}`,
      fromBlock: 100_000,
      toBlock: 1_099_999,
      segmentSize: 1_000_000,
      maxTransfers: 25_000,
      maxCandidatesPerSegment: 512,
      providerAllowedHosts: ['bsc-a.example', 'bsc-b.example'],
      sqdAllowedHosts: ['portal.example'],
    });
    expect(JSON.stringify({ ...config, postgresUrl: '[REDACTED]' })).not.toContain('private');
  });

  it('rejects write-like arguments and oversized ranges', () => {
    expect(() => loadBurnPromotionWorkerConfig(env, [...args, '--private-key', 'secret'])).toThrow(
      'Unknown burn promotion argument',
    );
    expect(() =>
      loadBurnPromotionWorkerConfig(env, [
        '--token',
        args[1] ?? '',
        '--from',
        '0',
        '--to',
        '5000000',
      ]),
    ).toThrow('Requested range exceeds 5000000 blocks');
    expect(() =>
      loadBurnPromotionWorkerConfig(env, [...args, '--max-candidates-per-segment', '2001']),
    ).toThrow('--max-candidates-per-segment must be between 1 and 2000');
  });

  it('requires durable storage and safe provider URLs', () => {
    expect(() => loadBurnPromotionWorkerConfig({ ...env, POSTGRES_URL: '' }, args)).toThrow(
      'POSTGRES_URL is required',
    );
    expect(() =>
      loadBurnPromotionWorkerConfig({ ...env, SQD_PORTAL_URL: 'http://portal.example' }, args),
    ).toThrow('must use HTTPS');
  });
});
