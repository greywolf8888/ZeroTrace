import { describe, expect, it, vi } from 'vitest';

import { createEvidence } from '@zerotrace/evidence';

import {
  PostgresEvidenceRepository,
  StorageError,
  type DatabaseClient,
  type DatabasePool,
} from './index.js';

function pool(overrides: Partial<DatabasePool> = {}): DatabasePool {
  return {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(async () => {
      throw new Error('not connected');
    }),
    end: vi.fn(async () => undefined),
    ...overrides,
  };
}

const rawEvidence = createEvidence({
  ledger: 'EVM',
  chainId: 'eip155:1',
  kind: 'ACCOUNT_STATE',
  source: 'test@provider.example',
  locator: 'address:0xabc@1',
  payload: { balance: '1' },
  observedAt: '2026-08-09T00:00:00.000Z',
  blockOrSlot: '1',
  summary: 'Storage unit fixture.',
});

const evmSnapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:1',
  blockNumber: '1',
  blockHash: '0x' + 'a'.repeat(64),
  finality: 'finalized' as const,
  capturedAt: '2026-08-09T00:00:00.000Z',
  providerVersions: { fixture: '1' },
  adapterVersions: { evm: '0.1.0' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'none',
};

describe('PostgreSQL Evidence repository boundaries', () => {
  it('reports an initialized and an uninitialized database distinctly', async () => {
    const query = vi.fn(async (text: string) =>
      text.includes('schema_migrations')
        ? { rows: [{ migration_applied: true }], rowCount: 1 }
        : {
            rows: [
              {
                evidence_table: 'evidence',
                evidence_edges_table: 'evidence_edges',
                snapshots_table: 'analysis_snapshots',
              },
            ],
            rowCount: 1,
          },
    );
    const initialized = new PostgresEvidenceRepository(
      pool({
        query,
      }),
    );
    await expect(initialized.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
    });

    const uninitialized = new PostgresEvidenceRepository(pool());
    await expect(uninitialized.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'STORAGE_NOT_INITIALIZED',
    });

    const missingMigration = new PostgresEvidenceRepository(
      pool({
        query: vi.fn(async (text) =>
          text.includes('schema_migrations')
            ? { rows: [{ migration_applied: false }], rowCount: 1 }
            : {
                rows: [
                  {
                    evidence_table: 'evidence',
                    evidence_edges_table: 'evidence_edges',
                    snapshots_table: 'analysis_snapshots',
                  },
                ],
                rowCount: 1,
              },
        ),
      }),
    );
    await expect(missingMigration.health()).resolves.toMatchObject({
      status: 'DOWN',
      errorCode: 'STORAGE_NOT_INITIALIZED',
    });
  });

  it('reports connection failures without exposing their cause', async () => {
    const repository = new PostgresEvidenceRepository(
      pool({ query: vi.fn(async () => Promise.reject(new Error('credential-bearing cause'))) }),
    );
    const health = await repository.health();
    expect(health).toMatchObject({ status: 'DOWN', errorCode: 'STORAGE_UNAVAILABLE' });
    expect(JSON.stringify(health)).not.toContain('credential-bearing cause');
  });

  it('rejects a non-canonical Evidence ID before opening a connection', async () => {
    const connect = vi.fn<DatabasePool['connect']>();
    const repository = new PostgresEvidenceRepository(pool({ connect }));
    await expect(
      repository.put({ ...rawEvidence, id: 'ev_' + '0'.repeat(24) }),
    ).rejects.toMatchObject({ code: 'EVIDENCE_ID_MISMATCH', retryable: false });
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects a Snapshot on the wrong chain or position before connecting', async () => {
    const connect = vi.fn<DatabasePool['connect']>();
    const repository = new PostgresEvidenceRepository(pool({ connect }));
    await expect(
      repository.put(rawEvidence, [], { ...evmSnapshot, chainId: 'eip155:56' }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_CONFLICT' });
    await expect(
      repository.put(rawEvidence, [], { ...evmSnapshot, blockNumber: '2' }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_CONFLICT' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('rejects ungrounded derived Evidence before opening a connection', async () => {
    const connect = vi.fn<DatabasePool['connect']>();
    const repository = new PostgresEvidenceRepository(pool({ connect }));
    const ungrounded = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'DERIVED_FEATURE',
      source: 'fixture-model',
      locator: 'feature:ungrounded',
      payload: { score: 1 },
      observedAt: '2026-08-09T00:00:01.000Z',
      summary: 'Ungrounded derived fixture.',
    });
    await expect(repository.put(ungrounded)).rejects.toMatchObject({
      code: 'EVIDENCE_PROVENANCE_INVALID',
      retryable: false,
    });
    expect(connect).not.toHaveBeenCalled();
  });

  it('maps pool checkout failures to a retryable unavailable state', async () => {
    const repository = new PostgresEvidenceRepository(pool());
    await expect(repository.put(rawEvidence)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
      retryable: true,
    });
  });

  it('maps read failures and preserves already-classified storage errors', async () => {
    const failed = new PostgresEvidenceRepository(
      pool({ query: vi.fn(async () => Promise.reject(new Error('database failed'))) }),
    );
    await expect(failed.get(rawEvidence.id)).rejects.toMatchObject({
      code: 'STORAGE_READ_FAILED',
      retryable: true,
    });
    await expect(failed.drilldown(rawEvidence.id)).rejects.toMatchObject({
      code: 'STORAGE_READ_FAILED',
      retryable: true,
    });

    const classified = new StorageError('EVIDENCE_CONFLICT', 'classified');
    const classifiedFailure = new PostgresEvidenceRepository(
      pool({ query: vi.fn(async () => Promise.reject(classified)) }),
    );
    await expect(classifiedFailure.get(rawEvidence.id)).rejects.toBe(classified);
    await expect(classifiedFailure.drilldown(rawEvidence.id)).rejects.toBe(classified);
  });

  it('maps complete stored rows and an absent row without losing provenance', async () => {
    const storedEvidence = createEvidence({
      ledger: 'EVM',
      chainId: 'eip155:1',
      kind: 'DERIVED_FEATURE',
      source: rawEvidence.source,
      locator: 'feature:stored-row@1',
      sourceUri: 'https://provider.example/evidence',
      payload: { score: 1 },
      observedAt: rawEvidence.observedAt,
      blockOrSlot: '1',
      finality: 'finalized',
      rawArtifactRef: 'sha256:' + 'c'.repeat(64),
      summary: 'Complete stored row fixture.',
      sourceEvidenceIds: ['ev_a', 'ev_b'],
    });
    const row = {
      id: storedEvidence.id,
      ledger: storedEvidence.ledger,
      chain_id: storedEvidence.chainId,
      evidence_kind: storedEvidence.kind,
      source: storedEvidence.source,
      locator: storedEvidence.locator,
      source_uri: storedEvidence.sourceUri,
      payload_hash: storedEvidence.payloadHash,
      observed_at: new Date(storedEvidence.observedAt),
      block_or_slot: storedEvidence.blockOrSlot,
      finality: storedEvidence.finality,
      summary: storedEvidence.summary,
      raw_artifact_ref: storedEvidence.rawArtifactRef,
      snapshot_payload: JSON.stringify(evmSnapshot),
      source_evidence_ids: ['ev_b', 'ev_a', 'ev_b'],
    };
    const repository = new PostgresEvidenceRepository(
      pool({
        query: vi
          .fn<DatabasePool['query']>()
          .mockResolvedValueOnce({ rows: [row], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }),
      }),
    );
    await expect(repository.get(storedEvidence.id)).resolves.toMatchObject({
      evidence: {
        sourceUri: 'https://provider.example/evidence',
        finality: 'finalized',
        rawArtifactRef: 'sha256:' + 'c'.repeat(64),
      },
      sourceEvidenceIds: ['ev_a', 'ev_b'],
      snapshot: evmSnapshot,
    });
    await expect(repository.get('ev_missing')).resolves.toBeUndefined();
  });

  it('upgrades legacy stored Snapshot finality without changing its chain anchor', async () => {
    const { finality, ...legacyBase } = evmSnapshot;
    expect(finality).toBe('finalized');
    const legacySnapshot = {
      ...legacyBase,
      providerVersions: { sqd: 'sqd-portal-finalized-http-v1' },
    };
    const repository = new PostgresEvidenceRepository(
      pool({
        query: vi.fn(async () => ({
          rows: [
            {
              id: rawEvidence.id,
              ledger: rawEvidence.ledger,
              chain_id: rawEvidence.chainId,
              evidence_kind: rawEvidence.kind,
              source: rawEvidence.source,
              locator: rawEvidence.locator,
              source_uri: null,
              payload_hash: rawEvidence.payloadHash,
              observed_at: new Date(rawEvidence.observedAt),
              block_or_slot: rawEvidence.blockOrSlot,
              finality: null,
              summary: rawEvidence.summary,
              raw_artifact_ref: null,
              snapshot_payload: JSON.stringify(legacySnapshot),
              source_evidence_ids: [],
            },
          ],
          rowCount: 1,
        })),
      }),
    );

    await expect(repository.get(rawEvidence.id)).resolves.toMatchObject({
      snapshot: {
        ledger: 'EVM',
        blockNumber: '1',
        blockHash: evmSnapshot.blockHash,
        finality: 'finalized',
      },
    });
  });

  it('rolls back and releases a checked-out client after a write failure', async () => {
    const statements: string[] = [];
    const client: DatabaseClient = {
      query: vi.fn(async (text) => {
        statements.push(text.trim());
        if (text.trim() === 'BEGIN') return { rows: [], rowCount: null };
        if (text.trim() === 'ROLLBACK') return { rows: [], rowCount: null };
        throw new Error('write failed');
      }),
      release: vi.fn(),
    };
    const repository = new PostgresEvidenceRepository(pool({ connect: vi.fn(async () => client) }));

    await expect(repository.put(rawEvidence)).rejects.toMatchObject({
      code: 'STORAGE_WRITE_FAILED',
      retryable: true,
    });
    expect(statements).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO evidence'),
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('delegates shutdown to the bounded connection pool', async () => {
    const end = vi.fn(async () => undefined);
    const repository = new PostgresEvidenceRepository(pool({ end }));
    await repository.close();
    expect(end).toHaveBeenCalledOnce();
  });
});
