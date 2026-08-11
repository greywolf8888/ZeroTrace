import { describe, expect, it } from 'vitest';

import { loadActionCaptureWorkerConfig } from './action-capture-config.js';

const env = {
  POSTGRES_URL: 'postgresql://zerotrace:secret@database.example/zerotrace',
  CLICKHOUSE_URL: 'http://clickhouse:8123',
  CLICKHOUSE_USERNAME: 'default',
  CLICKHOUSE_PASSWORD: 'secret',
};

describe('Action Semantics capture worker config', () => {
  it('loads a bounded read-only worker config', () => {
    expect(loadActionCaptureWorkerConfig(env, ['--once'])).toMatchObject({
      clickhouseUrl: 'http://clickhouse:8123',
      clickhouseUsername: 'default',
      pollIntervalMs: 5_000,
      leaseSeconds: 300,
      batchSize: 10,
      once: true,
    });
  });

  it('rejects write-like flags, unsafe URLs, and invalid bounds', () => {
    expect(() => loadActionCaptureWorkerConfig(env, ['--private-key'])).toThrow(
      'Unknown Action Semantics capture argument',
    );
    expect(() =>
      loadActionCaptureWorkerConfig(
        { ...env, CLICKHOUSE_URL: 'http://user:secret@clickhouse:8123' },
        [],
      ),
    ).toThrow('without embedded credentials');
    expect(() =>
      loadActionCaptureWorkerConfig({ ...env, CAPTURE_WORKER_BATCH_SIZE: '101' }, []),
    ).toThrow('between 1 and 100');
  });
});
