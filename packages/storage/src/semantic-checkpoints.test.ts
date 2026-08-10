import { describe, expect, it, vi } from 'vitest';

import { hashPayload } from '@zerotrace/evidence';

import {
  PostgresSemanticScanCheckpointRepository,
  type SemanticScanRun,
} from './semantic-checkpoints.js';

const scanId = '11111111-1111-4111-8111-111111111111';
const evidenceA = `ev_${'a'.repeat(24)}`;
const evidenceB = `ev_${'b'.repeat(24)}`;
const identity = {
  adapter: 'flap-origin-v1',
  finalizedHead: 1_000,
  platformConfigHash: 'c'.repeat(64),
};

function row(
  overrides: Partial<{
    status: SemanticScanRun['status'];
    nextBlock: number;
    state: SemanticScanRun['state'];
    evidenceIds: string[];
    lastErrorCode: string | null;
    completedAt: Date | null;
    identityHash: string;
  }> = {},
): Record<string, unknown> {
  const state = overrides.state ?? { creations: [] };
  return {
    id: scanId,
    scan_type: 'FLAP_CONTRACT_ORIGIN',
    source: 'sqd:bsc-mainnet',
    ledger: 'EVM',
    chain_id: '56',
    subject: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
    from_block: '0',
    to_block: '19',
    chunk_size: 10,
    identity_hash: overrides.identityHash ?? hashPayload(identity),
    identity,
    status: overrides.status ?? 'RUNNING',
    next_block: String(overrides.nextBlock ?? 0),
    state_hash: hashPayload(state),
    state,
    evidence_ids: overrides.evidenceIds ?? [],
    last_error_code: overrides.lastErrorCode ?? null,
    started_at: new Date('2026-08-10T00:00:00.000Z'),
    updated_at: new Date('2026-08-10T00:00:01.000Z'),
    completed_at: overrides.completedAt ?? null,
  };
}

function poolWith(
  query: (
    text: string,
    values?: readonly unknown[],
  ) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }>,
) {
  return {
    query: vi.fn(query),
    end: vi.fn(async () => undefined),
  };
}

const beginInput = {
  scanType: 'FLAP_CONTRACT_ORIGIN',
  source: 'sqd:bsc-mainnet',
  ledger: 'EVM' as const,
  chainId: '56',
  subject: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
  fromBlock: 0,
  toBlock: 19,
  chunkSize: 10,
  identity,
  initialState: { creations: [] },
  startedAt: '2026-08-10T00:00:00.000Z',
};

