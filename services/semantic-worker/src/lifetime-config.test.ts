import { describe, expect, it } from 'vitest';

import { loadFlapLifetimeWorkerConfig } from './lifetime-config.js';

const token = `0x${'a'.repeat(40)}`;
const env = {
  EVM_BSC_RPC_URLS: 'https://bsc-a.example,https://bsc-b.example',
  SQD_PORTAL_URL: 'https://portal.example',
  POSTGRES_URL: 'postgresql://zerotrace:private@postgres.example/zerotrace',
};

describe('Flap lifetime worker configuration', () => {
  it('loads safe defaults while leaving the finalized target discoverable at runtime', () => {
    expect(loadFlapLifetimeWorkerConfig(env, ['--token', token])).toMatchObject({
      token,
      originChunkSize: 1_000_000,
      historySegmentSize: 5_000,
      historyChunkSize: 2_000,
      historyMaxTransactions: 250,
      historyMaxLogs: 25_000,
      sqdCreationRequestRangeBlocks: 10_000,
      bscRpcUrls: ['https://bsc-a.example', 'https://bsc-b.example'],
      sqdPortalUrl: 'https://portal.example',
      postgresUrl: env.POSTGRES_URL,
    });
    expect(loadFlapLifetimeWorkerConfig(env, ['--token', token])).not.toHaveProperty('targetBlock');
  });

  it('accepts a pinned target and independent origin/history bounds', () => {
    expect(
      loadFlapLifetimeWorkerConfig(env, [
        '--token',
        token.toUpperCase().replace('0X', '0x'),
        '--target',
        '50000000',
        '--origin-hint-block',
        '112625803',
        '--origin-chunk-size',
        '500000',
        '--history-segment-size',
        '25000',
        '--history-chunk-size',
        '1000',
        '--history-max-transactions',
        '100',
        '--history-max-logs',
        '5000',
        '--sqd-creation-request-range-size',
        '100000',
      ]),
    ).toMatchObject({
      token,
      targetBlock: 50_000_000,
      originHintBlock: 112_625_803,
      originChunkSize: 500_000,
      historySegmentSize: 25_000,
      historyChunkSize: 1_000,
      historyMaxTransactions: 100,
      historyMaxLogs: 5_000,
      sqdCreationRequestRangeBlocks: 100_000,
    });
  });

  it('rejects unsafe or ambiguous inputs before any provider access', () => {
    expect(() => loadFlapLifetimeWorkerConfig(env, [])).toThrow('--token is required.');
    expect(() => loadFlapLifetimeWorkerConfig(env, ['--token', token, '--target', '-1'])).toThrow(
      '--target must be an unsigned integer.',
    );
    expect(() =>
      loadFlapLifetimeWorkerConfig(env, ['--token', token, '--history-segment-size', '50001']),
    ).toThrow('--history-segment-size must be between 1 and 50000.');
    expect(() =>
      loadFlapLifetimeWorkerConfig(env, ['--token', token, '--private-key', 'forbidden']),
    ).toThrow('Unknown Flap lifetime argument: --private-key');
    expect(() =>
      loadFlapLifetimeWorkerConfig(env, ['--token', token, '--origin-hint-block', '-1']),
    ).toThrow('--origin-hint-block must be an unsigned integer.');
  });
});
