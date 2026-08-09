import { describe, expect, it, vi } from 'vitest';

import { SafeJsonRpcTransport, SafeRestTransport } from './transport.js';

const localPolicy = {
  allowedHosts: ['localhost'],
  allowPrivateNetworks: true,
  allowHttpForPrivateNetworks: true,
};

describe('safe transports', () => {
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
