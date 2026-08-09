import { ProviderError, toProviderError } from './errors.js';
import { assertProviderUrlSafe, type ProviderUrlPolicy } from './security.js';

export type FetchImplementation = typeof fetch;

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface TransportDiagnostics {
  endpointId: string;
  activeEndpointId?: string;
  circuitState: CircuitState;
  circuitOpenUntil: string | null;
  logicalRequests: number;
  attempts: number;
  successes: number;
  failures: number;
  retries: number;
  rateLimitDelays: number;
  cacheHits: number;
  cacheMisses: number;
  failovers: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface JsonRpcTransport {
  readonly endpointId: string;
  readonly lastEndpointId?: string | undefined;
  request<T>(method: string, params?: readonly unknown[]): Promise<T>;
  diagnostics?(): TransportDiagnostics;
}

export interface RestTransport {
  readonly endpointId: string;
  readonly lastEndpointId?: string | undefined;
  getText(path: string): Promise<string>;
  getJson<T>(path: string): Promise<T>;
  diagnostics?(): TransportDiagnostics;
}

export interface TransportResilienceOptions {
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  retryJitterRatio?: number;
  requestsPerSecond?: number;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
}

export interface TransportOptions {
  endpointId: string;
  baseUrl: string;
  policy: ProviderUrlPolicy;
  timeoutMs: number;
  maxResponseBytes?: number;
  resilience?: TransportResilienceOptions;
  fetchImplementation?: FetchImplementation;
  nowImplementation?: () => number;
  sleepImplementation?: (milliseconds: number) => Promise<void>;
  randomImplementation?: () => number;
}

interface ResolvedResilienceOptions {
  maxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryJitterRatio: number;
  requestsPerSecond: number;
  circuitFailureThreshold: number;
  circuitResetMs: number;
  cacheTtlMs: number;
  cacheMaxEntries: number;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const DEFAULT_RESILIENCE: ResolvedResilienceOptions = {
  maxAttempts: 3,
  retryBaseDelayMs: 100,
  retryMaxDelayMs: 2_000,
  retryJitterRatio: 0.2,
  requestsPerSecond: 0,
  circuitFailureThreshold: 5,
  circuitResetMs: 30_000,
  cacheTtlMs: 0,
  cacheMaxEntries: 500,
};

function requireInteger(value: number, field: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function resolveResilience(
  options: TransportResilienceOptions | undefined,
): ResolvedResilienceOptions {
  const resolved = { ...DEFAULT_RESILIENCE, ...options };
  requireInteger(resolved.maxAttempts, 'maxAttempts', 1, 10);
  requireInteger(resolved.retryBaseDelayMs, 'retryBaseDelayMs', 0, 60_000);
  requireInteger(resolved.retryMaxDelayMs, 'retryMaxDelayMs', 0, 300_000);
  if (
    !Number.isFinite(resolved.retryJitterRatio) ||
    resolved.retryJitterRatio < 0 ||
    resolved.retryJitterRatio > 1
  ) {
    throw new RangeError('retryJitterRatio must be between 0 and 1.');
  }
  if (
    !Number.isFinite(resolved.requestsPerSecond) ||
    resolved.requestsPerSecond < 0 ||
    resolved.requestsPerSecond > 10_000
  ) {
    throw new RangeError('requestsPerSecond must be between 0 and 10000.');
  }
  requireInteger(resolved.circuitFailureThreshold, 'circuitFailureThreshold', 1, 1_000);
  requireInteger(resolved.circuitResetMs, 'circuitResetMs', 1, 3_600_000);
  requireInteger(resolved.cacheTtlMs, 'cacheTtlMs', 0, 3_600_000);
  requireInteger(resolved.cacheMaxEntries, 'cacheMaxEntries', 1, 100_000);
  if (resolved.retryBaseDelayMs > resolved.retryMaxDelayMs) {
    throw new RangeError('retryBaseDelayMs may not exceed retryMaxDelayMs.');
  }
  return resolved;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isoTimestamp(milliseconds: number | null): string | null {
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

function parseRetryAfter(response: Response, now: number): number | undefined {
  const value = response.headers.get('retry-after')?.trim();
  if (value === undefined || value === '') return undefined;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.max(0, Math.ceil(Number(value) * 1_000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

function parseProviderJson(body: string): unknown {
  type ReviverContext = { source?: string };
  const reviver = (_key: string, value: unknown, context?: ReviverContext): unknown => {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (context?.source !== undefined && /^-?\d+$/.test(context.source)) return context.source;
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Provider returned an integer that cannot be represented safely.',
      );
    }
    return value;
  };
  return JSON.parse(body, reviver as (key: string, value: unknown) => unknown) as unknown;
}

async function fetchSafely(
  options: TransportOptions,
  init: RequestInit,
  relativePath = '',
): Promise<string> {
  const base = await assertProviderUrlSafe(options.baseUrl, options.policy);
  if (relativePath !== '' && (!relativePath.startsWith('/') || relativePath.includes('..'))) {
    throw new ProviderError(
      'INVALID_PROVIDER_URL',
      'Provider REST path must be absolute and may not traverse directories.',
    );
  }
  const url = new URL(
    relativePath === '' ? base.toString() : `${base.toString().replace(/\/$/, '')}${relativePath}`,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await (options.fetchImplementation ?? fetch)(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json', ...init.headers },
    });
    if (response.status >= 300 && response.status < 400) {
      throw new ProviderError(
        'REDIRECT_BLOCKED',
        'Provider redirects are blocked to prevent SSRF bypass.',
      );
    }
    const retryAfterMs = parseRetryAfter(response, (options.nowImplementation ?? Date.now)());
    if (response.status === 429) {
      throw new ProviderError('RATE_LIMITED', 'Provider rate limit exceeded.', {
        retryable: true,
        statusCode: response.status,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    if (!response.ok) {
      throw new ProviderError('HTTP_ERROR', `Provider returned HTTP ${response.status}.`, {
        retryable: response.status >= 500,
        statusCode: response.status,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      });
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0);
    const maxBytes = options.maxResponseBytes ?? 5_000_000;
    if (declaredLength > maxBytes) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Provider response exceeds the configured size limit.',
      );
    }
    const body = await response.text();
    if (Buffer.byteLength(body) > maxBytes) {
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Provider response exceeds the configured size limit.',
      );
    }
    return body;
  } catch (error) {
    throw toProviderError(error);
  } finally {
    clearTimeout(timeout);
  }
}

class ResilientExecutor {
  readonly #endpointId: string;
  readonly #options: ResolvedResilienceOptions;
  readonly #now: () => number;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #random: () => number;
  readonly #cache = new Map<string, CacheEntry>();
  readonly #inFlight = new Map<string, Promise<unknown>>();
  #nextRequestAt = 0;
  #consecutiveFailures = 0;
  #circuitOpenUntil: number | null = null;
  #halfOpenInFlight = false;
  #logicalRequests = 0;
  #attempts = 0;
  #successes = 0;
  #failures = 0;
  #retries = 0;
  #rateLimitDelays = 0;
  #cacheHits = 0;
  #cacheMisses = 0;
  #lastAttemptAt: number | null = null;
  #lastSuccessAt: number | null = null;
  #lastFailureAt: number | null = null;

  constructor(options: TransportOptions) {
    this.#endpointId = options.endpointId;
    this.#options = resolveResilience(options.resilience);
    this.#now = options.nowImplementation ?? Date.now;
    this.#sleep = options.sleepImplementation ?? defaultSleep;
    this.#random = options.randomImplementation ?? Math.random;
  }

  async execute<T>(cacheKey: string, operation: () => Promise<T>): Promise<T> {
    this.#logicalRequests += 1;
    const cached = this.#readCache<T>(cacheKey);
    if (cached.found) return cached.value;

    const existing = this.#inFlight.get(cacheKey);
    if (existing !== undefined) {
      this.#cacheHits += 1;
      return existing as Promise<T>;
    }

    const promise = this.#run(operation).then((value) => {
      this.#writeCache(cacheKey, value);
      return value;
    });
    this.#inFlight.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.#inFlight.delete(cacheKey);
    }
  }

  diagnostics(): TransportDiagnostics {
    return {
      endpointId: this.#endpointId,
      circuitState: this.#circuitState(),
      circuitOpenUntil: isoTimestamp(this.#circuitOpenUntil),
      logicalRequests: this.#logicalRequests,
      attempts: this.#attempts,
      successes: this.#successes,
      failures: this.#failures,
      retries: this.#retries,
      rateLimitDelays: this.#rateLimitDelays,
      cacheHits: this.#cacheHits,
      cacheMisses: this.#cacheMisses,
      failovers: 0,
      lastAttemptAt: isoTimestamp(this.#lastAttemptAt),
      lastSuccessAt: isoTimestamp(this.#lastSuccessAt),
      lastFailureAt: isoTimestamp(this.#lastFailureAt),
    };
  }

  async #run<T>(operation: () => Promise<T>): Promise<T> {
    let halfOpenAttempt: boolean;
    try {
      halfOpenAttempt = this.#enterCircuit();
    } catch (error) {
      this.#failures += 1;
      this.#lastFailureAt = this.#now();
      throw error;
    }

    for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt += 1) {
      await this.#reserveRateLimitSlot();
      this.#attempts += 1;
      this.#lastAttemptAt = this.#now();
      try {
        const result = await operation();
        this.#successes += 1;
        this.#lastSuccessAt = this.#now();
        this.#consecutiveFailures = 0;
        this.#circuitOpenUntil = null;
        this.#halfOpenInFlight = false;
        return result;
      } catch (error) {
        const providerError = toProviderError(error);
        this.#lastFailureAt = this.#now();
        if (providerError.retryable && attempt < this.#options.maxAttempts) {
          this.#retries += 1;
          await this.#sleep(this.#retryDelay(attempt, providerError.retryAfterMs));
          continue;
        }

        this.#failures += 1;
        this.#halfOpenInFlight = false;
        if (providerError.retryable) {
          this.#consecutiveFailures += 1;
          if (
            halfOpenAttempt ||
            this.#consecutiveFailures >= this.#options.circuitFailureThreshold
          ) {
            this.#circuitOpenUntil = this.#now() + this.#options.circuitResetMs;
          }
        }
        throw providerError;
      }
    }
    throw new ProviderError('HTTP_ERROR', 'Provider request exhausted retry attempts.', {
      retryable: true,
    });
  }

  #readCache<T>(key: string): { found: true; value: T } | { found: false } {
    if (this.#options.cacheTtlMs === 0) return { found: false };
    const entry = this.#cache.get(key);
    if (entry === undefined) {
      this.#cacheMisses += 1;
      return { found: false };
    }
    if (entry.expiresAt <= this.#now()) {
      this.#cache.delete(key);
      this.#cacheMisses += 1;
      return { found: false };
    }
    this.#cache.delete(key);
    this.#cache.set(key, entry);
    this.#cacheHits += 1;
    return { found: true, value: entry.value as T };
  }

  #writeCache(key: string, value: unknown): void {
    if (this.#options.cacheTtlMs === 0) return;
    this.#cache.delete(key);
    while (this.#cache.size >= this.#options.cacheMaxEntries) {
      const oldest = this.#cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    this.#cache.set(key, { value, expiresAt: this.#now() + this.#options.cacheTtlMs });
  }

  #enterCircuit(): boolean {
    if (this.#circuitOpenUntil === null) return false;
    const now = this.#now();
    if (now < this.#circuitOpenUntil || this.#halfOpenInFlight) {
      throw new ProviderError('CIRCUIT_OPEN', 'Provider circuit breaker is open.', {
        retryable: true,
        retryAfterMs: Math.max(0, this.#circuitOpenUntil - now),
      });
    }
    this.#halfOpenInFlight = true;
    return true;
  }

  #circuitState(): CircuitState {
    if (this.#circuitOpenUntil === null) return 'CLOSED';
    if (this.#now() < this.#circuitOpenUntil) return 'OPEN';
    return 'HALF_OPEN';
  }

  async #reserveRateLimitSlot(): Promise<void> {
    if (this.#options.requestsPerSecond === 0) return;
    const interval = 1_000 / this.#options.requestsPerSecond;
    const now = this.#now();
    const reservedAt = Math.max(now, this.#nextRequestAt);
    this.#nextRequestAt = reservedAt + interval;
    const delay = Math.ceil(reservedAt - now);
    if (delay > 0) {
      this.#rateLimitDelays += 1;
      await this.#sleep(delay);
    }
  }

  #retryDelay(attempt: number, retryAfterMs: number | undefined): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, this.#options.retryMaxDelayMs);
    const exponential = Math.min(
      this.#options.retryMaxDelayMs,
      this.#options.retryBaseDelayMs * 2 ** (attempt - 1),
    );
    const jitter = exponential * this.#options.retryJitterRatio * this.#random();
    return Math.round(exponential - exponential * this.#options.retryJitterRatio + jitter);
  }
}

function rpcCacheKey(method: string, params: readonly unknown[]): string {
  return `rpc:${method}:${JSON.stringify(params)}`;
}

function isRateLimitRpcError(code: unknown, message: string): boolean {
  return (
    code === 429 ||
    code === -32_005 ||
    /(?:rate.?limit|too many requests|compute units per second|quota)/i.test(message)
  );
}

export class SafeJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId: string;
  readonly #options: TransportOptions;
  readonly #executor: ResilientExecutor;
  #requestId = 0;

  constructor(options: TransportOptions) {
    this.endpointId = options.endpointId;
    this.#options = options;
    this.#executor = new ResilientExecutor(options);
  }

  get lastEndpointId(): string {
    return this.endpointId;
  }

  diagnostics(): TransportDiagnostics {
    return this.#executor.diagnostics();
  }

  request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    return this.#executor.execute(rpcCacheKey(method, params), async () => {
      const id = ++this.#requestId;
      const body = await fetchSafely(this.#options, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
      let parsed: unknown;
      try {
        parsed = parseProviderJson(body);
      } catch (error) {
        throw new ProviderError('INVALID_RESPONSE', 'Provider returned invalid JSON.', {
          cause: error,
        });
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Provider returned a non-object JSON-RPC response.',
        );
      }
      const response = parsed as {
        id?: unknown;
        result?: unknown;
        error?: { code?: unknown; message?: unknown };
      };
      if (response.id !== id) {
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Provider returned an unexpected JSON-RPC request id.',
        );
      }
      if (response.error !== undefined) {
        const message =
          typeof response.error.message === 'string'
            ? response.error.message
            : 'Unknown JSON-RPC error';
        if (isRateLimitRpcError(response.error.code, message)) {
          throw new ProviderError('RATE_LIMITED', 'Provider rate limit exceeded.', {
            retryable: true,
          });
        }
        throw new ProviderError('RPC_ERROR', message, {
          retryable: response.error.code === -32_603,
        });
      }
      if (!('result' in response)) {
        throw new ProviderError('INVALID_RESPONSE', 'Provider response is missing a result field.');
      }
      return response.result as T;
    });
  }
}

export class SafeRestTransport implements RestTransport {
  readonly endpointId: string;
  readonly #options: TransportOptions;
  readonly #executor: ResilientExecutor;

  constructor(options: TransportOptions) {
    this.endpointId = options.endpointId;
    this.#options = options;
    this.#executor = new ResilientExecutor(options);
  }

  get lastEndpointId(): string {
    return this.endpointId;
  }

  diagnostics(): TransportDiagnostics {
    return this.#executor.diagnostics();
  }

  getText(path: string): Promise<string> {
    return this.#executor.execute(`rest:text:${path}`, () =>
      fetchSafely(this.#options, { method: 'GET' }, path),
    );
  }

  async getJson<T>(path: string): Promise<T> {
    const body = await this.getText(path);
    try {
      return parseProviderJson(body) as T;
    } catch (error) {
      throw new ProviderError('INVALID_RESPONSE', 'Provider returned invalid JSON.', {
        cause: error,
      });
    }
  }
}

function failoverDiagnostics(
  endpointId: string,
  activeEndpointId: string | undefined,
  failovers: number,
  transports: readonly (JsonRpcTransport | RestTransport)[],
  logicalRequests: number,
  successes: number,
  failures: number,
): TransportDiagnostics {
  const diagnostics = transports.flatMap((transport) => {
    const value = transport.diagnostics?.();
    return value === undefined ? [] : [value];
  });
  const active = diagnostics.find((item) => item.endpointId === activeEndpointId);
  const circuitState: CircuitState =
    diagnostics.length > 0 && diagnostics.every((item) => item.circuitState === 'OPEN')
      ? 'OPEN'
      : (active?.circuitState ?? 'CLOSED');
  const sum = (field: keyof TransportDiagnostics): number =>
    diagnostics.reduce((total, item) => {
      const value = item[field];
      return total + (typeof value === 'number' ? value : 0);
    }, 0);
  const latest = (field: 'lastAttemptAt' | 'lastSuccessAt' | 'lastFailureAt'): string | null =>
    diagnostics
      .map((item) => item[field])
      .filter((value): value is string => value !== null)
      .sort()
      .at(-1) ?? null;
  const openUntil = diagnostics
    .map((item) => item.circuitOpenUntil)
    .filter((value): value is string => value !== null)
    .sort()
    .at(0);
  return {
    endpointId,
    ...(activeEndpointId === undefined ? {} : { activeEndpointId }),
    circuitState,
    circuitOpenUntil: openUntil ?? null,
    logicalRequests,
    attempts: sum('attempts'),
    successes,
    failures,
    retries: sum('retries'),
    rateLimitDelays: sum('rateLimitDelays'),
    cacheHits: sum('cacheHits'),
    cacheMisses: sum('cacheMisses'),
    failovers,
    lastAttemptAt: latest('lastAttemptAt'),
    lastSuccessAt: latest('lastSuccessAt'),
    lastFailureAt: latest('lastFailureAt'),
  };
}

export class FailoverJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId: string;
  readonly #transports: readonly JsonRpcTransport[];
  #preferredIndex = 0;
  #lastEndpointId: string | undefined;
  #logicalRequests = 0;
  #successes = 0;
  #failures = 0;
  #failovers = 0;

  constructor(endpointId: string, transports: readonly JsonRpcTransport[]) {
    if (transports.length === 0) throw new RangeError('Failover transport requires an endpoint.');
    this.endpointId = endpointId;
    this.#transports = transports;
  }

  get lastEndpointId(): string | undefined {
    return this.#lastEndpointId;
  }

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
    this.#logicalRequests += 1;
    let lastError: ProviderError | undefined;
    for (let offset = 0; offset < this.#transports.length; offset += 1) {
      const index = (this.#preferredIndex + offset) % this.#transports.length;
      const transport = this.#transports[index];
      if (transport === undefined) continue;
      try {
        const result = await transport.request<T>(method, params);
        this.#preferredIndex = index;
        this.#lastEndpointId = transport.lastEndpointId ?? transport.endpointId;
        this.#successes += 1;
        return result;
      } catch (error) {
        const providerError = toProviderError(error);
        lastError = providerError;
        if (!providerError.retryable || offset === this.#transports.length - 1) break;
        this.#failovers += 1;
      }
    }
    this.#failures += 1;
    throw (
      lastError ??
      new ProviderError('HTTP_ERROR', 'All JSON-RPC endpoints failed.', {
        retryable: true,
      })
    );
  }

  diagnostics(): TransportDiagnostics {
    return failoverDiagnostics(
      this.endpointId,
      this.#lastEndpointId,
      this.#failovers,
      this.#transports,
      this.#logicalRequests,
      this.#successes,
      this.#failures,
    );
  }
}

export class FailoverRestTransport implements RestTransport {
  readonly endpointId: string;
  readonly #transports: readonly RestTransport[];
  #preferredIndex = 0;
  #lastEndpointId: string | undefined;
  #logicalRequests = 0;
  #successes = 0;
  #failures = 0;
  #failovers = 0;

  constructor(endpointId: string, transports: readonly RestTransport[]) {
    if (transports.length === 0) throw new RangeError('Failover transport requires an endpoint.');
    this.endpointId = endpointId;
    this.#transports = transports;
  }

  get lastEndpointId(): string | undefined {
    return this.#lastEndpointId;
  }

  getText(path: string): Promise<string> {
    return this.#request((transport) => transport.getText(path));
  }

  getJson<T>(path: string): Promise<T> {
    return this.#request((transport) => transport.getJson<T>(path));
  }

  diagnostics(): TransportDiagnostics {
    return failoverDiagnostics(
      this.endpointId,
      this.#lastEndpointId,
      this.#failovers,
      this.#transports,
      this.#logicalRequests,
      this.#successes,
      this.#failures,
    );
  }

  async #request<T>(operation: (transport: RestTransport) => Promise<T>): Promise<T> {
    this.#logicalRequests += 1;
    let lastError: ProviderError | undefined;
    for (let offset = 0; offset < this.#transports.length; offset += 1) {
      const index = (this.#preferredIndex + offset) % this.#transports.length;
      const transport = this.#transports[index];
      if (transport === undefined) continue;
      try {
        const result = await operation(transport);
        this.#preferredIndex = index;
        this.#lastEndpointId = transport.lastEndpointId ?? transport.endpointId;
        this.#successes += 1;
        return result;
      } catch (error) {
        const providerError = toProviderError(error);
        lastError = providerError;
        if (!providerError.retryable || offset === this.#transports.length - 1) break;
        this.#failovers += 1;
      }
    }
    this.#failures += 1;
    throw (
      lastError ??
      new ProviderError('HTTP_ERROR', 'All REST endpoints failed.', {
        retryable: true,
      })
    );
  }
}
