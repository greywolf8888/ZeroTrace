import { describe, expect, it } from 'vitest';

import { aimdOnSuccess, aimdOnThrottle, coalesceKey, createAimd, TokenBucket } from './index.js';

describe('provider scheduler control plane', () => {
  it('applies AIMD multiplicative decrease on 429', () => {
    let state = { ...createAimd(), concurrency: 8 };
    state = aimdOnThrottle(state);
    expect(state.concurrency).toBe(4);
    state = aimdOnSuccess(state);
    expect(state.concurrency).toBe(5);
  });

  it('refills the token bucket over time', () => {
    const bucket = new TokenBucket(2, 1, 0);
    expect(bucket.tryTake(0, 2)).toBe(true);
    expect(bucket.tryTake(0, 1)).toBe(false);
    expect(bucket.tryTake(1000, 1)).toBe(true);
  });

  it('coalesces identical historical reads', () => {
    const left = coalesceKey({
      chain: 'eip155:56',
      blockHash: '0xabc',
      method: 'eth_getLogs',
      canonicalParams: '[]',
      adapterVersion: 'evm-v1',
    });
    const right = coalesceKey({
      chain: 'eip155:56',
      blockHash: '0xabc',
      method: 'eth_getLogs',
      canonicalParams: '[]',
      adapterVersion: 'evm-v1',
    });
    expect(left).toBe(right);
  });
});
