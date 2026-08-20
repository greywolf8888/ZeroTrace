import { describe, expect, it } from 'vitest';

import {
  aimdOnSuccess,
  aimdOnThrottle,
  coalesceKey,
  createAimd,
  createLowCostAimd,
  HierarchicalBudget,
  parseRetryAfterMs,
  ProviderBudgetManager,
  TokenBucket,
} from './index.js';

describe('provider scheduler control plane', () => {
  it('caps low-cost AIMD at concurrency 1', () => {
    let state = createLowCostAimd();
    for (let index = 0; index < 8; index += 1) state = aimdOnSuccess(state);
    expect(state.concurrency).toBe(1);
    expect(state.max).toBe(1);
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

  it('starts unknown public operators at a conservative 3-5 RPS and layers buckets', () => {
    const budget = new HierarchicalBudget(4, 2);
    const key = {
      operator: 'public-a',
      provider: 'p1',
      method: 'eth_getCode',
      chain: 'eip155:56',
      tenant: 't',
      job: 'j',
    };
    expect(budget.tryTake(key, 0, 8)).toBe(true);
    expect(budget.tryTake(key, 0, 1)).toBe(false);
    expect(budget.startRps).toBe(4);
  });

  it('parses Retry-After and opens a circuit after repeated failures', () => {
    expect(parseRetryAfterMs('2', 0)).toBe(2000);
    const manager = new ProviderBudgetManager();
    for (let index = 0; index < 5; index += 1) {
      manager.circuit('p1').onFailure(1);
    }
    expect(manager.circuit('p1').allow(2)).toBe(false);
    expect(manager.circuit('p1').allow(30_002)).toBe(true);
  });
});
