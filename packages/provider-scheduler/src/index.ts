export interface AimdState {
  concurrency: number;
  min: number;
  max: number;
  additive: number;
  multiplicative: number;
}

export function createAimd(): AimdState {
  return { concurrency: 1, min: 1, max: 32, additive: 1, multiplicative: 0.5 };
}

export function aimdOnSuccess(state: AimdState): AimdState {
  return { ...state, concurrency: Math.min(state.max, state.concurrency + state.additive) };
}

export function aimdOnThrottle(state: AimdState): AimdState {
  return {
    ...state,
    concurrency: Math.max(state.min, Math.floor(state.concurrency * state.multiplicative)),
  };
}

export class TokenBucket {
  tokens: number;
  constructor(
    readonly capacity: number,
    readonly refillPerSec: number,
    private lastMs = 0,
  ) {
    this.tokens = capacity;
  }

  tryTake(nowMs: number, cost: number): boolean {
    const elapsed = Math.max(0, nowMs - this.lastMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastMs = nowMs;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

export function coalesceKey(input: {
  chain: string;
  blockHash: string;
  method: string;
  canonicalParams: string;
  adapterVersion: string;
}): string {
  return JSON.stringify({
    adapterVersion: input.adapterVersion,
    blockHash: input.blockHash,
    canonicalParams: input.canonicalParams,
    chain: input.chain,
    method: input.method,
  });
}
