import { ProviderError, toProviderError } from './errors.js';
import { assertProviderUrlSafe, type ProviderUrlPolicy } from './security.js';
import { canonicalJson } from '@zerotrace/evidence';

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
  cacheBypasses: number;
  failovers: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

export interface TransportReadOptions {
  cacheMode?: 'default' | 'bypass';
  /** Abort the individual read without disabling the transport for other callers. */
  signal?: AbortSignal;
}

export interface TransportObservation<T> {
  value: T;
  endpointId: string;
  /** All independently successful endpoint IDs that contributed to this value. */
  sourceIds?: readonly string[];
}

export interface JsonRpcTransport {
  readonly endpointId: string;
  readonly lastEndpointId?: string | undefined;
  /** Present when the transport performed an explicit multi-source comparison. */
  readonly sourceIds?: readonly string[] | undefined;
  request<T>(
    method: string,
    params?: readonly unknown[],
    options?: TransportReadOptions,
  ): Promise<T>;
  requestSourced<T>(
    method: string,
    params?: readonly unknown[],
    options?: TransportReadOptions,
  ): Promise<TransportObservation<T>>;
  diagnostics?(): TransportDiagnostics;
}

export interface RestTransport {
  readonly endpointId: string;
  readonly lastEndpointId?: string | undefined;
  getText(path: string, options?: TransportReadOptions): Promise<string>;
  getTextSourced(
    path: string,
    options?: TransportReadOptions,
  ): Promise<TransportObservation<string>>;
  getJson<T>(path: string, options?: TransportReadOptions): Promise<T>;
  getJsonSourced<T>(path: string, options?: TransportReadOptions): Promise<TransportObservation<T>>;
  diagnostics?(): TransportDiagnostics;
}

export async function requestJsonRpcSourced<T>(
  transport: JsonRpcTransport,
  method: string,
  params: readonly unknown[] = [],
  options: TransportReadOptions = {},
): Promise<TransportObservation<T>> {
  return transport.requestSourced<T>(method, params, options);
}

export async function getRestTextSourced(
  transport: RestTransport,
  path: string,
  options: TransportReadOptions = {},
): Promise<TransportObservation<string>> {
  return transport.getTextSourced(path, options);
}

export async function getRestJsonSourced<T>(
  transport: RestTransport,
  path: string,
  options: TransportReadOptions = {},
): Promise<TransportObservation<T>> {
  return transport.getJsonSourced<T>(path, options);
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new ProviderError('TIMEOUT', 'Provider request was aborted.', {
    retryable: false,
    cause: signal.reason,
  });
}

async function waitWithSignal(
  operation: Promise<void>,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (signal === undefined) {
    await operation;
    return;
  }
  throwIfAborted(signal);
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(
        new ProviderError('TIMEOUT', 'Provider request was aborted.', {
          retryable: false,
          cause: signal.reason,
        }),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    await Promise.race([operation, aborted]);
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort);
  }
}

async function raceWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return operation;
  throwIfAborted(signal);
  let abort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abort = () => {
      reject(
        new ProviderError('TIMEOUT', 'Provider request was aborted.', {
          retryable: false,
          cause: signal.reason,
        }),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort);
  }
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

