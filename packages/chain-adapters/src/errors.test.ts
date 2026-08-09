import { describe, expect, it } from 'vitest';

import { ProviderError, toProviderError } from './errors.js';

describe('provider errors', () => {
  it('preserves provider error metadata and identity', () => {
    const cause = new Error('cause');
    const error = new ProviderError('HTTP_ERROR', 'failed', {
      retryable: true,
      statusCode: 503,
      cause,
    });
    expect(error).toMatchObject({
      name: 'ProviderError',
      code: 'HTTP_ERROR',
      retryable: true,
      statusCode: 503,
      cause,
    });
    expect(toProviderError(error)).toBe(error);
  });

  it('maps aborts to retryable timeouts and other throws to HTTP errors', () => {
    expect(toProviderError(new DOMException('aborted', 'AbortError'))).toMatchObject({
      code: 'TIMEOUT',
      retryable: true,
    });
    expect(toProviderError(new Error('socket failed'))).toMatchObject({
      code: 'HTTP_ERROR',
      retryable: true,
    });
    expect(new ProviderError('INVALID_RESPONSE', 'bad')).toMatchObject({
      retryable: false,
    });
  });
});
