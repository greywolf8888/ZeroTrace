import { describe, expect, it } from 'vitest';

import {
  BSC_PUBLIC_NO_SLA_ENDPOINTS,
  independentOperatorCount,
  operatorFromEndpoint,
} from '@zerotrace/source-registry';

import {
  defaultBscPublicCatalog,
  isHistoricalBlock,
  methodClassOf,
  bulkDatasetRecord,
} from './catalog.js';
import { createJsonRpcTransport, ProviderScheduler } from './gateway.js';
import {
  planCorpusIngestion,
  planLifetimeHistory,
  planQuery,
  splitRange,
  nextWindow,
} from './plan.js';
import { ProviderCapabilityProbe } from './probe-class.js';
import { probeProvider, snapshotMeets } from './probe.js';
import { ProviderRegistry, SourceOperatorRegistry } from './registry.js';
import { ContentAddressedCache, redactSecret, resultHash } from './secrets.js';
import { recordAllows, selectProviders } from './select.js';
import { evaluateShadowPromotion } from './shadow.js';
import type { BoundEndpoint, ProviderCapabilitySnapshot, ProviderRecord } from './types.js';

describe('provider plane policy', () => {
  it('does not treat two official BNB public URLs as independent sources', () => {
    const left = operatorFromEndpoint({
      endpointId: 'https://bsc-dataseed.bnbchain.org',
      chainId: 'eip155:56',
    });
    const right = operatorFromEndpoint({
      endpointId: 'https://bsc-dataseed-public.bnbchain.org',
      chainId: 'eip155:56',
    });
    expect(left.independenceGroup).toBe(right.independenceGroup);
    expect(independentOperatorCount([left, right])).toBe(1);
  });

  it('forbids eth_getLogs on the default public pool, including official dataseed', () => {
    const catalog = defaultBscPublicCatalog();
    expect(catalog.map((item) => item.endpointRef).sort()).toEqual(
      [...BSC_PUBLIC_NO_SLA_ENDPOINTS].sort(),
    );
    const logs = selectProviders(catalog, {
      chainId: 'eip155:56',
      method: 'eth_getLogs',
      params: [{ fromBlock: '0x1', toBlock: '0x2' }],
      loadBearing: true,
    });
    expect(logs.selected).toEqual([]);
    expect(logs.unavailableReason).toBe('LOGS_REQUIRE_BULK_OR_KEYED');
    expect(logs.rejected.some((item) => item.reason === 'PUBLIC_LOGS_FORBIDDEN')).toBe(true);
  });

  it('selects public operators for code and receipts without using vendor-name branches', () => {
    const catalog = defaultBscPublicCatalog();
    const code = selectProviders(catalog, {
      chainId: 'eip155:56',
      method: 'eth_getCode',
      params: ['0xabc', 'latest'],
      loadBearing: true,
    });
    expect(code.selected).toHaveLength(2);
    expect(new Set(code.selected.map((item) => item.independenceGroup)).size).toBe(2);
    expect(code.selected.every((item) => item.forensicGrade === 'PUBLIC_NO_SLA')).toBe(true);
  });

  it('keeps unconfigured keyed slots out of routing', () => {
    const catalog = [
      ...defaultBscPublicCatalog(),
      {
        ...defaultBscPublicCatalog()[2]!,
        providerId: 'keyed-archive-slot',
        forensicGrade: 'FREE_KEYED' as const,
        credentialStatus: 'UNCONFIGURED' as const,
        archiveDeclared: true,
        logsDeclared: true,
        allowedMethodClasses: ['ARCHIVE_STATE', 'LOGS', 'CODE'] as const,
        deniedMethods: [],
      },
    ];
    const archive = selectProviders(catalog, {
      chainId: 'eip155:56',
      method: 'eth_getCode',
      params: ['0xabc', '0x10'],
      archiveRequired: true,
    });
    expect(archive.selected.some((item) => item.providerId === 'keyed-archive-slot')).toBe(false);
    expect(archive.unavailableReason).toBe('PROVIDER_UNAVAILABLE');
  });

  it('plans corpus ingestion as bulk-first and never as per-token public logs', () => {
    const blocked = planCorpusIngestion({
      tokenCount: 50,
      bulkAvailable: false,
      keyedArchiveAvailable: false,
      traceAvailable: false,
    });
    expect(blocked.strategy).toBe('BLOCKED_NO_BULK');
    expect(blocked.forbidPerTokenPublicLogs).toBe(true);
    const ready = planCorpusIngestion({
      tokenCount: 50,
      bulkAvailable: true,
      keyedArchiveAvailable: true,
      traceAvailable: false,
    });
    expect(ready.strategy).toBe('BULK_THEN_RPC_VERIFY');
    expect(ready.localIndexFirst).toBe(true);
    expect(
      planQuery({
        hasLocalIndex: true,
        bulkAvailable: true,
        archiveRequired: true,
        traceRequired: false,
        loadBearing: true,
        method: 'eth_getLogs',
      }).steps.some((step) => step.source === 'BULK_DATASET'),
    ).toBe(true);
  });

  it('plans lifetime history from local coverage with zero historical RPC', () => {
    const complete = planLifetimeHistory({ coverageComplete: true, bulkAvailable: true });
    expect(complete.estimatedRpcCost).toBe(0);
    expect(complete.steps.some((step) => step.method === 'eth_getLogs')).toBe(false);
    const gap = planLifetimeHistory({ coverageComplete: false, bulkAvailable: true });
    expect(gap.steps.some((step) => step.source === 'BULK_DATASET')).toBe(true);
    expect(gap.steps.some((step) => step.method === 'eth_getLogs')).toBe(false);
  });

  it('promotes a shadow key only when accuracy holds and a threshold is met', () => {
    const baseline = {
      completionRate: 0.4,
      originTraceCompletion: 0,
      p50Ms: 200,
      p95Ms: 1000,
      p99Ms: 2000,
      rateLimited: 20,
      timeouts: 5,
      coverage: 0.4,
      sourceConflicts: 0,
      requestCost: 10,
      costPerCompletedCase: 2,
      resultHashDiffs: 0,
      closedCriticalCapability: false,
    };
    expect(evaluateShadowPromotion(baseline, { ...baseline, completionRate: 0.45 }).promote).toBe(
      false,
    );
    expect(evaluateShadowPromotion(baseline, { ...baseline, completionRate: 0.55 }).promote).toBe(
      true,
    );
    expect(
      evaluateShadowPromotion(baseline, {
        ...baseline,
        closedCriticalCapability: true,
      }).promote,
    ).toBe(true);
    expect(evaluateShadowPromotion(baseline, { ...baseline, p95Ms: 700 }).promote).toBe(true);
    expect(
      evaluateShadowPromotion(baseline, {
        ...baseline,
        completionRate: 0.9,
        sourceConflicts: 1,
      }).promote,
    ).toBe(false);
  });

  it('never puts API keys into a result hash', () => {
    const secret = 'super-secret-key-value';
    expect(resultHash(`https://example/${secret}`, [secret])).not.toContain(secret);
    expect(resultHash(`https://example/${secret}`, [secret])).toBe(
      resultHash('https://example/[REDACTED]'),
    );
  });

  it('binary-splits failed log windows', () => {
    expect(splitRange(10n, 20n)).toEqual({
      left: { from: 10n, to: 14n },
      right: { from: 15n, to: 20n },
    });
  });

  it('classifies RPC methods and historical blocks without treating unknown as current', () => {
    expect(methodClassOf('eth_getLogs')).toBe('LOGS');
    expect(methodClassOf('eth_getBlockByNumber')).toBe('ANCHOR');
    expect(methodClassOf('eth_chainId')).toBe('ANCHOR');
    expect(methodClassOf('debug_traceTransaction')).toBe('TRACE');
    expect(methodClassOf('trace_transaction')).toBe('TRACE');
    expect(methodClassOf('eth_getTransactionReceipt')).toBe('RECEIPT');
    expect(methodClassOf('eth_getTransactionByHash')).toBe('RECEIPT');
    expect(methodClassOf('eth_getCode', ['0xabc', 'latest'])).toBe('CODE');
    expect(methodClassOf('eth_getCode', ['0xabc', '0x10'])).toBe('ARCHIVE_STATE');
    expect(methodClassOf('eth_call', [{}, 'latest'])).toBe('CURRENT_STATE');
    expect(methodClassOf('eth_call', [{}, '0xa'])).toBe('ARCHIVE_STATE');
    expect(methodClassOf('eth_getBalance', ['0xabc', 'safe'])).toBe('CURRENT_STATE');
    expect(methodClassOf('eth_getStorageAt', ['0xabc', '0x0', '12'])).toBe('ARCHIVE_STATE');
    expect(methodClassOf('unknown_method')).toBe('ANCHOR');
    expect(isHistoricalBlock('latest')).toBe(false);
    expect(isHistoricalBlock('safe')).toBe(false);
    expect(isHistoricalBlock('finalized')).toBe(false);
    expect(isHistoricalBlock('pending')).toBe(false);
    expect(isHistoricalBlock(1)).toBe(false);
    expect(isHistoricalBlock('0xa')).toBe(true);
    expect(isHistoricalBlock('16')).toBe(true);
    expect(bulkDatasetRecord('eip155:56').providerId).toBe('bulk-sqd-binance-mainnet');
    expect(bulkDatasetRecord().logsDeclared).toBe(true);
  });

  it('rejects shadow, trace, and chain mismatches without inventing a provider', () => {
    const publicRecord = defaultBscPublicCatalog()[0]!;
    const shadow: ProviderRecord = {
      ...publicRecord,
      providerId: 'shadow-slot',
      role: 'SHADOW',
    };
    expect(
      recordAllows(shadow, {
        chainId: 'eip155:1',
        method: 'eth_chainId',
        params: [],
      }),
    ).toBe('CHAIN_MISMATCH');
    expect(
      recordAllows(shadow, {
        chainId: 'eip155:56',
        method: 'eth_chainId',
        params: [],
      }),
    ).toBe('SHADOW');
    expect(
      recordAllows(publicRecord, {
        chainId: 'eip155:56',
        method: 'debug_traceTransaction',
        params: ['0x'],
        traceRequired: true,
      }),
    ).toBe('PUBLIC_TRACE_FORBIDDEN');
    const keyed: ProviderRecord = {
      ...publicRecord,
      providerId: 'keyed-no-trace',
      forensicGrade: 'FREE_KEYED',
      deniedMethods: ['debug_traceTransaction'],
      allowedMethodClasses: ['TRACE', 'RECEIPT'],
      credentialStatus: 'CONFIGURED',
      traceDeclared: false,
    };
    expect(
      recordAllows(keyed, {
        chainId: 'eip155:56',
        method: 'debug_traceTransaction',
        params: ['0x'],
        traceRequired: true,
      }),
    ).toBe('METHOD_DENIED');
    const keyedTrace: ProviderRecord = {
      ...keyed,
      deniedMethods: [],
    };
    expect(
      recordAllows(keyedTrace, {
        chainId: 'eip155:56',
        method: 'debug_traceTransaction',
        params: ['0x'],
        traceRequired: true,
      }),
    ).toBe('TRACE_REQUIRED');
    const trace = selectProviders(defaultBscPublicCatalog(), {
      chainId: 'eip155:56',
      method: 'debug_traceTransaction',
      params: ['0x'],
      loadBearing: true,
    });
    expect(trace.unavailableReason).toBe('TRACE_UNAVAILABLE');
    const bulkLogs = selectProviders([bulkDatasetRecord(), ...defaultBscPublicCatalog()], {
      chainId: 'eip155:56',
      method: 'eth_getLogs',
      params: [{}],
    });
    expect(bulkLogs.selected[0]?.providerId).toBe('bulk-sqd-binance-mainnet');
    const snapshots: ProviderCapabilitySnapshot[] = [
      {
        providerId: publicRecord.providerId,
        operatorId: publicRecord.operatorId,
        endpointRef: publicRecord.endpointRef,
        probedAt: new Date().toISOString(),
        chainIdOk: true,
        finalizedOk: true,
        historicalCodeOk: true,
        historicalCallOk: true,
        smallLogsOk: false,
        traceOk: 'UNCONFIGURED',
        batchOk: true,
        maxResponseBytes: 1000,
      },
    ];
    const preferred = selectProviders(
      defaultBscPublicCatalog(),
      {
        chainId: 'eip155:56',
        method: 'eth_getCode',
        params: ['0xabc', 'latest'],
        loadBearing: true,
      },
      snapshots,
    );
    expect(preferred.selected[0]?.providerId).toBe(publicRecord.providerId);
  });

  it('plans windows, probes capabilities, and never fetches denied public logs', async () => {
    expect(splitRange(10n, 10n)).toBeUndefined();
    expect(
      nextWindow({
        from: 10n,
        to: 10n,
        ok: false,
        persisted: true,
        responseBytes: 1,
        maxResponseBytes: 10,
      }),
    ).toEqual({ blocked: 'RANGE_SPLIT_EXHAUSTED' });
    expect(
      nextWindow({
        from: 10n,
        to: 20n,
        ok: false,
        persisted: true,
        responseBytes: 1,
        maxResponseBytes: 10,
      }),
    ).toMatchObject({ split: true, from: 10n });
    expect(
      nextWindow({
        from: 10n,
        to: 10n,
        ok: true,
        persisted: true,
        responseBytes: 99,
        maxResponseBytes: 10,
      }),
    ).toEqual({ blocked: 'RESPONSE_SIZE_LIMIT' });
    expect(
      nextWindow({
        from: 10n,
        to: 20n,
        ok: true,
        persisted: false,
        responseBytes: 1,
        maxResponseBytes: 10,
      }),
    ).toEqual({ blocked: 'CURSOR_REQUIRES_PERSIST' });
    expect(
      nextWindow({
        from: 10n,
        to: 20n,
        ok: true,
        persisted: true,
        responseBytes: 1,
        maxResponseBytes: 10,
      }),
    ).toEqual({ from: 21n, to: 31n });
    expect(
      planQuery({
        hasLocalIndex: false,
        bulkAvailable: false,
        archiveRequired: false,
        traceRequired: true,
        loadBearing: false,
        method: 'eth_getLogs',
      }).steps.some((step) => step.id === 'blocked-public-logs'),
    ).toBe(true);

    expect(redactSecret('short-x', ['abc'])).toBe('short-x');
    const cache = new ContentAddressedCache(10, 2, 20);
    cache.set('a', 'raw-a', 1, 0);
    expect(cache.get('missing', 0)).toBeUndefined();
    expect(cache.get('a', 1)?.result).toBe(1);
    expect(cache.get('a', 11)).toBeUndefined();
    cache.set('big', 'x'.repeat(30), 2, 0);
    expect(cache.get('big', 0)).toBeUndefined();
    cache.set('b', 'bb', 2, 0);
    cache.set('c', 'cc', 3, 0);
    cache.set('d', 'dd', 4, 0);
    expect(cache.get('b', 0)).toBeUndefined();

    const catalog = defaultBscPublicCatalog();
    const first = catalog[0]!;
    const registry = new ProviderRegistry(catalog, [
      { slotId: 'slot-x', status: 'CONFIGURED', authType: 'bearer' },
    ]);
    registry.upsert({ ...first, providerId: 'extra-public' });
    expect(registry.get('extra-public')?.providerId).toBe('extra-public');
    registry.setRole('missing', 'SHADOW');
    registry.setRole(first.providerId, 'FALLBACK');
    expect(registry.get(first.providerId)?.role).toBe('FALLBACK');
    registry.recordUsage(first.providerId, 12, 'ok');
    registry.recordUsage(first.providerId, 4, 'throttle');
    registry.recordUsage(first.providerId, 1, 'error');
    expect(registry.usage.get(first.providerId)).toMatchObject({
      requests: 3,
      throttles: 1,
      errors: 1,
    });
    expect(registry.credential('missing-slot').status).toBe('UNCONFIGURED');
    expect(registry.credential('slot-x').status).toBe('CONFIGURED');
    registry.revokeSlot('slot-x');
    expect(registry.credential('slot-x').status).toBe('UNCONFIGURED');
    const operators = new SourceOperatorRegistry(registry);
    expect(operators.operators('eip155:56').length).toBeGreaterThan(0);
    expect(operators.operators('eip155:1')).toEqual([]);

    const binding: BoundEndpoint = {
      providerId: first.providerId,
      operatorId: first.operatorId,
      endpointRef: first.endpointRef,
      fetchUrl: first.endpointRef,
      authType: 'none',
    };
    const probe = new ProviderCapabilityProbe({
      async call(_bound, method) {
        if (method === 'eth_chainId') return { ok: true, result: '0x38', raw: '{}' };
        if (method === 'eth_getBlockByNumber')
          return { ok: true, result: { number: '0x1' }, raw: '{}' };
        if (method === 'eth_getCode') return { ok: true, result: '0x', raw: '{}' };
        if (method === 'eth_call') return { ok: true, result: '0x', raw: '{}' };
        if (method === 'eth_getLogs')
          return { ok: false, result: null, raw: '', status: 429, retryAfter: '1' };
        return { ok: false, result: null, raw: '' };
      },
    });
    const live = await probe.snapshot(binding, {
      chainId: 'eip155:56',
      timeoutMs: 50,
      maxResponseBytes: 2048,
      logsPolicyDenied: false,
      traceConfigured: true,
    });
    expect(live.chainIdOk).toBe(true);
    expect(live.retryAfterObserved).toBe(true);
    expect(live.traceOk).toBe(false);
    const deniedLogs = await probeProvider(
      binding,
      {
        async call() {
          return { ok: true, result: '0x1', raw: '{}' };
        },
      },
      {
        chainId: 'eip155:56',
        timeoutMs: 50,
        maxResponseBytes: 2048,
        logsPolicyDenied: true,
        traceConfigured: false,
      },
    );
    expect(deniedLogs.smallLogsOk).toBe('POLICY_DENIED');
    expect(deniedLogs.traceOk).toBe('UNCONFIGURED');
    const failed = await probeProvider(
      binding,
      {
        async call() {
          throw new Error('probe transport down');
        },
      },
      {
        chainId: 'eip155:56',
        timeoutMs: 50,
        maxResponseBytes: 2048,
        logsPolicyDenied: true,
        traceConfigured: false,
      },
    );
    expect(failed.error).toBe('probe transport down');
    expect(snapshotMeets(live, { chainId: 'eip155:56', method: 'eth_chainId', params: [] })).toBe(
      true,
    );
    expect(
      snapshotMeets(
        { ...live, chainIdOk: false },
        { chainId: 'eip155:56', method: 'eth_chainId', params: [] },
      ),
    ).toBe(false);
    expect(
      snapshotMeets(live, {
        chainId: 'eip155:56',
        method: 'eth_getCode',
        params: ['0xabc', '0x1'],
      }),
    ).toBe(true);
    expect(snapshotMeets(live, { chainId: 'eip155:56', method: 'eth_getLogs', params: [{}] })).toBe(
      false,
    );
    expect(
      snapshotMeets(live, {
        chainId: 'eip155:56',
        method: 'debug_traceTransaction',
        params: ['0x'],
      }),
    ).toBe(false);

    const scheduler = new ProviderScheduler(registry, { aimdMax: 1 });
    expect(
      scheduler.operatorsFor('eip155:56', 'eth_getCode', ['0xabc', 'latest']).length,
    ).toBeGreaterThan(0);
    const denied = createJsonRpcTransport({
      bindings: catalog.map((record) => ({
        providerId: record.providerId,
        operatorId: record.operatorId,
        endpointRef: record.endpointRef,
        fetchUrl: record.endpointRef,
        authType: 'none',
      })),
      records: catalog,
      timeoutMs: 50,
      scheduler,
    });
    expect(
      (
        await denied.execute({
          chainId: 'eip155:56',
          method: 'eth_getLogs',
          params: [{}],
          loadBearing: true,
        })
      ).error,
    ).toBe('LOGS_REQUIRE_BULK_OR_KEYED');
    expect((await denied.call('missing', 'eth_chainId', [])).error).toBe('BINDING_MISSING');
    expect((await denied.call(first.providerId, 'eth_getLogs', [{}])).error).toBe('METHOD_DENIED');
    const unbound = createJsonRpcTransport({
      bindings: [],
      records: catalog,
      timeoutMs: 50,
      scheduler: new ProviderScheduler(registry),
    });
    expect(
      (
        await unbound.execute({
          chainId: 'eip155:56',
          method: 'eth_getCode',
          params: ['0xabc', 'latest'],
        })
      ).error,
    ).toBe('BINDING_MISSING');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const rawBody = init?.body ?? (input instanceof Request ? await input.clone().text() : '{}');
      const body = JSON.parse(String(rawBody || '{}')) as { method?: string };
      if (url.includes('throw')) throw new Error('network down');
      if (url.includes('http-fail')) {
        return new Response('unavailable', {
          status: 503,
          headers: { 'retry-after': '0' },
        });
      }
      if (url.includes('rpc-error')) {
        return new Response(JSON.stringify({ error: { message: 'execution reverted' } }), {
          status: 200,
        });
      }
      if (url.includes('too-big')) {
        return new Response('x'.repeat(100), { status: 200 });
      }
      if (body.method === 'eth_chainId') {
        return new Response(JSON.stringify({ result: '0x38' }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: null }), { status: 200 });
    }) as typeof fetch;
    try {
      const liveBinding: BoundEndpoint = {
        ...binding,
        fetchUrl: 'https://example.test/rpc',
      };
      const liveBindings = catalog.map((record) => ({
        providerId: record.providerId,
        operatorId: record.operatorId,
        endpointRef: record.endpointRef,
        fetchUrl: 'https://example.test/rpc',
        authType: 'none' as const,
      }));
      const liveTransport = createJsonRpcTransport({
        bindings: liveBindings,
        records: catalog,
        timeoutMs: 200,
        scheduler: new ProviderScheduler(new ProviderRegistry(catalog)),
        secrets: ['super-secret-key-value'],
      });
      const ok = await liveTransport.execute({
        chainId: 'eip155:56',
        method: 'eth_chainId',
        params: [],
      });
      expect(ok.ok).toBe(true);
      expect(ok.result).toBe('0x38');
      const cached = await liveTransport.execute({
        chainId: 'eip155:56',
        method: 'eth_chainId',
        params: [],
      });
      expect(cached.ok).toBe(true);

      const authBindings: BoundEndpoint[] = [
        {
          ...liveBinding,
          providerId: `${first.providerId}-bearer`,
          authType: 'bearer',
          authSecret: 'super-secret-key-value',
          fetchUrl: 'https://example.test/bearer',
        },
        {
          ...liveBinding,
          providerId: `${first.providerId}-header`,
          operatorId: `${first.operatorId}-header`,
          authType: 'header',
          headerName: 'x-api-key',
          authSecret: 'super-secret-key-value',
          fetchUrl: 'https://example.test/header',
        },
        {
          ...liveBinding,
          providerId: `${first.providerId}-query`,
          operatorId: `${first.operatorId}-query`,
          authType: 'query',
          authSecret: 'super-secret-key-value',
          fetchUrl: 'https://example.test/query',
        },
      ];
      const authRecords: ProviderRecord[] = authBindings.map((item, index) => ({
        ...first,
        providerId: item.providerId,
        operatorId: item.operatorId,
        independenceGroup: `auth-${index}`,
        endpointRef: item.endpointRef,
      }));
      const authed = createJsonRpcTransport({
        bindings: authBindings,
        records: authRecords,
        timeoutMs: 200,
        scheduler: new ProviderScheduler(new ProviderRegistry(authRecords)),
        secrets: ['super-secret-key-value'],
      });
      expect((await authed.call(authBindings[0]!.providerId, 'eth_chainId', [])).ok).toBe(true);
      expect((await authed.call(authBindings[1]!.providerId, 'eth_chainId', [])).ok).toBe(true);
      expect((await authed.call(authBindings[2]!.providerId, 'eth_chainId', [])).ok).toBe(true);

      const failingBinding: BoundEndpoint = {
        ...liveBinding,
        fetchUrl: 'https://example.test/throw',
      };
      const failing = createJsonRpcTransport({
        bindings: [failingBinding],
        records: catalog,
        timeoutMs: 50,
        scheduler: new ProviderScheduler(new ProviderRegistry(catalog)),
      });
      expect((await failing.call(first.providerId, 'eth_blockNumber', [])).ok).toBe(false);

      const rpcErr = createJsonRpcTransport({
        bindings: [{ ...liveBinding, fetchUrl: 'https://example.test/rpc-error' }],
        records: catalog,
        timeoutMs: 50,
        scheduler: new ProviderScheduler(new ProviderRegistry(catalog)),
      });
      expect((await rpcErr.call(first.providerId, 'eth_blockNumber', [])).error).toBe(
        'execution reverted',
      );

      const tiny: ProviderRecord = { ...first, maxResponseBytes: 8 };
      const oversized = createJsonRpcTransport({
        bindings: [{ ...liveBinding, fetchUrl: 'https://example.test/too-big' }],
        records: [tiny, ...catalog.slice(1)],
        timeoutMs: 50,
        scheduler: new ProviderScheduler(new ProviderRegistry([tiny, ...catalog.slice(1)])),
      });
      expect((await oversized.call(first.providerId, 'eth_blockNumber', [])).error).toBe(
        'RESPONSE_SIZE_LIMIT',
      );

      const httpFail = createJsonRpcTransport({
        bindings: [{ ...liveBinding, fetchUrl: 'https://example.test/http-fail' }],
        records: catalog,
        timeoutMs: 50,
        scheduler: new ProviderScheduler(new ProviderRegistry(catalog)),
      });
      expect((await httpFail.call(first.providerId, 'eth_blockNumber', [])).error).toContain(
        'HTTP',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
