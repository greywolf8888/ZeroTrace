import { describe, expect, it, vi } from 'vitest';

import {
  FailoverJsonRpcTransport,
  QuorumJsonRpcTransport,
  FailoverRestTransport,
  SafeJsonRpcTransport,
  SafeRestTransport,
  type JsonRpcTransport,
} from './transport.js';

const localPolicy = {
  allowedHosts: ['localhost'],
  allowPrivateNetworks: true,
  allowHttpForPrivateNetworks: true,
};

describe('safe transports', () => {
  it('cancels an in-flight read without retrying after the caller aborts', async () => {
    const controller = new AbortController();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    });
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1_000,
      resilience: { maxAttempts: 3, retryBaseDelayMs: 0, retryMaxDelayMs: 0 },
      fetchImplementation,
    });

    const pending = transport.getText('/slow', { signal: controller.signal });
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', retryable: false });
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(transport.diagnostics()).toMatchObject({ retries: 0 });
  });

  it('retries bounded transient failures and records diagnostics', async () => {
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('temporary', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      resilience: {
        maxAttempts: 2,
        retryBaseDelayMs: 0,
        retryMaxDelayMs: 0,
      },
      fetchImplementation: fakeFetch,
    });

    await expect(transport.getText('/health')).resolves.toBe('ok');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
    expect(transport.diagnostics()).toMatchObject({
      logicalRequests: 1,
      attempts: 2,
      successes: 1,
      failures: 0,
      retries: 1,
      circuitState: 'CLOSED',
    });
  });

  it('uses a bounded Retry-After delay for rate-limited responses', async () => {
    const delays: number[] = [];
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('limited', { status: 429, headers: { 'retry-after': '2' } }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      resilience: { maxAttempts: 2, retryMaxDelayMs: 250 },
      fetchImplementation: fakeFetch,
      sleepImplementation: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });

    await expect(transport.getText('/health')).resolves.toBe('ok');
    expect(delays).toEqual([250]);
  });

  it('caches successful reads with bounded freshness and refetches after expiry', async () => {
    let now = 1_000;
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('ok', { status: 200 }));
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      resilience: { cacheTtlMs: 1_000, cacheMaxEntries: 2 },
      fetchImplementation: fakeFetch,
      nowImplementation: () => now,
    });

    await expect(transport.getText('/health')).resolves.toBe('ok');
    await expect(transport.getText('/health')).resolves.toBe('ok');
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(transport.diagnostics()).toMatchObject({ cacheHits: 1, cacheMisses: 1 });

    now += 1_001;
    await expect(transport.getText('/health')).resolves.toBe('ok');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('bypasses stored responses for dynamic anchors without replacing the normal cache', async () => {
    let responseNumber = 0;
    const fakeFetch = vi.fn<typeof fetch>().mockImplementation(async () => {
      responseNumber += 1;
      return new Response(`head-${responseNumber}`, { status: 200 });
    });
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      resilience: { cacheTtlMs: 1_000, cacheMaxEntries: 2 },
      fetchImplementation: fakeFetch,
    });

    await expect(transport.getText('/head')).resolves.toBe('head-1');
    await expect(transport.getText('/head')).resolves.toBe('head-1');
    await expect(transport.getText('/head', { cacheMode: 'bypass' })).resolves.toBe('head-2');
    await expect(transport.getText('/head', { cacheMode: 'bypass' })).resolves.toBe('head-3');
    await expect(transport.getText('/head')).resolves.toBe('head-1');
    expect(fakeFetch).toHaveBeenCalledTimes(3);
    expect(transport.diagnostics()).toMatchObject({
      cacheHits: 2,
      cacheMisses: 1,
      cacheBypasses: 2,
    });
  });

  it('paces distinct requests according to the configured endpoint rate', async () => {
    let now = 10_000;
    const delays: number[] = [];
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      resilience: { requestsPerSecond: 2 },
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response('ok', { status: 200 })),
      nowImplementation: () => now,
      sleepImplementation: (milliseconds) => {
        delays.push(milliseconds);
        now += milliseconds;
        return Promise.resolve();
      },
    });

    await transport.getText('/one');
    await transport.getText('/two');
    expect(delays).toEqual([500]);
    expect(transport.diagnostics().rateLimitDelays).toBe(1);
  });

  it('opens after the configured failure threshold and recovers through half-open', async () => {
    let now = 1_000;
    const fakeFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('socket failed'))
      .mockResolvedValue(new Response('recovered', { status: 200 }));
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      resilience: {
        maxAttempts: 1,
        circuitFailureThreshold: 1,
        circuitResetMs: 1_000,
      },
      fetchImplementation: fakeFetch,
      nowImplementation: () => now,
    });

    await expect(transport.getText('/health')).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    expect(transport.diagnostics().circuitState).toBe('OPEN');
    await expect(transport.getText('/health')).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    expect(fakeFetch).toHaveBeenCalledTimes(1);

    now += 1_001;
    await expect(transport.getText('/health')).resolves.toBe('recovered');
    expect(transport.diagnostics().circuitState).toBe('CLOSED');
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });

  it('fails over retryable JSON-RPC failures and keeps the healthy endpoint preferred', async () => {
    const primaryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('down', { status: 503 }));
    const secondaryFetch = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: '0x1' }), {
        status: 200,
      });
    });
    const createEndpoint = (endpointId: string, fetchImplementation: typeof fetch) =>
      new SafeJsonRpcTransport({
        endpointId,
        baseUrl: 'http://localhost:8545',
        policy: localPolicy,
        timeoutMs: 1000,
        resilience: { maxAttempts: 1 },
        fetchImplementation,
      });
    const transport = new FailoverJsonRpcTransport('pool', [
      createEndpoint('primary', primaryFetch),
      createEndpoint('secondary', secondaryFetch),
    ]);

    await expect(transport.requestSourced('eth_chainId')).resolves.toEqual({
      value: '0x1',
      endpointId: 'secondary',
    });
    await expect(transport.request('eth_chainId')).resolves.toBe('0x1');
    expect(primaryFetch).toHaveBeenCalledTimes(1);
    expect(secondaryFetch).toHaveBeenCalledTimes(2);
    expect(transport.lastEndpointId).toBe('secondary');
    expect(transport.diagnostics()).toMatchObject({ failovers: 1, activeEndpointId: 'secondary' });
  });

  it('keeps each concurrent response bound to its producer when failover changes the active endpoint', async () => {
    let releasePrimary: (() => void) | undefined;
    const primaryGate = new Promise<void>((resolve) => {
      releasePrimary = resolve;
    });
    const rpcResponse = (init: RequestInit | undefined, result: string) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        status: 200,
      });
    };
    const primaryFetch = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { method: string };
      if (request.method === 'switch_endpoint') return new Response('down', { status: 503 });
      await primaryGate;
      return rpcResponse(init, 'primary-result');
    });
    const secondaryFetch = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => rpcResponse(init, 'secondary-result'));
    const endpoint = (endpointId: string, fetchImplementation: typeof fetch) =>
      new SafeJsonRpcTransport({
        endpointId,
        baseUrl: 'http://localhost:8545',
        policy: localPolicy,
        timeoutMs: 1000,
        resilience: { maxAttempts: 1 },
        fetchImplementation,
      });
    const transport = new FailoverJsonRpcTransport('pool', [
      endpoint('primary', primaryFetch),
      endpoint('secondary', secondaryFetch),
    ]);

    const slowPrimary = transport.requestSourced('slow_primary');
    const switched = await transport.requestSourced('switch_endpoint');
    releasePrimary?.();
    const primary = await slowPrimary;

    expect(switched).toEqual({ value: 'secondary-result', endpointId: 'secondary' });
    expect(primary).toEqual({ value: 'primary-result', endpointId: 'primary' });
    expect(transport.lastEndpointId).toBe('primary');
  });

  it('fails over retryable REST failures without changing the requested path', async () => {
    const primary = new SafeRestTransport({
      endpointId: 'primary',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      resilience: { maxAttempts: 1 },
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('down', { status: 503 })),
    });
    const secondaryFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    const secondary = new SafeRestTransport({
      endpointId: 'secondary',
      baseUrl: 'http://localhost:8081',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: secondaryFetch,
    });
    const transport = new FailoverRestTransport('pool', [primary, secondary]);

    await expect(transport.getTextSourced('/blocks/tip/height')).resolves.toEqual({
      value: 'ok',
      endpointId: 'secondary',
    });
    expect(String(secondaryFetch.mock.calls[0]?.[0])).toBe(
      'http://localhost:8081/blocks/tip/height',
    );
    expect(transport.lastEndpointId).toBe('secondary');
  });

  it('returns only an explicitly agreed value and records every contributing source', async () => {
    const endpoint = (endpointId: string, value: unknown) =>
      ({
        endpointId,
        request: vi.fn(async <T>() => value as T),
        requestSourced: vi.fn(async <T>() => ({ value: value as T, endpointId })),
      }) as unknown as JsonRpcTransport & { requestSourced: ReturnType<typeof vi.fn> };
    const primary = endpoint('bsc-rpc@primary#1', { block: '0x10' });
    const secondary = endpoint('bsc-rpc@secondary#2', { block: '0x10' });
    const transport = new QuorumJsonRpcTransport('bsc-rpc:independent', [primary, secondary]);

    await expect(transport.requestSourced('eth_getBlockByNumber')).resolves.toEqual({
      value: { block: '0x10' },
      endpointId: 'bsc-rpc@primary#1',
      sourceIds: ['bsc-rpc@primary#1', 'bsc-rpc@secondary#2'],
    });
    expect(primary.requestSourced).toHaveBeenCalledTimes(1);
    expect(secondary.requestSourced).toHaveBeenCalledTimes(1);
    expect(transport.diagnostics()).toMatchObject({
      logicalRequests: 1,
      successes: 1,
      failures: 0,
    });
  });

  it('fails closed on an independent-provider disagreement or partial quorum', async () => {
    const endpoint = (endpointId: string, result: unknown, failure = false) =>
      ({
        endpointId,
        request: vi.fn(async <T>() => {
          if (failure) throw new Error('provider down');
          return result as T;
        }),
        requestSourced: vi.fn(async <T>() => {
          if (failure) throw new Error('provider down');
          return { value: result as T, endpointId };
        }),
      }) as unknown as JsonRpcTransport;
    const disagreement = new QuorumJsonRpcTransport('pool', [
      endpoint('primary', 'a'),
      endpoint('secondary', 'b'),
    ]);
    await expect(disagreement.request('eth_blockNumber')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      retryable: false,
    });

    const partial = new QuorumJsonRpcTransport('pool', [
      endpoint('primary', 'a'),
      endpoint('secondary', 'b', true),
    ]);
    await expect(partial.request('eth_blockNumber')).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      retryable: true,
    });
  });

  it('maps JSON-RPC quota errors to retryable rate limiting', async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body)) as { id: number };
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32005, message: 'compute units per second capacity exceeded' },
        }),
        { status: 200 },
      );
    });
    const transport = new SafeJsonRpcTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8545',
      policy: localPolicy,
      timeoutMs: 1000,
      resilience: { maxAttempts: 1 },
      fetchImplementation: fakeFetch,
    });
    await expect(transport.request('eth_blockNumber')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('rejects redirects instead of following them to an unvalidated host', async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('', {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data' },
      }),
    );
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: fakeFetch,
    });
    await expect(transport.getText('/health')).rejects.toMatchObject({ code: 'REDIRECT_BLOCKED' });
  });

  it('requires a matching JSON-RPC id', async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 999, result: '0x1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const transport = new SafeJsonRpcTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8545',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: fakeFetch,
    });
    await expect(transport.request('eth_chainId')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('preserves unsafe provider integers as exact strings', async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('{"jsonrpc":"2.0","id":1,"result":{"value":{"lamports":9123372036854000123}}}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const transport = new SafeJsonRpcTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8899',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: fakeFetch,
    });
    const result = await transport.request<{ value: { lamports: string } }>('getAccountInfo');
    expect(result.value.lamports).toBe('9123372036854000123');
  });

  it('sends a bounded JSON-RPC request and returns a successful result', async () => {
    const fakeFetch = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('manual');
      expect(JSON.parse(String(init?.body))).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getBalance',
        params: ['0xabc', 'latest'],
      });
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x2a' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const transport = new SafeJsonRpcTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8545',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: fakeFetch,
    });
    await expect(transport.request('eth_getBalance', ['0xabc', 'latest'])).resolves.toBe('0x2a');
  });

  it.each([
    { body: '{not-json', expectedCode: 'INVALID_RESPONSE' },
    { body: '[]', expectedCode: 'INVALID_RESPONSE' },
    { body: '{"jsonrpc":"2.0","id":1}', expectedCode: 'INVALID_RESPONSE' },
    {
      body: '{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"denied"}}',
      expectedCode: 'RPC_ERROR',
    },
    {
      body: '{"jsonrpc":"2.0","id":1,"error":{"code":-1}}',
      expectedCode: 'RPC_ERROR',
    },
  ])('rejects an invalid JSON-RPC envelope', async ({ body, expectedCode }) => {
    const transport = new SafeJsonRpcTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8545',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    });
    await expect(transport.request('test')).rejects.toMatchObject({ code: expectedCode });
  });

  it.each([
    [429, 'RATE_LIMITED', true],
    [503, 'HTTP_ERROR', true],
    [400, 'HTTP_ERROR', false],
  ])('maps provider HTTP %s to %s', async (status, code, retryable) => {
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('failure', { status })),
    });
    await expect(transport.getText('/test')).rejects.toMatchObject({ code, retryable });
  });

  it('enforces declared and actual response-size limits', async () => {
    const declared = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      maxResponseBytes: 4,
      fetchImplementation: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('tiny', {
          status: 200,
          headers: { 'content-length': '100' },
        }),
      ),
    });
    await expect(declared.getText('/test')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const actual = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      maxResponseBytes: 4,
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('too large', { status: 200 })),
    });
    await expect(actual.getText('/test')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects relative or traversing REST paths before fetch', async () => {
    const fakeFetch = vi.fn<typeof fetch>();
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080/api',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: fakeFetch,
    });
    await expect(transport.getText('relative')).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_URL',
    });
    await expect(transport.getText('/../secret')).rejects.toMatchObject({
      code: 'INVALID_PROVIDER_URL',
    });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it('parses REST JSON and wraps malformed JSON', async () => {
    const valid = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080/api/',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{"ok":true}', { status: 200 })),
    });
    await expect(valid.getJson('/health')).resolves.toEqual({ ok: true });

    const invalid = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('{bad', { status: 200 })),
    });
    await expect(invalid.getJson('/health')).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('maps aborted fetches to timeout errors', async () => {
    const transport = new SafeRestTransport({
      endpointId: 'local',
      baseUrl: 'http://localhost:8080',
      policy: localPolicy,
      timeoutMs: 1000,
      fetchImplementation: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException('aborted', 'AbortError')),
    });
    await expect(transport.getText('/health')).rejects.toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
  });
});