export function parseProviderJson(body: string): unknown {
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
  signal?: AbortSignal,
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
  const abort = () => controller.abort(signal?.reason);
  if (signal !== undefined) {
    throwIfAborted(signal);
    signal.addEventListener('abort', abort, { once: true });
  }
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
    throwIfAborted(signal);
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
    if (signal !== undefined) signal.removeEventListener('abort', abort);
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
  #cacheBypasses = 0;
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

  async execute<T>(
    cacheKey: string,
    operation: () => Promise<T>,
    options: TransportReadOptions = {},
  ): Promise<T> {
    throwIfAborted(options.signal);
    this.#logicalRequests += 1;
    const bypassCache = options.cacheMode === 'bypass';
    if (bypassCache) {
      this.#cacheBypasses += 1;
    } else {
      const cached = this.#readCache<T>(cacheKey);
      if (cached.found) return cached.value;
    }

    const inFlightKey = `${bypassCache ? 'bypass' : 'default'}:${cacheKey}`;
    const existing = this.#inFlight.get(inFlightKey);
    if (existing !== undefined) {
      this.#cacheHits += 1;
      return raceWithSignal(existing as Promise<T>, options.signal);
    }

    const promise = this.#run(operation, options.signal).then((value) => {
      if (!bypassCache) this.#writeCache(cacheKey, value);
      return value;
    });
    this.#inFlight.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      this.#inFlight.delete(inFlightKey);
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
      cacheBypasses: this.#cacheBypasses,
      failovers: 0,
      lastAttemptAt: isoTimestamp(this.#lastAttemptAt),
      lastSuccessAt: isoTimestamp(this.#lastSuccessAt),
      lastFailureAt: isoTimestamp(this.#lastFailureAt),
    };
  }

  async #run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    let halfOpenAttempt: boolean;
    try {
      halfOpenAttempt = this.#enterCircuit();
    } catch (error) {
      this.#failures += 1;
      this.#lastFailureAt = this.#now();
      throw error;
    }

    for (let attempt = 1; attempt <= this.#options.maxAttempts; attempt += 1) {
      throwIfAborted(signal);
      await this.#reserveRateLimitSlot(signal);
      this.#attempts += 1;
      this.#lastAttemptAt = this.#now();
      try {
        const result = await operation();
        throwIfAborted(signal);
        this.#successes += 1;
        this.#lastSuccessAt = this.#now();
        this.#consecutiveFailures = 0;
        this.#circuitOpenUntil = null;
        this.#halfOpenInFlight = false;
        return result;
      } catch (error) {
        const providerError = toProviderError(error);
        this.#lastFailureAt = this.#now();
        if (signal?.aborted === true) {
          throw new ProviderError('TIMEOUT', 'Provider request was aborted.', {
            retryable: false,
            cause: providerError,
          });
        }
        if (providerError.retryable && attempt < this.#options.maxAttempts) {
          this.#retries += 1;
          await waitWithSignal(
            this.#sleep(this.#retryDelay(attempt, providerError.retryAfterMs)),
            signal,
          );
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

  async #reserveRateLimitSlot(signal?: AbortSignal): Promise<void> {
    if (this.#options.requestsPerSecond === 0) return;
    const interval = 1_000 / this.#options.requestsPerSecond;
    const now = this.#now();
    const reservedAt = Math.max(now, this.#nextRequestAt);
    this.#nextRequestAt = reservedAt + interval;
    const delay = Math.ceil(reservedAt - now);
    if (delay > 0) {
      this.#rateLimitDelays += 1;
      await waitWithSignal(this.#sleep(delay), signal);
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

  async request<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<T> {
    return (await this.requestSourced<T>(method, params, options)).value;
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    const value = await this.#executor.execute(
      rpcCacheKey(method, params),
      async () => {
        const id = ++this.#requestId;
        const body = await fetchSafely(
          this.#options,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          },
          undefined,
          options.signal,
        );
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
          throw new ProviderError(
            'INVALID_RESPONSE',
            'Provider response is missing a result field.',
          );
        }
        return response.result as T;
      },
      options,
    );
    return { value, endpointId: this.endpointId };
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

  async getText(path: string, options: TransportReadOptions = {}): Promise<string> {
    return (await this.getTextSourced(path, options)).value;
  }

  async getTextSourced(
    path: string,
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<string>> {
    const value = await this.#executor.execute(
      `rest:text:${path}`,
      () => fetchSafely(this.#options, { method: 'GET' }, path, options.signal),
      options,
    );
    return { value, endpointId: this.endpointId };
  }

  async getJson<T>(path: string, options: TransportReadOptions = {}): Promise<T> {
    return (await this.getJsonSourced<T>(path, options)).value;
  }

  async getJsonSourced<T>(
    path: string,
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    const observation = await this.getTextSourced(path, options);
    try {
      return {
        value: parseProviderJson(observation.value) as T,
        endpointId: observation.endpointId,
      };
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
    cacheBypasses: sum('cacheBypasses'),
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

  async request<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<T> {
    return (await this.requestSourced<T>(method, params, options)).value;
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    this.#logicalRequests += 1;
    let lastError: ProviderError | undefined;
    for (let offset = 0; offset < this.#transports.length; offset += 1) {
      const index = (this.#preferredIndex + offset) % this.#transports.length;
      const transport = this.#transports[index];
      if (transport === undefined) continue;
      try {
        const result = await requestJsonRpcSourced<T>(transport, method, params, options);
        this.#preferredIndex = index;
        this.#lastEndpointId = result.endpointId;
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

/**
 * Reads the same JSON-RPC request from every configured endpoint and only returns a value when
 * every endpoint succeeds with the same canonical JSON payload. This is intentionally separate
 * from FailoverJsonRpcTransport: failover provides availability, while quorum provides evidence
 * that independent providers agreed. A partial response or disagreement is therefore a hard
 * failure and must not be silently converted into a successful observation.
 */
export class QuorumJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId: string;
  readonly #transports: readonly JsonRpcTransport[];
  readonly #sourceIds: readonly string[];
  #lastEndpointId: string | undefined;
  #logicalRequests = 0;
  #successes = 0;
  #failures = 0;

  constructor(endpointId: string, transports: readonly JsonRpcTransport[]) {
    if (transports.length < 2) {
      throw new RangeError('Quorum transport requires at least two endpoints.');
    }
    const sourceIds = transports.map((transport) => transport.endpointId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      throw new RangeError('Quorum transport endpoints must have unique endpoint IDs.');
    }
    this.endpointId = endpointId;
    this.#transports = transports;
    this.#sourceIds = Object.freeze([...sourceIds]);
  }

  get sourceIds(): readonly string[] {
    return this.#sourceIds;
  }

  get lastEndpointId(): string | undefined {
    return this.#lastEndpointId;
  }

  async request<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<T> {
    return (await this.requestSourced<T>(method, params, options)).value;
  }

  async requestSourced<T>(
    method: string,
    params: readonly unknown[] = [],
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    this.#logicalRequests += 1;
    const results = await Promise.allSettled(
      this.#transports.map((transport) =>
        requestJsonRpcSourced<T>(transport, method, params, options),
      ),
    );
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    if (failures.length > 0) {
      this.#failures += 1;
      const providerError = toProviderError(failures[0]?.reason);
      throw new ProviderError(providerError.code, 'Independent JSON-RPC quorum is incomplete.', {
        retryable: providerError.retryable,
        cause: providerError,
      });
    }
    const observations = results.map(
      (result) => (result as PromiseFulfilledResult<TransportObservation<T>>).value,
    );
    const first = observations[0];
    if (first === undefined) {
      this.#failures += 1;
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Independent JSON-RPC quorum returned no values.',
      );
    }
    const expected = canonicalJson(first.value);
    const disagreement = observations.some(
      (observation) => canonicalJson(observation.value) !== expected,
    );
    if (disagreement) {
      this.#failures += 1;
      throw new ProviderError(
        'INVALID_RESPONSE',
        'Independent JSON-RPC providers returned different observations.',
      );
    }
    this.#successes += 1;
    this.#lastEndpointId = first.endpointId;
    return { value: first.value, endpointId: first.endpointId, sourceIds: this.#sourceIds };
  }

  diagnostics(): TransportDiagnostics {
    return failoverDiagnostics(
      this.endpointId,
      this.#lastEndpointId,
      0,
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

  async getText(path: string, options: TransportReadOptions = {}): Promise<string> {
    return (await this.getTextSourced(path, options)).value;
  }

  getTextSourced(
    path: string,
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<string>> {
    return this.#request((transport) => getRestTextSourced(transport, path, options));
  }

  async getJson<T>(path: string, options: TransportReadOptions = {}): Promise<T> {
    return (await this.getJsonSourced<T>(path, options)).value;
  }

  getJsonSourced<T>(
    path: string,
    options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    return this.#request((transport) => getRestJsonSourced<T>(transport, path, options));
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

  async #request<T>(
    operation: (transport: RestTransport) => Promise<TransportObservation<T>>,
  ): Promise<TransportObservation<T>> {
    this.#logicalRequests += 1;
    let lastError: ProviderError | undefined;
    for (let offset = 0; offset < this.#transports.length; offset += 1) {
      const index = (this.#preferredIndex + offset) % this.#transports.length;
      const transport = this.#transports[index];
      if (transport === undefined) continue;
      try {
        const result = await operation(transport);
        this.#preferredIndex = index;
        this.#lastEndpointId = result.endpointId;
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
