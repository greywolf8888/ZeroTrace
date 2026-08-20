import {
  coalesceKey,
  createAimd,
  parseRetryAfterMs,
  ProviderBudgetManager,
  UNKNOWN_PUBLIC_START_RPS,
} from '@zerotrace/provider-scheduler';
import { operatorFromEndpoint, type SourceOperator } from '@zerotrace/source-registry';

import { methodClassOf } from './catalog.js';
import type { ProviderRegistry } from './registry.js';
import { ContentAddressedCache, redactSecret, resultHash } from './secrets.js';
import { selectProviders } from './select.js';
import type {
  BoundEndpoint,
  ProviderCapabilitySnapshot,
  ProviderRecord,
  ProviderSelectionEvidence,
  QueryRequest,
} from './types.js';

export interface GatewayResponse {
  ok: boolean;
  result: unknown;
  raw: string;
  error?: string;
  status?: number;
  selection: ProviderSelectionEvidence;
  resultHash: string;
}

const MAX_RETRY = 3;

export class ProviderScheduler {
  readonly budget: ProviderBudgetManager;
  readonly cache = new ContentAddressedCache();
  snapshots: ProviderCapabilitySnapshot[] = [];

  constructor(
    readonly registry: ProviderRegistry,
    options: { aimdMax?: number } = {},
  ) {
    const aimdMax = options.aimdMax;
    this.budget = new ProviderBudgetManager(
      10_000,
      UNKNOWN_PUBLIC_START_RPS,
      0.2,
      aimdMax === undefined ? createAimd : () => createAimd({ max: aimdMax }),
    );
  }

  operatorsFor(chainId: string, method: string, params: unknown[] = []): SourceOperator[] {
    const selection = selectProviders(
      this.registry.list(),
      {
        chainId,
        method,
        params,
        loadBearing: true,
      },
      this.snapshots,
    );
    return selection.selected.map((item) => {
      const record = this.registry.get(item.providerId);
      return operatorFromEndpoint({
        endpointId: item.endpointRef,
        chainId,
        operatorId: item.operatorId,
        logsCapability: record?.logsDeclared === true ? 'declared' : 'denied',
        archiveCapability: record?.archiveDeclared ?? false,
        ...(record === undefined ? {} : { forensicGrade: record.forensicGrade }),
        ...(record?.deniedMethods === undefined ? {} : { deniedMethods: record.deniedMethods }),
        ...(record?.credentialStatus === undefined
          ? {}
          : { credentialStatus: record.credentialStatus }),
      });
    });
  }
}

