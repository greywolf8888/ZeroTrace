import { describe, expect, it } from 'vitest';

import { publicWorkerError } from './errors.js';

describe('semantic worker public errors', () => {
  it('returns a safe nested error code and preserves retryability', () => {
    expect(
      publicWorkerError({
        code: 'FLAP_ORIGIN_FAILED',
        retryable: true,
        cause: { code: 'HTTP_ERROR' },
      }),
    ).toEqual({ code: 'HTTP_ERROR', retryable: true });
  });

  it('never exposes messages, URLs, or credentials', () => {
    const safe = publicWorkerError(
      Object.assign(new Error('postgresql://user:secret@database.example/zerotrace'), {
        code: 'bad code https://provider.example/private',
      }),
    );
    expect(safe).toEqual({ code: 'FLAP_ORIGIN_FAILED', retryable: false });
    expect(JSON.stringify(safe)).not.toMatch(/secret|provider\.example|database\.example/);
  });
});
