import { ProviderError, toProviderError } from './errors.js';
import { assertProviderUrlSafe, type ProviderUrlPolicy } from './security.js';

export type FetchImplementation = typeof fetch;

export interface JsonRpcTransport {
  readonly endpointId: string;
  request<T>(method: string, params?: readonly unknown[]): Promise<T>;
}

export interface RestTransport {
  readonly endpointId: string;
  getText(path: string): Promise<string>;
  getJson<T>(path: string): Promise<T>;
}

interface TransportOptions {
  endpointId: string;
  baseUrl: string;
  policy: ProviderUrlPolicy;
  timeoutMs: number;
  maxResponseBytes?: number;
  fetchImplementation?: FetchImplementation;
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
    if (response.status === 429) {
      throw new ProviderError('RATE_LIMITED', 'Provider rate limit exceeded.', {
        retryable: true,
        statusCode: response.status,
      });
    }
    if (!response.ok) {
      throw new ProviderError('HTTP_ERROR', `Provider returned HTTP ${response.status}.`, {
        retryable: response.status >= 500,
        statusCode: response.status,
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

export class SafeJsonRpcTransport implements JsonRpcTransport {
  readonly endpointId: string;
  readonly #options: TransportOptions;
  #requestId = 0;

  constructor(options: TransportOptions) {
    this.endpointId = options.endpointId;
    this.#options = options;
  }

  async request<T>(method: string, params: readonly unknown[] = []): Promise<T> {
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
      throw new ProviderError('RPC_ERROR', message, { retryable: false });
    }
    if (!('result' in response)) {
      throw new ProviderError('INVALID_RESPONSE', 'Provider response is missing a result field.');
    }
    return response.result as T;
  }
}

export class SafeRestTransport implements RestTransport {
  readonly endpointId: string;
  readonly #options: TransportOptions;

  constructor(options: TransportOptions) {
    this.endpointId = options.endpointId;
    this.#options = options;
  }

  getText(path: string): Promise<string> {
    return fetchSafely(this.#options, { method: 'GET' }, path);
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
