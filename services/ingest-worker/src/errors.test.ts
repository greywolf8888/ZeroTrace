import { describe, expect, it } from 'vitest';

import { publicWorkerError } from './errors.js';

describe('ingest worker public errors', () => {
  it('surfaces a safe actionable cause through a generic pipeline wrapper', () => {
    const cause = Object.assign(new Error('private detail'), {
      code: 'PRIVATE_NETWORK_BLOCKED',
      retryable: false,
    });
    const wrapped = Object.assign(new Error('Finalized ingestion failed.'), {
      code: 'INGESTION_FAILED',
      retryable: false,
      cause,
    });

    expect(publicWorkerError(wrapped)).toEqual({
      code: 'PRIVATE_NETWORK_BLOCKED',
      retryable: false,
    });
  });

  it('preserves retryability collected from safe wrapper layers', () => {
    const wrapped = Object.assign(new Error('Finalized ingestion failed.'), {
      code: 'INGESTION_FAILED',
      retryable: true,
      cause: Object.assign(new Error('database unavailable'), {
        code: 'CLICKHOUSE_UNAVAILABLE',
      }),
    });

    expect(publicWorkerError(wrapped)).toEqual({
      code: 'CLICKHOUSE_UNAVAILABLE',
      retryable: true,
    });
  });

  it('does not expose arbitrary error text or malformed codes', () => {
    expect(
      publicWorkerError(
        Object.assign(new Error('secret detail'), { code: 'bad secret-bearing code' }),
      ),
    ).toEqual({ code: 'INGESTION_FAILED', retryable: false });
  });
});
