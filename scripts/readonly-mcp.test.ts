import { describe, expect, it, vi } from 'vitest';

import { createReadonlyMcpServer } from './readonly-mcp.js';
import type { READONLY_MCP_TOOLS } from './readonly-mcp.js';

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('read-only MCP gateway', () => {
  it('advertises only the bounded read-only tool set', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse({ status: 'UP' }));
    const server = createReadonlyMcpServer({
      apiBaseUrl: 'https://api.example.test',
      fetchImplementation,
    });

    const result = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tools = (result?.result as { tools: typeof READONLY_MCP_TOOLS }).tools;

    expect(tools.map((tool) => tool.name)).toEqual([
      'zerotrace_health',
      'zerotrace_capabilities',
      'zerotrace_search',
      'zerotrace_subject',
      'zerotrace_evidence_drilldown',
      'zerotrace_campaign',
      'zerotrace_case_export',
    ]);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('translates search arguments into one GET request on the configured origin', async () => {
    const requests: Array<{
      url: string;
      method: string | undefined;
      redirect: RequestRedirect | undefined;
    }> = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method,
        redirect: init?.redirect,
      });
      return jsonResponse({ items: [{ id: '0xabc', knowledgeState: 'KNOWN' }] });
    });
    const server = createReadonlyMcpServer({
      apiBaseUrl: 'https://api.example.test',
      fetchImplementation,
    });

    const result = await server.handle({
      jsonrpc: '2.0',
      id: 'search-1',
      method: 'tools/call',
      params: {
        name: 'zerotrace_search',
        arguments: { q: '0xabc', ledger: 'EVM', chainId: 'eip155:56', limit: 2 },
      },
    });

    expect(result?.error).toBeUndefined();
    expect(result?.result).toMatchObject({
      content: [{ type: 'text' }],
      structuredContent: { items: [{ id: '0xabc', knowledgeState: 'KNOWN' }] },
    });
    expect(requests).toEqual([
      {
        url: 'https://api.example.test/api/v1/search?q=0xabc&ledger=EVM&chainId=eip155%3A56&limit=2',
        method: 'GET',
        redirect: 'manual',
      },
    ]);
  });

  it('rejects unknown arguments and unsafe identifiers before making a request', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse({}));
    const server = createReadonlyMcpServer({
      apiBaseUrl: 'https://api.example.test',
      fetchImplementation,
    });

    const unknownArgument = await server.handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'zerotrace_health',
        arguments: { write: true },
      },
    });
    const unsafeEvidenceId = await server.handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'zerotrace_evidence_drilldown',
        arguments: { evidenceId: '../ev_12345678' },
      },
    });

    expect(unknownArgument?.result).toMatchObject({ isError: true });
    expect(unsafeEvidenceId?.result).toMatchObject({ isError: true });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('keeps redirects and oversized responses inside the tool error envelope', async () => {
    const redirectFetch = vi.fn<typeof fetch>(
      async () =>
        new Response('', { status: 302, headers: { location: 'https://evil.example.test' } }),
    );
    const redirectServer = createReadonlyMcpServer({
      apiBaseUrl: 'https://api.example.test',
      fetchImplementation: redirectFetch,
    });
    const redirectResult = await redirectServer.handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'zerotrace_health', arguments: {} },
    });

    const oversizedFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ status: 'UP' }, 200, { 'content-length': '2048' }),
    );
    const oversizedServer = createReadonlyMcpServer({
      apiBaseUrl: 'https://api.example.test',
      maxResponseBytes: 1024,
      fetchImplementation: oversizedFetch,
    });
    const oversizedResult = await oversizedServer.handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'zerotrace_health', arguments: {} },
    });

    expect(redirectResult?.result).toMatchObject({ isError: true });
    expect(oversizedResult?.result).toMatchObject({ isError: true });
  });

  it('returns protocol errors without exposing write methods', async () => {
    const server = createReadonlyMcpServer({
      apiBaseUrl: 'https://api.example.test',
      fetchImplementation: vi.fn<typeof fetch>(async () => jsonResponse({})),
    });

    const result = await server.handle({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'zerotrace_publish', arguments: {} },
    });

    expect(result?.error).toMatchObject({ code: -32602 });
  });
});
