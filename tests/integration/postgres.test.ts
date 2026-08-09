import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import { createEvidence } from '@zerotrace/evidence';
import {
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
} from '@zerotrace/storage';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;
const checkpointTestRunId = randomUUID();

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:1',
  blockNumber: '25717412',
  blockHash: '0x' + 'a'.repeat(64),
  capturedAt: '2026-08-09T00:00:00.000Z',
  providerVersions: { 'ethereum-rpc@test.example': 'json-rpc' },
  adapterVersions: { evm: '0.1.0' },
  configHash: 'b'.repeat(64),
  entityModelVersion: 'entity-v0.1.0',
  labelSnapshot: 'labels-empty-v1',
};

const raw = createEvidence({
  ledger: 'EVM',
  chainId: 'eip155:1',
  kind: 'ACCOUNT_STATE',
  source: 'ethereum-rpc@test.example',
  locator: 'address:0xabc@25717412',
  payload: { balanceHex: '0x1', blockHash: snapshot.blockHash },
  observedAt: '2026-08-09T00:00:01.000Z',
  blockOrSlot: snapshot.blockNumber,
  finality: 'snapshot-block',
  summary: 'PostgreSQL integration source Evidence.',
});

const derived = createEvidence({
  ledger: 'EVM',
  chainId: 'eip155:1',
  kind: 'DERIVED_FEATURE',
  source: 'zerotrace-test-model@0.1.0',
  locator: 'feature:postgres-integration',
  payload: { score: 1 },
  observedAt: '2026-08-09T00:00:02.000Z',
  blockOrSlot: snapshot.blockNumber,
  finality: 'snapshot-block',
  summary: 'PostgreSQL integration derived Evidence.',
  sourceEvidenceIds: [raw.id],
});

postgresDescribe('PostgreSQL durable Evidence integration', () => {
  let repository: PostgresEvidenceRepository;

  beforeAll(() => {
    repository = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      connectionTimeoutMs: 5_000,
      statementTimeoutMs: 10_000,
      maxConnections: 2,
    });
  });

  afterAll(async () => repository.close());

  it('observes the initialized append-only storage schema', async () => {
    await expect(repository.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
    });
  });

  it('persists and retrieves a snapshot-bound raw observation idempotently', async () => {
    const stored = await repository.put(raw, [], snapshot);
    expect(stored).toMatchObject({ evidence: raw, sourceEvidenceIds: [], snapshot });
    await expect(repository.put(raw, [], snapshot)).resolves.toEqual(stored);
    await expect(repository.get(raw.id)).resolves.toEqual(stored);
    await expect(
      repository.put(raw, [], {
        ...snapshot,
        capturedAt: '2026-08-09T00:00:01.000Z',
      }),
    ).rejects.toMatchObject({ code: 'SNAPSHOT_CONFLICT' });
  });

  it('persists derivation edges and replays the complete graph after restart', async () => {
    await repository.put(raw, [], snapshot);
    await repository.put(derived, [raw.id], snapshot);
    await repository.close();
    repository = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });

    const nodes = await repository.drilldown(derived.id);
    expect(nodes.map((node) => node.evidence.id)).toEqual([derived.id, raw.id]);
    expect(nodes[0]).toMatchObject({ sourceEvidenceIds: [raw.id], snapshot });
  });

  it('enforces SQL append-only guards for Evidence and derivation edges', async () => {
    await repository.put(raw, [], snapshot);
    await repository.put(derived, [raw.id], snapshot);
    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE evidence SET summary = summary WHERE id = $1', [raw.id]),
      ).rejects.toThrow(/append-only/);
      await expect(
        pool.query(
          'DELETE FROM evidence_edges WHERE derived_evidence_id = $1 AND source_evidence_id = $2',
          [derived.id, raw.id],
        ),
      ).rejects.toThrow(/append-only/);

      const otherRaw = createEvidence({
        ledger: 'EVM',
        chainId: 'eip155:1',
        kind: 'ACCOUNT_STATE',
        source: 'ethereum-rpc@test.example',
        locator: 'address:0xdef@25717412',
        payload: { balanceHex: '0x2', blockHash: snapshot.blockHash },
        observedAt: '2026-08-09T00:00:02.500Z',
        blockOrSlot: snapshot.blockNumber,
        finality: 'snapshot-block',
        summary: 'Second PostgreSQL source Evidence.',
      });
      await repository.put(otherRaw, [], snapshot);
      await expect(
        pool.query(
          'INSERT INTO evidence_edges (derived_evidence_id, source_evidence_id) VALUES ($1, $2)',
          [otherRaw.id, raw.id],
        ),
      ).rejects.toThrow(/may not derive/);
      await expect(
        pool.query(
          'INSERT INTO evidence_edges (derived_evidence_id, source_evidence_id) VALUES ($1, $2)',
          [derived.id, otherRaw.id],
        ),
      ).rejects.toThrow(/atomically/);

      const ungrounded = createEvidence({
        ledger: 'EVM',
        chainId: 'eip155:1',
        kind: 'DERIVED_FEATURE',
        source: 'zerotrace-test-model@0.1.0',
        locator: 'feature:ungrounded-database-write',
        payload: { score: 0 },
        observedAt: '2026-08-09T00:00:03.000Z',
        blockOrSlot: snapshot.blockNumber,
        finality: 'snapshot-block',
        summary: 'Ungrounded database write probe.',
      });
      await expect(
        pool.query(
          `INSERT INTO evidence (
            id, ledger, chain_id, evidence_kind, source, locator, payload_hash,
            observed_at, block_or_slot, finality, summary
          ) VALUES ($1, $2::ledger_kind, $3, $4, $5, $6, $7, $8::timestamptz, $9::numeric, $10, $11)`,
          [
            ungrounded.id,
            ungrounded.ledger,
            ungrounded.chainId,
            ungrounded.kind,
            ungrounded.source,
            ungrounded.locator,
            ungrounded.payloadHash,
            ungrounded.observedAt,
            ungrounded.blockOrSlot,
            ungrounded.finality,
            ungrounded.summary,
          ],
        ),
      ).rejects.toThrow(/source observation/);
    } finally {
      await pool.end();
    }
  });
});

