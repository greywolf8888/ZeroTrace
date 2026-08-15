import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCP_PROTOCOL_VERSION = '2026-07-28';
const SERVER_NAME = 'zerotrace-readonly';
const SERVER_VERSION = '0.1.0';
const DEFAULT_API_URL = 'http://127.0.0.1:8080';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const MAX_INPUT_LINE_BYTES = 1_048_576;
const MAX_STRING_ARGUMENT_BYTES = 512;
const SAFE_SEGMENT = /^[A-Za-z0-9_.:-]{1,256}$/;
const EVIDENCE_ID = /^ev_[a-z0-9]{8,64}$/;
const CAMPAIGN_ID = /^cc_[a-z0-9]{8,64}$/;
const CASE_ID = /^fcb_[a-z0-9]{8,64}$/;
const LEDGERS = new Set(['EVM', 'BITCOIN', 'SOLANA']);

type JsonRpcId = string | number | null;

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties: false;
  };
}

interface ReadonlyMcpServerOptions {
  apiBaseUrl?: string;
  allowedApiHosts?: readonly string[];
  timeoutMs?: number;
  maxResponseBytes?: number;
  fetchImplementation?: typeof fetch;
}

interface ResolvedOptions {
  apiBaseUrl: URL;
  allowedApiHosts: ReadonlySet<string>;
  timeoutMs: number;
  maxResponseBytes: number;
  fetchImplementation: typeof fetch;
}

interface ToolCallResult {
  content: [{ type: 'text'; text: string }];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const readonlyMcpToolDefinitions: ToolDefinition[] = [
  {
    name: 'zerotrace_health',
    description:
      'Read ZeroTrace health, read-only mode, storage state, graph projection state, and provider availability. This tool performs one bounded GET request and never mutates state.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'zerotrace_capabilities',
    description:
      'Read the implementation and safety capability ledger. It does not unlock unavailable features or invoke provider writes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'zerotrace_search',
    description:
      'Search the durable local ZeroTrace projection by exact identifier or registered label. Results retain their Evidence and Knowledge-state fields.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', minLength: 1, maxLength: 256 },
        ledger: { type: 'string', enum: ['EVM', 'BITCOIN', 'SOLANA'] },
        chainId: { type: 'string', minLength: 1, maxLength: 64 },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['q'],
      additionalProperties: false,
    },
  },
  {
    name: 'zerotrace_subject',
    description:
      'Read one ledger subject snapshot from the provider-free API surface. Unknown and unavailable states are returned as-is.',
    inputSchema: {
      type: 'object',
      properties: {
        ledger: { type: 'string', enum: ['EVM', 'BITCOIN', 'SOLANA'] },
        id: { type: 'string', minLength: 1, maxLength: 256 },
        chainId: { type: 'string', minLength: 1, maxLength: 64 },
      },
      required: ['ledger', 'id'],
      additionalProperties: false,
    },
  },
  {
    name: 'zerotrace_evidence_drilldown',
    description:
      'Read one Evidence node and its restart-safe source traversal. This is a GET-only provider-free replay.',
    inputSchema: {
      type: 'object',
      properties: { evidenceId: { type: 'string', pattern: '^ev_[a-z0-9]{8,64}$' } },
      required: ['evidenceId'],
      additionalProperties: false,
    },
  },
  {
    name: 'zerotrace_campaign',
    description:
      'Read one immutable Control Campaign and its Evidence-bound result. No capture, monitor, or inference write is possible through this tool.',
    inputSchema: {
      type: 'object',
      properties: { campaignId: { type: 'string', pattern: '^cc_[a-z0-9]{8,64}$' } },
      required: ['campaignId'],
      additionalProperties: false,
    },
  },
  {
    name: 'zerotrace_case_export',
    description:
      'Read a content-addressed forensic case export for offline verification. The export endpoint is GET-only and cannot publish or alter a case.',
    inputSchema: {
      type: 'object',
      properties: { caseId: { type: 'string', pattern: '^fcb_[a-z0-9]{8,64}$' } },
      required: ['caseId'],
      additionalProperties: false,
    },
  },
];

