export type ProviderErrorCode =
  | 'INVALID_PROVIDER_URL'
  | 'PROVIDER_HOST_NOT_ALLOWED'
  | 'PRIVATE_NETWORK_BLOCKED'
  | 'REDIRECT_BLOCKED'
  | 'METHOD_NOT_ALLOWED'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'RPC_ERROR'
  | 'CHAIN_MISMATCH';

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    code: ProviderErrorCode,
    message: string,
    options: { retryable?: boolean; statusCode?: number; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.statusCode !== undefined) this.statusCode = options.statusCode;
  }
}

export function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new ProviderError('TIMEOUT', 'Provider request timed out.', {
      retryable: true,
      cause: error,
    });
  }
  return new ProviderError('HTTP_ERROR', 'Provider request failed.', {
    retryable: true,
    cause: error,
  });
}
