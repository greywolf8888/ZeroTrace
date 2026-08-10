import { describe, expect, it } from 'vitest';

import { loadFlapLifetimeHeadWorkerConfig } from './lifetime-head-config.js';

const token = `0x${'a'.repeat(40)}`;
const env = {
  EVM_BSC_RPC_URLS: 'https://bsc-a.example,https://bsc-b.example',
  SQD_PORTAL_URL: 'https://portal.sqd.dev',
  POSTGRES_URL: 'postgresql://zerotrace:test@postgres.example/zerotrace',
};

describe('continuous Flap lifetime head config', () => {
  it('loads an unpinned multi-source loop with bounded test cycles', () => {
    const config = loadFlapLifetimeHeadWorkerConfig(env, [
      '--token',
      token,
      '--interval-ms',
      '2500',
      '--max-cycles',
      '3',
    ]);
    expect(config).toMatchObject({
      token,
      bscRpcUrls: ['https://bsc-a.example', 'https://bsc-b.example'],
      requiredSources: 2,
      intervalMs: 2500,
      maxCycles: 3,
    });
    expect(config.targetBlock).toBeUndefined();
  });

  it('rejects pinned targets and fewer RPC URLs than the Evidence quorum', () => {
    expect(() =>
      loadFlapLifetimeHeadWorkerConfig({ ...env, FLAP_LIFETIME_TARGET_BLOCK: '100' }, [
        '--token',
        token,
      ]),
    ).toThrow('may not pin');
    expect(() =>
      loadFlapLifetimeHeadWorkerConfig(
        { ...env, EVM_BSC_RPC_URLS: 'https://bsc-a.example', DATA_QUALITY_MIN_SOURCES: '2' },
        ['--token', token],
      ),
    ).toThrow('enough distinct BSC RPC URLs');
  });
});