export const READONLY_MCP_TOOLS: readonly ToolDefinition[] = Object.freeze(
  readonlyMcpToolDefinitions,
);

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(
  input: Record<string, unknown>,
  field: string,
  options: { required?: boolean; pattern?: RegExp; maxBytes?: number } = {},
): string | undefined {
  const value = input[field];
  if (value === undefined && options.required !== true) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string.`);
  }
  const normalized = value.trim();
  const maxBytes = options.maxBytes ?? MAX_STRING_ARGUMENT_BYTES;
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw new Error(`${field} exceeds the ${maxBytes}-byte limit.`);
  }
  if (options.pattern !== undefined && !options.pattern.test(normalized)) {
    throw new Error(`${field} has an invalid format.`);
  }
  return normalized;
}

function requiredString(
  input: Record<string, unknown>,
  field: string,
  options: { pattern?: RegExp; maxBytes?: number } = {},
): string {
  const value = stringValue(input, field, { ...options, required: true });
  if (value === undefined) throw new Error(`${field} must be provided.`);
  return value;
}

function assertKnownKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  toolName: string,
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(input).find((key) => !allowed.has(key));
  if (unknown !== undefined)
    throw new Error(`${toolName} does not accept the '${unknown}' argument.`);
}

function integerValue(input: Record<string, unknown>, field: string): number | undefined {
  const value = input[field];
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 50) {
    throw new Error(`${field} must be an integer from 1 through 50.`);
  }
  return value as number;
}

function ledgerValue(input: Record<string, unknown>): string | undefined {
  const ledger = stringValue(input, 'ledger', { maxBytes: 32 });
  if (ledger !== undefined && !LEDGERS.has(ledger)) throw new Error('ledger is not supported.');
  return ledger;
}

function queryString(entries: readonly [string, string | number | undefined][]): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== undefined) params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

function encodedSegment(value: string, field: string): string {
  if (!SAFE_SEGMENT.test(value)) throw new Error(`${field} has an invalid path format.`);
  return encodeURIComponent(value);
}

function resolvedOptions(options: ReadonlyMcpServerOptions): ResolvedOptions {
  const rawUrl = options.apiBaseUrl ?? process.env.ZEROTRACE_API_URL ?? DEFAULT_API_URL;
  const apiBaseUrl = new URL(rawUrl);
  if (!['http:', 'https:'].includes(apiBaseUrl.protocol)) {
    throw new Error('ZEROTRACE_API_URL must use HTTP or HTTPS.');
  }
  if (
    apiBaseUrl.username !== '' ||
    apiBaseUrl.password !== '' ||
    (apiBaseUrl.pathname !== '/' && apiBaseUrl.pathname !== '') ||
    apiBaseUrl.search !== '' ||
    apiBaseUrl.hash !== ''
  ) {
    throw new Error('ZEROTRACE_API_URL must be an origin without credentials or a path.');
  }
  const configuredHosts =
    options.allowedApiHosts ??
    (process.env.ZEROTRACE_MCP_ALLOWED_API_HOSTS ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value !== '');
  const allowedApiHosts = new Set(
    configuredHosts.length > 0 ? configuredHosts : [apiBaseUrl.hostname.toLowerCase()],
  );
  if (!allowedApiHosts.has(apiBaseUrl.hostname.toLowerCase())) {
    throw new Error('ZEROTRACE_API_URL host is not in ZEROTRACE_MCP_ALLOWED_API_HOSTS.');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new Error('MCP timeoutMs must be between 1 and 120000.');
  }
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < 1_024 ||
    maxResponseBytes > 16_777_216
  ) {
    throw new Error('MCP maxResponseBytes is outside the safe range.');
  }
  return {
    apiBaseUrl,
    allowedApiHosts,
    timeoutMs,
    maxResponseBytes,
    fetchImplementation: options.fetchImplementation ?? fetch,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Read-only MCP tool failed.';
}

function response(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id: JsonRpcId, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function initializeResult(requestedVersion: unknown): Record<string, unknown> {
  const version =
    typeof requestedVersion === 'string' && requestedVersion !== ''
      ? requestedVersion
      : MCP_PROTOCOL_VERSION;
  return {
    protocolVersion: version,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    instructions:
      'All exposed tools are read-only GET replays. They cannot sign, broadcast, publish, mutate, or access an arbitrary URL.',
  };
}

class ReadonlyApiClient {
  readonly #options: ResolvedOptions;

  constructor(options: ResolvedOptions) {
    this.#options = options;
  }

  async get(path: string): Promise<unknown> {
    if (!path.startsWith('/health') && !path.startsWith('/api/v1/')) {
      throw new Error('MCP attempted a path outside the read-only API allowlist.');
    }
    const url = new URL(path, this.#options.apiBaseUrl);
    if (
      url.origin !== this.#options.apiBaseUrl.origin ||
      !this.#options.allowedApiHosts.has(url.hostname.toLowerCase())
    ) {
      throw new Error('MCP attempted an API request outside the configured origin.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#options.timeoutMs);
    try {
      const result = await this.#options.fetchImplementation(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/json, text/plain' },
      });
      if (result.status >= 300 && result.status < 400) {
        throw new Error('MCP refuses API redirects.');
      }
      const declaredLength = Number(result.headers.get('content-length') ?? 0);
      if (Number.isFinite(declaredLength) && declaredLength > this.#options.maxResponseBytes) {
        throw new Error('API response exceeds the MCP response-size limit.');
      }
      const body = await result.text();
      if (Buffer.byteLength(body, 'utf8') > this.#options.maxResponseBytes) {
        throw new Error('API response exceeds the MCP response-size limit.');
      }
      let parsed: unknown = body;
      try {
        parsed = JSON.parse(body) as unknown;
      } catch {
        // A text export remains a valid read-only result.
      }
      if (!result.ok) {
        const detail = typeof parsed === 'string' ? parsed : JSON.stringify(parsed);
        throw new Error(`ZeroTrace API returned HTTP ${result.status}: ${detail.slice(0, 512)}`);
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createReadonlyMcpServer(options: ReadonlyMcpServerOptions = {}) {
  const api = new ReadonlyApiClient(resolvedOptions(options));

  async function callTool(name: string, rawArguments: unknown): Promise<ToolCallResult> {
    const input = objectValue(rawArguments ?? {}, 'arguments');
    const tool = READONLY_MCP_TOOLS.find((candidate) => candidate.name === name);
    if (tool === undefined) throw new Error(`Unknown read-only MCP tool: ${name}.`);
    assertKnownKeys(input, Object.keys(tool.inputSchema.properties), name);
    let path: string;
    switch (name) {
      case 'zerotrace_health':
        if (Object.keys(input).length !== 0)
          throw new Error('zerotrace_health takes no arguments.');
        path = '/health';
        break;
      case 'zerotrace_capabilities':
        if (Object.keys(input).length !== 0)
          throw new Error('zerotrace_capabilities takes no arguments.');
        path = '/api/v1/capabilities';
        break;
      case 'zerotrace_search': {
        const q = requiredString(input, 'q', { maxBytes: 256 });
        const ledger = ledgerValue(input);
        const chainId = stringValue(input, 'chainId', { maxBytes: 64 });
        const limit = integerValue(input, 'limit');
        path = `/api/v1/search${queryString([
          ['q', q],
          ['ledger', ledger],
          ['chainId', chainId],
          ['limit', limit],
        ])}`;
        break;
      }
      case 'zerotrace_subject': {
        const ledger = ledgerValue(input);
        if (ledger === undefined) throw new Error('ledger is required.');
        const id = requiredString(input, 'id', { maxBytes: 256 });
        const chainId = stringValue(input, 'chainId', { maxBytes: 64 });
        path = `/api/v1/subjects/${encodedSegment(ledger, 'ledger')}/${encodedSegment(id, 'id')}${queryString([['chainId', chainId]])}`;
        break;
      }
      case 'zerotrace_evidence_drilldown': {
        const evidenceId = requiredString(input, 'evidenceId', {
          pattern: EVIDENCE_ID,
        });
        path = `/api/v1/evidence/${encodedSegment(evidenceId, 'evidenceId')}/drilldown`;
        break;
      }
      case 'zerotrace_campaign': {
        const campaignId = requiredString(input, 'campaignId', {
          pattern: CAMPAIGN_ID,
        });
        path = `/api/v1/control/campaigns/${encodedSegment(campaignId, 'campaignId')}`;
        break;
      }
      case 'zerotrace_case_export': {
        const caseId = requiredString(input, 'caseId', { pattern: CASE_ID });
        path = `/api/v1/forensics/cases/${encodedSegment(caseId, 'caseId')}/export`;
        break;
      }
      default:
        throw new Error(`Unknown read-only MCP tool: ${name}.`);
    }
    const data = await api.get(path);
    const structuredContent =
      typeof data === 'object' && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : undefined;
    return {
      content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }],
      ...(structuredContent === undefined ? {} : { structuredContent }),
    };
  }

  async function handle(request: unknown): Promise<JsonRpcResponse | undefined> {
    const parsed = objectValue(request, 'JSON-RPC request');
    if (parsed.jsonrpc !== '2.0' || typeof parsed.method !== 'string') {
      return errorResponse(null, -32600, 'Invalid JSON-RPC request.');
    }
    const idValue = parsed.id;
    if (
      idValue !== undefined &&
      idValue !== null &&
      typeof idValue !== 'string' &&
      typeof idValue !== 'number'
    ) {
      return errorResponse(null, -32600, 'JSON-RPC id must be a string, number, or null.');
    }
    const id = (idValue ?? null) as JsonRpcId;
    if (idValue === undefined && parsed.method.startsWith('notifications/')) return undefined;
    try {
      switch (parsed.method) {
        case 'initialize': {
          const params = parsed.params === undefined ? {} : objectValue(parsed.params, 'params');
          return response(id, initializeResult(params.protocolVersion));
        }
        case 'server/discover':
          return response(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            capabilities: { tools: { listChanged: false } },
          });
        case 'notifications/initialized':
          return idValue === undefined ? undefined : response(id, null);
        case 'ping':
          return response(id, {});
        case 'tools/list':
          return response(id, { tools: READONLY_MCP_TOOLS, nextCursor: undefined });
        case 'tools/call': {
          const params = objectValue(parsed.params, 'params');
          const name = stringValue(params, 'name', { required: true, maxBytes: 128 });
          if (name === undefined) throw new Error('params.name is required.');
          if (!READONLY_MCP_TOOLS.some((tool) => tool.name === name)) {
            return errorResponse(id, -32602, `Unknown tool: ${name}.`);
          }
          try {
            return response(id, await callTool(name, params.arguments));
          } catch (error) {
            const message = errorMessage(error);
            return response(id, {
              content: [{ type: 'text', text: message }],
              isError: true,
            });
          }
        }
        default:
          return errorResponse(id, -32601, `Method not found: ${parsed.method}.`);
      }
    } catch (error) {
      return errorResponse(id, -32602, errorMessage(error));
    }
  }

  return { handle };
}

export async function runReadonlyMcpStdioServer(
  options: ReadonlyMcpServerOptions = {},
): Promise<void> {
  const server = createReadonlyMcpServer(options);
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (Buffer.byteLength(line, 'utf8') > MAX_INPUT_LINE_BYTES) {
      process.stdout.write(
        `${JSON.stringify(errorResponse(null, -32600, 'Request is too large.'))}\n`,
      );
      continue;
    }
    let message: unknown;
    try {
      message = JSON.parse(line) as unknown;
    } catch {
      process.stdout.write(`${JSON.stringify(errorResponse(null, -32700, 'Invalid JSON.'))}\n`);
      continue;
    }
    const result = await server.handle(message);
    if (result !== undefined) process.stdout.write(`${JSON.stringify(result)}\n`);
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  await runReadonlyMcpStdioServer();
}
