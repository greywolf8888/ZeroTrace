export interface AimdState {
  concurrency: number;
  min: number;
  max: number;
  additive: number;
  multiplicative: number;
}

export function createAimd(options?: { max?: number }): AimdState {
  return { concurrency: 1, min: 1, max: options?.max ?? 32, additive: 1, multiplicative: 0.5 };
}

export function createLowCostAimd(): AimdState {
  return createAimd({ max: 1 });
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

  refill(nowMs: number): void {
    const elapsed = Math.max(0, nowMs - this.lastMs) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastMs = nowMs;
  }

  canTake(nowMs: number, cost: number): boolean {
    this.refill(nowMs);
    return this.tokens >= cost;
  }

  tryTake(nowMs: number, cost: number): boolean {
    if (!this.canTake(nowMs, cost)) return false;
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

export type BudgetLayer = 'operator' | 'provider' | 'method' | 'chain' | 'tenant' | 'job';

export interface LayeredBudgetKey {
  operator: string;
  provider: string;
  method: string;
  chain: string;
  tenant: string;
  job: string;
}

export const UNKNOWN_PUBLIC_START_RPS = 4;

export class HierarchicalBudget {
  readonly buckets = new Map<string, TokenBucket>();

  constructor(
    readonly startRps = UNKNOWN_PUBLIC_START_RPS,
    readonly burstMultiplier = 2,
  ) {}

  layerKey(layer: BudgetLayer, value: string): string {
    return `${layer}:${value}`;
  }

  tryTake(key: LayeredBudgetKey, nowMs: number, cost: number): boolean {
    const layers: Array<[BudgetLayer, string]> = [
      ['operator', key.operator],
      ['provider', key.provider],
      ['method', key.method],
      ['chain', key.chain],
      ['tenant', key.tenant],
      ['job', key.job],
    ];
    const selected: TokenBucket[] = [];
    for (const [layer, value] of layers) {
      const id = this.layerKey(layer, value);
      const bucket =
        this.buckets.get(id) ??
        new TokenBucket(this.startRps * this.burstMultiplier, this.startRps);
      this.buckets.set(id, bucket);
      selected.push(bucket);
    }
    if (selected.some((bucket) => !bucket.canTake(nowMs, cost))) return false;
    return selected.every((bucket) => bucket.tryTake(nowMs, cost));
  }
}

export class Ewma {
  value: number | undefined;
  constructor(readonly alpha = 0.2) {}

  observe(sample: number): number {
    this.value =
      this.value === undefined ? sample : this.alpha * sample + (1 - this.alpha) * this.value;
    return this.value;
  }
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  failures = 0;
  state: CircuitState = 'closed';
  openedAtMs = 0;

  constructor(
    readonly failureThreshold = 5,
    readonly resetMs = 30_000,
  ) {}

  allow(nowMs: number): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open' && nowMs - this.openedAtMs >= this.resetMs) {
      this.state = 'half-open';
      return true;
    }
    return this.state === 'half-open';
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  onFailure(nowMs: number): void {
    this.failures += 1;
    if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
      this.state = 'open';
      this.openedAtMs = nowMs;
    }
  }
}

export function parseRetryAfterMs(
  header: string | null | undefined,
  nowMs: number,
): number | undefined {
  if (header === undefined || header === null || header.trim() === '') return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(60_000, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.min(60_000, Math.max(0, date - nowMs));
}

export interface SchedulerAdmission {
  admitted: boolean;
  coalesced: boolean;
  retryAfterMs?: number;
  reason?: string;
}

export class ProviderBudgetManager {
  readonly hierarchical: HierarchicalBudget;
  readonly circuits = new Map<string, CircuitBreaker>();
  readonly latency = new Map<string, Ewma>();
  readonly errors = new Map<string, Ewma>();
  readonly coalesced = new Map<string, number>();
  readonly aimd = new Map<string, AimdState>();
  inFlight = new Map<string, number>();
  budgetRemaining: number;
  readonly verificationReserveRatio: number;

  readonly aimdFactory: () => AimdState;

  constructor(
    budget = 10_000,
    startRps = UNKNOWN_PUBLIC_START_RPS,
    verificationReserveRatio = 0.2,
    aimdFactory: () => AimdState = createAimd,
  ) {
    this.hierarchical = new HierarchicalBudget(startRps);
    this.budgetRemaining = budget;
    this.verificationReserveRatio = verificationReserveRatio;
    this.aimdFactory = aimdFactory;
  }

  circuit(providerId: string): CircuitBreaker {
    const existing = this.circuits.get(providerId);
    if (existing !== undefined) return existing;
    const created = new CircuitBreaker();
    this.circuits.set(providerId, created);
    return created;
  }

  admit(input: {
    nowMs: number;
    key: LayeredBudgetKey;
    coalesce: string;
    cost: number;
    verification: boolean;
    retryAfterMs?: number;
  }): SchedulerAdmission {
    if (this.coalesced.has(input.coalesce)) {
      return { admitted: false, coalesced: true, reason: 'COALESCED' };
    }
    if (input.retryAfterMs !== undefined && input.retryAfterMs > 0) {
      return {
        admitted: false,
        coalesced: false,
        retryAfterMs: input.retryAfterMs,
        reason: 'RETRY_AFTER',
      };
    }
    if (!this.circuit(input.key.provider).allow(input.nowMs)) {
      return { admitted: false, coalesced: false, reason: 'CIRCUIT_OPEN' };
    }
    const aimd = this.aimd.get(input.key.provider) ?? this.aimdFactory();
    this.aimd.set(input.key.provider, aimd);
    const flying = this.inFlight.get(input.key.provider) ?? 0;
    if (flying >= aimd.concurrency) {
      return { admitted: false, coalesced: false, reason: 'CONCURRENCY' };
    }
    if (input.verification) {
      const reserve = this.budgetRemaining * this.verificationReserveRatio;
      if (input.cost > this.budgetRemaining - reserve && reserve > 0) {
        return { admitted: false, coalesced: false, reason: 'VERIFICATION_RESERVE' };
      }
    }
    if (input.cost > this.budgetRemaining) {
      return { admitted: false, coalesced: false, reason: 'BUDGET' };
    }
    if (!this.hierarchical.tryTake(input.key, input.nowMs, input.cost)) {
      return { admitted: false, coalesced: false, reason: 'RATE_LIMIT' };
    }
    this.budgetRemaining -= input.cost;
    this.inFlight.set(input.key.provider, flying + 1);
    this.coalesced.set(input.coalesce, input.nowMs);
    return { admitted: true, coalesced: false };
  }

  complete(providerId: string, latencyMs: number, outcome: 'ok' | 'throttle' | 'error'): void {
    const flying = this.inFlight.get(providerId) ?? 0;
    this.inFlight.set(providerId, Math.max(0, flying - 1));
    const latency = this.latency.get(providerId) ?? new Ewma();
    latency.observe(latencyMs);
    this.latency.set(providerId, latency);
    const errors = this.errors.get(providerId) ?? new Ewma();
    errors.observe(outcome === 'ok' ? 0 : 1);
    this.errors.set(providerId, errors);
    const aimd = this.aimd.get(providerId) ?? this.aimdFactory();
    this.aimd.set(providerId, outcome === 'ok' ? aimdOnSuccess(aimd) : aimdOnThrottle(aimd));
    const breaker = this.circuit(providerId);
    if (outcome === 'ok') breaker.onSuccess();
    else breaker.onFailure(Date.now());
  }
}