postgresDescribe('PostgreSQL ingestion checkpoint integration', () => {
  let checkpoints: PostgresIngestionCheckpointRepository;

  beforeAll(() => {
    checkpoints = new PostgresIngestionCheckpointRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => checkpoints.close());

  it('reports the migration-backed checkpoint store as durable', async () => {
    await expect(checkpoints.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
    });
  });

  it('resumes the same run identity and advances monotonically to a terminal state', async () => {
    const input = {
      source: 'sqd:ethereum-mainnet',
      dataset: 'ethereum-mainnet',
      ledger: 'EVM' as const,
      chainId: '1',
      fromBlock: 100,
      toBlock: 102,
      query: {
        profile: 'BLOCK_HEADERS',
        includeAllBlocks: true,
        testRunId: checkpointTestRunId,
      },
      startedAt: '2026-08-09T13:00:00.000Z',
    };
    const started = await checkpoints.begin(input);
    const resumed = await checkpoints.begin({
      ...input,
      startedAt: '2026-08-09T14:00:00.000Z',
    });
    expect(resumed).toEqual(started);

    const advanced = await checkpoints.advance(started.id, 101);
    expect(advanced).toMatchObject({ nextBlock: 102, lastBlock: 101, status: 'RUNNING' });
    await expect(checkpoints.recordFailure(started.id, 'PROVIDER_DOWN')).resolves.toMatchObject({
      lastErrorCode: 'PROVIDER_DOWN',
    });
    await expect(checkpoints.advance(started.id, 100)).resolves.toMatchObject({
      nextBlock: 102,
      lastBlock: 101,
      lastErrorCode: null,
    });
    await checkpoints.advance(started.id, 102);
    const completed = await checkpoints.finish(started.id, 'REQUESTED_RANGE_COMPLETE', 103);
    expect(completed).toMatchObject({
      status: 'REQUESTED_RANGE_COMPLETE',
      nextBlock: 103,
      lastBlock: 102,
      completedAt: expect.any(String),
    });
    await expect(checkpoints.advance(started.id, 102)).resolves.toEqual(completed);
  });

  it('prevents mutation or deletion of terminal ingestion history', async () => {
    const run = await checkpoints.begin({
      source: 'sqd:bitcoin-mainnet',
      dataset: 'bitcoin-mainnet',
      ledger: 'BITCOIN',
      chainId: 'bitcoin-mainnet',
      fromBlock: 200,
      toBlock: 200,
      query: {
        profile: 'BLOCK_HEADERS',
        includeAllBlocks: true,
        testRunId: checkpointTestRunId,
      },
      startedAt: '2026-08-09T13:00:00.000Z',
    });
    await checkpoints.advance(run.id, 200);
    await checkpoints.finish(run.id, 'REQUESTED_RANGE_COMPLETE', 201);
    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE ingestion_runs SET last_error_code = $2 WHERE id = $1', [
          run.id,
          'tampered',
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM ingestion_runs WHERE id = $1', [run.id]),
      ).rejects.toThrow(/deletion is forbidden/);
    } finally {
      await pool.end();
    }
  });
});