export function createJsonRpcTransport(input: {
  bindings: readonly BoundEndpoint[];
  records: readonly ProviderRecord[];
  timeoutMs: number;
  scheduler: ProviderScheduler;
  secrets?: readonly string[];
}): {
  call(
    operatorOrProviderId: string,
    method: string,
    params: unknown[],
  ): Promise<{
    ok: boolean;
    result: unknown;
    raw: string;
    error?: string;
  }>;
  execute(request: QueryRequest): Promise<GatewayResponse>;
} {
  const byId = new Map<string, BoundEndpoint>();
  for (const binding of input.bindings) {
    byId.set(binding.providerId, binding);
    byId.set(binding.operatorId, binding);
    byId.set(binding.endpointRef, binding);
  }
  const secrets = input.secrets ?? [];

  async function fetchOnce(
    binding: BoundEndpoint,
    method: string,
    params: unknown[],
    timeoutMs: number,
  ): Promise<{
    ok: boolean;
    result: unknown;
    raw: string;
    status?: number;
    error?: string;
    retryAfterMs?: number;
  }> {
    const record = input.records.find((item) => item.providerId === binding.providerId);
    if (record !== undefined && record.deniedMethods.includes(method)) {
      return { ok: false, result: null, raw: '', error: 'METHOD_DENIED' };
    }
    const methodClass = methodClassOf(method, params);
    if (
      record?.forensicGrade === 'PUBLIC_NO_SLA' &&
      (methodClass === 'LOGS' || methodClass === 'TRACE')
    ) {
      return { ok: false, result: null, raw: '', error: 'METHOD_DENIED' };
    }
    let url = binding.fetchUrl;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (binding.authType === 'bearer' && binding.authSecret !== undefined) {
      headers.authorization = `Bearer ${binding.authSecret}`;
    }
    if (binding.authType === 'header' && binding.authSecret !== undefined) {
      headers[binding.headerName ?? 'x-api-key'] = binding.authSecret;
    }
    if (binding.authType === 'query' && binding.authSecret !== undefined) {
      const parsed = new URL(url);
      parsed.searchParams.set('api-key', binding.authSecret);
      url = parsed.toString();
    }
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params });
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = redactSecret(await response.text(), secrets);
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'), Date.now());
      if (raw.length > (record?.maxResponseBytes ?? 8_000_000)) {
        return {
          ok: false,
          result: null,
          raw: '',
          error: 'RESPONSE_SIZE_LIMIT',
          status: response.status,
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          result: null,
          raw,
          error: `HTTP ${response.status}`,
          status: response.status,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        };
      }
      const parsed = JSON.parse(raw) as { result?: unknown; error?: { message?: string } };
      if (parsed.error) {
        return {
          ok: false,
          result: null,
          raw,
          error: parsed.error.message ?? 'rpc error',
          status: response.status,
        };
      }
      return { ok: true, result: parsed.result, raw, status: response.status };
    } catch (error) {
      return {
        ok: false,
        result: null,
        raw: '',
        error: error instanceof Error ? error.message : 'fetch failed',
      };
    }
  }

  async function execute(request: QueryRequest): Promise<GatewayResponse> {
    const selection = selectProviders(input.records, request, input.scheduler.snapshots);
    const first = selection.selected[0];
    if (first === undefined) {
      return {
        ok: false,
        result: null,
        raw: '',
        error: selection.unavailableReason ?? 'PROVIDER_UNAVAILABLE',
        selection,
        resultHash: resultHash('', secrets),
      };
    }
    const binding = byId.get(first.providerId);
    if (binding === undefined) {
      return {
        ok: false,
        result: null,
        raw: '',
        error: 'BINDING_MISSING',
        selection,
        resultHash: resultHash('', secrets),
      };
    }
    const cacheKey = coalesceKey({
      chain: request.chainId,
      blockHash: String(request.blockHeight ?? 'head'),
      method: request.method,
      canonicalParams: JSON.stringify(request.params),
      adapterVersion: 'provider-plane-v1',
    });
    const cached = input.scheduler.cache.get(cacheKey, Date.now());
    if (cached !== undefined) {
      return {
        ok: true,
        result: cached.result,
        raw: cached.raw,
        selection,
        resultHash: resultHash(cached.raw, secrets),
      };
    }
    let last:
      | {
          ok: boolean;
          result: unknown;
          raw: string;
          status?: number;
          error?: string;
          retryAfterMs?: number;
        }
      | undefined;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt += 1) {
      const admission = input.scheduler.budget.admit({
        nowMs: Date.now(),
        key: {
          operator: first.operatorId,
          provider: first.providerId,
          method: request.method,
          chain: request.chainId,
          tenant: request.tenant ?? 'default',
          job: request.job ?? 'adhoc',
        },
        coalesce: cacheKey,
        cost: 1,
        verification: request.loadBearing === true,
        ...(last?.retryAfterMs === undefined ? {} : { retryAfterMs: last.retryAfterMs }),
      });
      if (!admission.admitted) {
        if (admission.coalesced) {
          const hit = input.scheduler.cache.get(cacheKey, Date.now());
          if (hit !== undefined) {
            return {
              ok: true,
              result: hit.result,
              raw: hit.raw,
              selection,
              resultHash: resultHash(hit.raw, secrets),
            };
          }
        }
        if (admission.retryAfterMs !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, admission.retryAfterMs));
          continue;
        }
        last = {
          ok: false,
          result: null,
          raw: '',
          ...(admission.reason === undefined ? {} : { error: admission.reason }),
        };
        break;
      }
      const started = Date.now();
      last = await fetchOnce(binding, request.method, request.params, input.timeoutMs);
      const outcome = last.ok ? 'ok' : last.status === 429 ? 'throttle' : 'error';
      input.scheduler.budget.complete(first.providerId, Date.now() - started, outcome);
      input.scheduler.registry.recordUsage(first.providerId, last.raw.length, outcome);
      if (last.ok) {
        input.scheduler.cache.set(cacheKey, last.raw, last.result, Date.now());
        break;
      }
      if (last.status !== 429 && last.status !== 503) break;
    }
    const finalResult = last ?? { ok: false, result: null, raw: '', error: 'NO_ATTEMPT' };
    return {
      ok: finalResult.ok,
      result: finalResult.result,
      raw: finalResult.raw,
      ...(finalResult.error === undefined ? {} : { error: finalResult.error }),
      ...(finalResult.status === undefined ? {} : { status: finalResult.status }),
      selection,
      resultHash: resultHash(finalResult.raw, secrets),
    };
  }

  return {
    async call(operatorOrProviderId, method, params) {
      const binding =
        byId.get(operatorOrProviderId) ??
        input.bindings.find((item) => item.endpointRef === operatorOrProviderId);
      if (binding === undefined) {
        return { ok: false, result: null, raw: '', error: 'BINDING_MISSING' };
      }
      const record = input.records.find((item) => item.providerId === binding.providerId);
      const admission = input.scheduler.budget.admit({
        nowMs: Date.now(),
        key: {
          operator: binding.operatorId,
          provider: binding.providerId,
          method,
          chain: record?.chainId ?? 'eip155:56',
          tenant: 'default',
          job: 'direct',
        },
        coalesce: coalesceKey({
          chain: record?.chainId ?? 'eip155:56',
          blockHash: 'head',
          method,
          canonicalParams: JSON.stringify(params),
          adapterVersion: 'provider-plane-v1',
        }),
        cost: 1,
        verification: true,
      });
      if (!admission.admitted && !admission.coalesced) {
        return { ok: false, result: null, raw: '', error: admission.reason ?? 'RATE_LIMIT' };
      }
      const started = Date.now();
      const once = await fetchOnce(binding, method, params, input.timeoutMs);
      const outcome = once.ok ? 'ok' : once.status === 429 ? 'throttle' : 'error';
      input.scheduler.budget.complete(binding.providerId, Date.now() - started, outcome);
      input.scheduler.registry.recordUsage(binding.providerId, once.raw.length, outcome);
      return {
        ok: once.ok,
        result: once.result,
        raw: once.raw,
        ...(once.error === undefined ? {} : { error: once.error }),
      };
    },
    execute,
  };
}
