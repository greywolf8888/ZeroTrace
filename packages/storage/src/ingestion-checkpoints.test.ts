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
