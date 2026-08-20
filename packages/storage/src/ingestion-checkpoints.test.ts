import { describe, expect, it, vi } from 'vitest';

import { PostgresIngestionCheckpointRepository } from './ingestion-checkpoints.js';

const row = {
  id: '11111111-1111-4111-8111-111111111111',
  source: 'sqd:binance-mainnet',
  dataset: 'binance-mainnet',
  ledger: 'EVM',
  chain_id: '56',
  from_block: '40',
  to_block: '50',
  query_hash: 'a'.repeat(64),
  query: {
    schema: 'sqd-finalized-ingestion-v4',
    dataset: 'binance-mainnet',
    materialize: { transactions: true, logs: true, traces: true, stateDiffs: true },
  },
  status: 'REQUESTED_RANGE_COMPLETE',
  next_block: '51',
  last_block: '50',
  last_error_code: null,
  started_at: '2026-08-12T00:00:00.000Z',
  updated_at: '2026-08-12T00:01:00.000Z',
  completed_at: '2026-08-12T00:01:00.000Z',
};

describe('PostgresIngestionCheckpointRepository completed coverage', () => {
  it('finds a terminal range that advanced past the requested Snapshot position', async () => {
    const query = vi.fn(async () => ({ rows: [row], rowCount: 1 }));
    const repository = PostgresIngestionCheckpointRepository.fromPool({
      query,
      end: vi.fn(),
    });

    await expect(
      repository.findCompletedCoverage({
        source: 'sqd:binance-mainnet',
        dataset: 'binance-mainnet',
        ledger: 'EVM',
        chainId: '56',
        position: 42,
        queryHash: 'a'.repeat(64),
      }),
    ).resolves.toMatchObject({ status: 'REQUESTED_RANGE_COMPLETE', nextBlock: 51 });
    expect((query.mock.calls[0] as unknown as [string, unknown[]])[1]).toEqual([
      'sqd:binance-mainnet',
      'binance-mainnet',
      'EVM',
      '56',
      42,
      'a'.repeat(64),
    ]);
  });

  it('returns absence without inventing coverage and rejects malformed identity', async () => {
    const repository = PostgresIngestionCheckpointRepository.fromPool({
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      end: vi.fn(),
    });
    await expect(
      repository.findCompletedCoverage({
        source: 'sqd:bitcoin-mainnet',
        dataset: 'bitcoin-mainnet',
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        position: 42,
        queryHash: 'b'.repeat(64),
      }),
    ).resolves.toBeUndefined();
    await expect(
      repository.findCompletedCoverage({
        source: '',
        dataset: 'bitcoin-mainnet',
        ledger: 'BITCOIN',
        chainId: 'bitcoin-mainnet',
        position: 42,
        queryHash: 'not-a-hash',
      }),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_INVALID', retryable: false });
  });
});

function beginInput() {
  return {
    source: 'sqd:binance-mainnet',
    dataset: 'binance-mainnet',
    ledger: 'EVM' as const,
    chainId: '56',
    fromBlock: 40,
    toBlock: 50,
    query: {
      schema: 'sqd-finalized-ingestion-v4',
      dataset: 'binance-mainnet',
      materialize: { transactions: true, logs: true, traces: true, stateDiffs: true },
    },
    startedAt: '2026-08-12T00:00:00.000Z',
  };
}

function runningRow(overrides: Record<string, unknown> = {}) {
  return {
    ...row,
    status: 'RUNNING',
    next_block: '40',
    last_block: null,
    last_error_code: null,
    completed_at: null,
    started_at: new Date('2026-08-12T00:00:00.000Z'),
    updated_at: new Date('2026-08-12T00:00:00.000Z'),
    ...overrides,
  };
}

describe('Postgres ingestion checkpoint writes', () => {
  it('rejects invalid database URLs without opening a durable session', () => {
    expect(
      () => new PostgresIngestionCheckpointRepository({ connectionString: 'not-a-url' }),
    ).toThrow(/Checkpoint database URL is invalid/);
    expect(
      () =>
        new PostgresIngestionCheckpointRepository({
          connectionString: 'mysql://zerotrace@127.0.0.1/zerotrace',
        }),
    ).toThrow(/PostgreSQL/);
  });

  it('starts, advances, finishes, and records failures without inventing missing runs', async () => {
    const constructed = new PostgresIngestionCheckpointRepository({
      connectionString: 'postgresql://zerotrace:secret@127.0.0.1:1/zerotrace',
      connectionTimeoutMs: 50,
      statementTimeoutMs: 50,
      maxConnections: 1,
    });
    await constructed.close();

    const input = beginInput();
    const query = vi.fn(async (text: string) => {
      if (text.includes('INSERT INTO ingestion_runs')) return { rows: [], rowCount: 1 };
      if (text.includes('UPDATE ingestion_runs') && text.includes('RETURNING id')) {
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (text.includes('FROM ingestion_runs')) {
        if (text.includes('WHERE id =') && text.includes('22222222')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [runningRow()], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = PostgresIngestionCheckpointRepository.fromPool({
      query,
      end: vi.fn(async () => undefined),
    });
    await expect(repository.begin(input)).resolves.toMatchObject({
      status: 'RUNNING',
      fromBlock: 40,
      toBlock: 50,
    });
    await expect(repository.get(row.id)).resolves.toMatchObject({ id: row.id });
    await expect(repository.advance(row.id, 45)).resolves.toMatchObject({ status: 'RUNNING' });
    await expect(repository.finish(row.id, 'REQUESTED_RANGE_COMPLETE', 51)).resolves.toMatchObject({
      status: 'RUNNING',
    });
    await expect(repository.recordFailure(row.id, 'SOURCE_TIMEOUT')).resolves.toMatchObject({
      status: 'RUNNING',
    });
    await expect(repository.recordFailure(row.id, '   ')).rejects.toMatchObject({
      code: 'CHECKPOINT_INVALID',
    });
    await expect(repository.begin({ ...input, toBlock: 10 })).rejects.toThrow(/toBlock/);
    await expect(repository.begin({ ...input, source: '  ' })).rejects.toMatchObject({
      code: 'CHECKPOINT_INVALID',
    });
  });

  it('maps missing, conflict, and unavailable checkpoint states without coercing them to complete', async () => {
    await expect(
      PostgresIngestionCheckpointRepository.fromPool({
        query: vi.fn(async (text: string) => {
          if (text.includes('INSERT')) return { rows: [], rowCount: 1 };
          if (text.includes('FROM ingestion_runs')) return { rows: [], rowCount: 0 };
          throw new Error(`Unexpected SQL: ${text}`);
        }),
        end: vi.fn(),
      }).begin(beginInput()),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });

    await expect(
      PostgresIngestionCheckpointRepository.fromPool({
        query: vi.fn(async (text: string) => {
          if (text.includes('INSERT')) return { rows: [], rowCount: 1 };
          if (text.includes('FROM ingestion_runs')) {
            return { rows: [runningRow({ chain_id: '1' })], rowCount: 1 };
          }
          throw new Error(`Unexpected SQL: ${text}`);
        }),
        end: vi.fn(),
      }).begin(beginInput()),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_CONFLICT' });

    const down = PostgresIngestionCheckpointRepository.fromPool({
      query: vi.fn(async () => {
        throw new Error('down');
      }),
      end: vi.fn(),
    });
    await expect(down.begin(beginInput())).rejects.toMatchObject({
      code: 'CHECKPOINT_UNAVAILABLE',
    });
    await expect(down.get(row.id)).rejects.toMatchObject({ code: 'CHECKPOINT_UNAVAILABLE' });
    await expect(
      down.findCompletedCoverage({
        source: 'sqd:binance-mainnet',
        dataset: 'binance-mainnet',
        ledger: 'EVM',
        chainId: '56',
        position: 42,
        queryHash: 'a'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_UNAVAILABLE' });

    await expect(
      PostgresIngestionCheckpointRepository.fromPool({
        query: vi.fn(async (text: string) => {
          if (text.includes('UPDATE')) return { rows: [], rowCount: 0 };
          if (text.includes('WHERE id =')) return { rows: [], rowCount: 0 };
          throw new Error(`Unexpected SQL: ${text}`);
        }),
        end: vi.fn(),
      }).advance(row.id, 41),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_NOT_FOUND' });

    await expect(
      PostgresIngestionCheckpointRepository.fromPool({
        query: vi.fn(async (text: string) => {
          if (text.includes('UPDATE')) return { rows: [], rowCount: 0 };
          if (text.includes('WHERE id =')) {
            return { rows: [{ ...row, status: 'REQUESTED_RANGE_COMPLETE' }], rowCount: 1 };
          }
          throw new Error(`Unexpected SQL: ${text}`);
        }),
        end: vi.fn(),
      }).advance(row.id, 41),
    ).resolves.toMatchObject({ status: 'REQUESTED_RANGE_COMPLETE' });

    await expect(
      PostgresIngestionCheckpointRepository.fromPool({
        query: vi.fn(async () => ({ rows: [{ ...row, query: 'not-json-object' }], rowCount: 1 })),
        end: vi.fn(),
      }).get(row.id),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_CONFLICT' });

    await expect(
      PostgresIngestionCheckpointRepository.fromPool({
        query: vi.fn(async () => ({ rows: [{ ...row, status: 'LEASED' }], rowCount: 1 })),
        end: vi.fn(),
      }).get(row.id),
    ).rejects.toMatchObject({ code: 'CHECKPOINT_CONFLICT' });

    const healthy = PostgresIngestionCheckpointRepository.fromPool({
      query: vi.fn(async () => ({
        rows: [{ table_name: 'ingestion_runs', migration_applied: true }],
        rowCount: 1,
      })),
      end: vi.fn(async () => undefined),
    });
    await expect(healthy.health()).resolves.toMatchObject({ status: 'UP', durable: true });
    await healthy.close();
    await expect(
      PostgresIngestionCheckpointRepository.fromPool({
        query: vi.fn(async () => ({
          rows: [{ table_name: null, migration_applied: false }],
          rowCount: 1,
        })),
        end: vi.fn(),
      }).health(),
    ).resolves.toMatchObject({ errorCode: 'CHECKPOINT_NOT_INITIALIZED' });
    await expect(
      PostgresIngestionCheckpointRepository.fromPool({
        query: vi.fn(async () => {
          throw new Error('down');
        }),
        end: vi.fn(),
      }).health(),
    ).resolves.toMatchObject({ errorCode: 'CHECKPOINT_UNAVAILABLE' });
  });
});