describe('PostgreSQL semantic scan checkpoints', () => {
  it('resumes an identity and advances contiguous state to an immutable completion', async () => {
    const firstChunk = row({
      nextBlock: 10,
      state: { creations: [{ block: 4 }] },
      evidenceIds: [evidenceA],
    });
    const failed = {
      ...firstChunk,
      last_error_code: 'PROVIDER_DOWN',
    };
    const completed = row({
      status: 'REQUESTED_RANGE_COMPLETE',
      nextBlock: 20,
      state: { creations: [{ block: 4 }] },
      evidenceIds: [evidenceA, evidenceB],
      completedAt: new Date('2026-08-10T00:01:00.000Z'),
    });
    const secondChunk = row({
      nextBlock: 20,
      state: { creations: [{ block: 4 }] },
      evidenceIds: [evidenceA, evidenceB],
    });
    const responses = [
      { rows: [], rowCount: 1 },
      { rows: [row()], rowCount: 1 },
      { rows: [{ id: scanId }], rowCount: 1 },
      { rows: [firstChunk], rowCount: 1 },
      { rows: [{ id: scanId }], rowCount: 1 },
      { rows: [failed], rowCount: 1 },
      { rows: [{ id: scanId }], rowCount: 1 },
      { rows: [secondChunk], rowCount: 1 },
      { rows: [{ id: scanId }], rowCount: 1 },
      { rows: [completed], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [completed], rowCount: 1 },
    ];
    const pool = poolWith(async () => responses.shift() ?? { rows: [], rowCount: 0 });
    const repository = PostgresSemanticScanCheckpointRepository.fromPool(pool);

    const started = await repository.begin(beginInput);
    expect(started).toMatchObject({ status: 'RUNNING', nextBlock: 0, state: { creations: [] } });
    const advanced = await repository.advance(scanId, {
      expectedNextBlock: 0,
      completedToBlock: 9,
      state: { creations: [{ block: 4 }] },
      evidenceIds: [evidenceA],
    });
    expect(advanced).toMatchObject({ nextBlock: 10, evidenceIds: [evidenceA] });
    await expect(repository.recordFailure(scanId, 'PROVIDER_DOWN')).resolves.toMatchObject({
      lastErrorCode: 'PROVIDER_DOWN',
      nextBlock: 10,
    });
    await repository.advance(scanId, {
      expectedNextBlock: 10,
      completedToBlock: 19,
      state: { creations: [{ block: 4 }] },
      evidenceIds: [evidenceB, evidenceA, evidenceB],
    });
    const finished = await repository.finish(scanId);
    expect(finished).toMatchObject({
      status: 'REQUESTED_RANGE_COMPLETE',
      nextBlock: 20,
      evidenceIds: [evidenceA, evidenceB],
      completedAt: expect.any(String),
    });
    await expect(
      repository.advance(scanId, {
        expectedNextBlock: 10,
        completedToBlock: 19,
        state: { creations: [{ block: 4 }] },
        evidenceIds: [evidenceA, evidenceB],
      }),
    ).resolves.toEqual(finished);

    expect(pool.query.mock.calls[2]?.[0]).toContain('$3::numeric < next_block + chunk_size');
    await repository.close();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('rejects stale, missing, and prematurely completed cursors', async () => {
    const running = row({ nextBlock: 10, evidenceIds: [evidenceA] });
    const responses = [
      { rows: [], rowCount: 0 },
      { rows: [running], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [running], rowCount: 1 },
      { rows: [], rowCount: 0 },
      { rows: [], rowCount: 0 },
    ];
    const repository = PostgresSemanticScanCheckpointRepository.fromPool(
      poolWith(async () => responses.shift() ?? { rows: [], rowCount: 0 }),
    );

    await expect(
      repository.advance(scanId, {
        expectedNextBlock: 0,
        completedToBlock: 9,
        state: { creations: [{ block: 9 }] },
        evidenceIds: [evidenceA],
      }),
    ).rejects.toMatchObject({ code: 'SEMANTIC_CHECKPOINT_CONFLICT' });
    await expect(repository.finish(scanId)).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_CONFLICT',
    });
    await expect(repository.recordFailure(scanId, 'PROVIDER_DOWN')).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_NOT_FOUND',
    });
  });

  it('fails closed on corrupted payload hashes and unavailable storage', async () => {
    const corrupted = PostgresSemanticScanCheckpointRepository.fromPool(
      poolWith(async () => ({
        rows: [row({ identityHash: 'f'.repeat(64) })],
        rowCount: 1,
      })),
    );
    await expect(corrupted.get(scanId)).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_CONFLICT',
    });

    const unavailable = PostgresSemanticScanCheckpointRepository.fromPool(
      poolWith(async () => Promise.reject(new Error('credential-bearing failure'))),
    );
    await expect(unavailable.get(scanId)).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_UNAVAILABLE',
      retryable: true,
      message: 'Semantic scan read failed.',
    });
    const health = await unavailable.health();
    expect(health).toMatchObject({
      status: 'DOWN',
      errorCode: 'SEMANTIC_CHECKPOINT_UNAVAILABLE',
    });
    expect(JSON.stringify(health)).not.toContain('credential-bearing failure');
  });

  it('distinguishes missing schema from an initialized durable store', async () => {
    const initialized = PostgresSemanticScanCheckpointRepository.fromPool(
      poolWith(async () => ({
        rows: [{ table_name: 'semantic_scan_runs', migration_applied: true }],
        rowCount: 1,
      })),
    );
    await expect(initialized.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
    });

    const missing = PostgresSemanticScanCheckpointRepository.fromPool(
      poolWith(async () => ({
        rows: [{ table_name: null, migration_applied: false }],
        rowCount: 1,
      })),
    );
    await expect(missing.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'SEMANTIC_CHECKPOINT_NOT_INITIALIZED',
    });
  });

  it('validates identities, JSON state, Evidence IDs, ranges, timestamps, and scan IDs', async () => {
    const pool = poolWith(async () => ({ rows: [], rowCount: 0 }));
    const repository = PostgresSemanticScanCheckpointRepository.fromPool(pool);

    await expect(repository.begin({ ...beginInput, identity: [] as never })).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_INVALID',
    });
    await expect(
      repository.begin({ ...beginInput, initialState: new Date() as never }),
    ).rejects.toMatchObject({ code: 'SEMANTIC_CHECKPOINT_INVALID' });
    await expect(
      repository.begin({ ...beginInput, startedAt: 'not-a-time' }),
    ).rejects.toMatchObject({ code: 'SEMANTIC_CHECKPOINT_INVALID' });
    await expect(repository.begin({ ...beginInput, chunkSize: 0 })).rejects.toThrow(RangeError);
    await expect(
      repository.advance(scanId, {
        expectedNextBlock: 0,
        completedToBlock: 0,
        state: {},
        evidenceIds: ['not-evidence'],
      }),
    ).rejects.toMatchObject({ code: 'SEMANTIC_CHECKPOINT_INVALID' });
    await expect(repository.get('not-a-uuid')).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_INVALID',
    });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
