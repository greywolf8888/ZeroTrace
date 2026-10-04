import { LedgerError } from './types.js';

export function classifyLiveError(
  error: unknown,
  depth = 0,
): {
  status: string;
  category: string;
  code: string;
} {
  const failure = error as
    { code?: string; name?: string; statusCode?: number; cause?: unknown } | undefined;
  const code = typeof failure?.code === 'string' ? failure.code : 'INTERNAL_ERROR';
  if (code === 'ERR_ASSERTION' || failure?.name === 'AssertionError')
    return { status: 'FAIL_LOCAL', category: 'ASSERTION_FAILED', code };
  if (
    error instanceof LedgerError &&
    (error.status === 409 || /CONFLICT|VERSION|LOCK_INVALID/.test(code))
  )
    return { status: 'FAIL_CONFLICT_OR_VERSION', category: 'CONFLICT_OR_VERSION', code };
  if (
    code === 'PRIVATE_NETWORK_BLOCKED' ||
    [
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'UND_ERR_CONNECT_TIMEOUT',
    ].includes(code) ||
    [401, 403].includes(failure?.statusCode ?? 0)
  )
    return { status: 'BLOCKED_EXTERNAL', category: 'NETWORK_OR_AUTH_BLOCKED', code };
  if (
    [
      'TIMEOUT',
      'RATE_LIMITED',
      'CIRCUIT_OPEN',
      'FINALITY_UNAVAILABLE',
      'BLOCK_UNAVAILABLE',
      'RECEIPT_UNAVAILABLE',
    ].includes(code) ||
    [429, 500, 502, 503, 504].includes(failure?.statusCode ?? 0)
  )
    return { status: 'BLOCKED_EXTERNAL', category: 'DEPENDENCY_UNAVAILABLE', code };
  if (code === 'INVALID_RESPONSE' || code === 'RPC_ERROR')
    return { status: 'FAIL_CONFLICT_OR_VERSION', category: 'SOURCE_RESPONSE_UNSUPPORTED', code };
  if (failure?.cause && failure.cause !== error && depth < 5) {
    const nested = classifyLiveError(failure.cause, depth + 1);
    if (nested.status === 'BLOCKED_EXTERNAL') return nested;
  }
  return { status: 'FAIL_LOCAL', category: 'INTERNAL_ERROR', code };
}
