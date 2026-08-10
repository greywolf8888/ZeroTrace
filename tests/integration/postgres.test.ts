import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import { createDataQualityAlert, persistChainAnchorObservation } from '@zerotrace/data-quality';
import { createEvidence } from '@zerotrace/evidence';
import {
  PostgresDataQualityRepository,
  PostgresEvidenceRepository,
  PostgresIngestionCheckpointRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;
const checkpointTestRunId = randomUUID();

const snapshot = {
  ledger: 'EVM' as const,
  chainId: 'eip155:1',
  blockNumber: '25717412',
  blockHash: '0x' + 'a'.repeat(64),
  parentBlockHash: '0x' + 'd'.repeat(64),
  finality: 'finalized' as const,
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
  finality: 'finalized',
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
  finality: 'finalized',
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

  it('persists a later re-observation of the same anchor after repository restart', async () => {
    await repository.put(raw, [], snapshot);
    await repository.close();
    repository = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });

    const recapturedSnapshot = {
      ...snapshot,
      capturedAt: '2026-08-09T00:01:00.000Z',
    };
    const recaptured = createEvidence({
      ledger: raw.ledger,
      chainId: raw.chainId,
      kind: raw.kind,
      source: raw.source,
      locator: raw.locator,
      payload: { balanceHex: '0x1', blockHash: snapshot.blockHash },
      observedAt: recapturedSnapshot.capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: raw.finality,
      summary: 'PostgreSQL integration source Evidence recaptured after restart.',
    });

    const stored = await repository.put(recaptured, [], recapturedSnapshot);
    expect(stored).toMatchObject({
      evidence: recaptured,
      sourceEvidenceIds: [],
      snapshot: recapturedSnapshot,
    });
    await expect(repository.get(raw.id)).resolves.toMatchObject({ snapshot });
    await expect(repository.get(recaptured.id)).resolves.toEqual(stored);
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
        finality: 'finalized',
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
        finality: 'finalized',
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

postgresDescribe('PostgreSQL semantic scan checkpoint integration', () => {
  let checkpoints: PostgresSemanticScanCheckpointRepository;

  beforeAll(() => {
    checkpoints = new PostgresSemanticScanCheckpointRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => checkpoints.close());

  it('persists restart-safe semantic state with exact contiguous coverage', async () => {
    const evidenceA = `ev_${'1'.repeat(24)}`;
    const evidenceB = `ev_${'2'.repeat(24)}`;
    const input = {
      scanType: 'FLAP_CONTRACT_ORIGIN',
      source: 'sqd:bsc-mainnet',
      ledger: 'EVM' as const,
      chainId: '56',
      subject: '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777',
      fromBlock: 0,
      toBlock: 19,
      chunkSize: 10,
      identity: {
        adapter: 'flap-origin-v1',
        finalizedHead: 1_000,
        testRunId: checkpointTestRunId,
      },
      initialState: { creations: [] },
      startedAt: '2026-08-10T00:00:00.000Z',
    };
    const started = await checkpoints.begin(input);
    await expect(
      checkpoints.begin({ ...input, startedAt: '2026-08-10T01:00:00.000Z' }),
    ).resolves.toEqual(started);

    const first = await checkpoints.advance(started.id, {
      expectedNextBlock: 0,
      completedToBlock: 9,
      state: { creations: [{ block: 4, transactionHash: `0x${'3'.repeat(64)}` }] },
      evidenceIds: [evidenceB, evidenceA, evidenceA],
    });
    expect(first).toMatchObject({
      nextBlock: 10,
      status: 'RUNNING',
      evidenceIds: [evidenceA, evidenceB],
    });

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE semantic_scan_runs SET next_block = 9 WHERE id = $1', [started.id]),
      ).rejects.toThrow(/cursor may not move backwards/);
      await expect(
        pool.query("UPDATE semantic_scan_runs SET subject = 'tampered' WHERE id = $1", [
          started.id,
        ]),
      ).rejects.toThrow(/identity is immutable/);
      await expect(
        pool.query('UPDATE semantic_scan_runs SET evidence_ids = ARRAY[]::text[] WHERE id = $1', [
          started.id,
        ]),
      ).rejects.toThrow(/Evidence IDs may not be removed/);
      await expect(
        pool.query(
          `UPDATE semantic_scan_runs
           SET state = state || '{"tampered":true}'::jsonb, state_hash = $2
           WHERE id = $1`,
          [started.id, 'f'.repeat(64)],
        ),
      ).rejects.toThrow(/state may change only with a forward cursor/);
    } finally {
      await pool.end();
    }

    await checkpoints.recordFailure(started.id, 'PROVIDER_DOWN');
    await checkpoints.close();
    checkpoints = new PostgresSemanticScanCheckpointRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(checkpoints.get(started.id)).resolves.toMatchObject({
      nextBlock: 10,
      lastErrorCode: 'PROVIDER_DOWN',
    });

    const secondState = {
      creations: [{ block: 4, transactionHash: `0x${'3'.repeat(64)}` }],
    };
    await checkpoints.advance(started.id, {
      expectedNextBlock: 10,
      completedToBlock: 19,
      state: secondState,
      evidenceIds: [evidenceA, evidenceB],
    });
    const completed = await checkpoints.finish(started.id);
    expect(completed).toMatchObject({
      status: 'REQUESTED_RANGE_COMPLETE',
      nextBlock: 20,
      lastErrorCode: null,
      completedAt: expect.any(String),
    });
    await expect(
      checkpoints.advance(started.id, {
        expectedNextBlock: 10,
        completedToBlock: 19,
        state: secondState,
        evidenceIds: [evidenceA, evidenceB],
      }),
    ).resolves.toEqual(completed);

    const immutablePool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        immutablePool.query(
          "UPDATE semantic_scan_runs SET last_error_code = 'tampered' WHERE id = $1",
          [started.id],
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        immutablePool.query('DELETE FROM semantic_scan_runs WHERE id = $1', [started.id]),
      ).rejects.toThrow(/deletion is forbidden/);
    } finally {
      await immutablePool.end();
    }
  });

  it('rejects oversized chunks and completion with a coverage gap', async () => {
    const run = await checkpoints.begin({
      scanType: 'FLAP_CONTRACT_ORIGIN',
      source: 'sqd:bsc-mainnet',
      ledger: 'EVM',
      chainId: '56',
      subject: '0xb81252503501f366b5dfb8c89fff85076d2f8888',
      fromBlock: 30,
      toBlock: 50,
      chunkSize: 10,
      identity: { adapter: 'flap-origin-v1', testRunId: checkpointTestRunId },
      initialState: { creations: [] },
    });
    await expect(
      checkpoints.advance(run.id, {
        expectedNextBlock: 30,
        completedToBlock: 40,
        state: { creations: [] },
        evidenceIds: [],
      }),
    ).rejects.toMatchObject({ code: 'SEMANTIC_CHECKPOINT_CONFLICT' });
    await expect(checkpoints.finish(run.id)).rejects.toMatchObject({
      code: 'SEMANTIC_CHECKPOINT_CONFLICT',
    });
  });
});

postgresDescribe('PostgreSQL Data Quality integration', () => {
  let evidence: PostgresEvidenceRepository;
  let dataQuality: PostgresDataQualityRepository;

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    dataQuality = new PostgresDataQualityRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => {
    await Promise.all([evidence.close(), dataQuality.close()]);
  });

  it('reports the migration-backed anchor and alert store as durable', async () => {
    await expect(dataQuality.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
    });
  });

  it('persists replayable anchors and returns the latest exact-source head after restart', async () => {
    const anchorEvidence = createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'BLOCK',
      source: 'ethereum-rpc@test.example',
      locator: `anchor:${snapshot.blockNumber}:${snapshot.blockHash}`,
      payload: {
        number: snapshot.blockNumber,
        hash: snapshot.blockHash,
        parentHash: snapshot.parentBlockHash,
      },
      observedAt: '2026-08-09T00:00:04.000Z',
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'PostgreSQL integration chain anchor.',
    });
    await evidence.put(anchorEvidence, [], snapshot);
    const observation = persistChainAnchorObservation(
      {
        anchor: {
          ledger: 'EVM',
          chainId: snapshot.chainId,
          position: snapshot.blockNumber,
          hash: snapshot.blockHash,
          parentPosition: String(BigInt(snapshot.blockNumber) - 1n),
          parentHash: snapshot.parentBlockHash,
          finality: snapshot.finality,
          source: 'ethereum-rpc@test.example',
          observedAt: anchorEvidence.observedAt,
        },
        snapshot,
        payload: {
          number: snapshot.blockNumber,
          hash: snapshot.blockHash,
          parentHash: snapshot.parentBlockHash,
        },
      },
      'HEAD',
      anchorEvidence.id,
    );

    await expect(dataQuality.putAnchor(observation)).resolves.toEqual(observation);
    await expect(dataQuality.putAnchor(observation)).resolves.toEqual(observation);
    await dataQuality.close();
    dataQuality = new PostgresDataQualityRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(
      dataQuality.latestHead('EVM', snapshot.chainId, 'ethereum-rpc@test.example'),
    ).resolves.toEqual(observation);
  });

  it('stores Evidence-linked alerts atomically and rejects missing Evidence', async () => {
    await evidence.put(raw, [], snapshot);
    const alert = createDataQualityAlert({
      kind: 'SOURCE_REGRESSION',
      severity: 'WARNING',
      ledger: 'EVM',
      chainId: snapshot.chainId,
      position: snapshot.blockNumber,
      summary: 'Integration source regression.',
      details: { source: raw.source },
      evidenceIds: [raw.id],
      observedAt: '2026-08-09T00:00:05.000Z',
      modelVersion: 'anchor-reconciliation-v1',
    });
    await expect(dataQuality.putAlert(alert)).resolves.toEqual(alert);
    await expect(dataQuality.putAlert(alert)).resolves.toEqual(alert);

    const ungrounded = createDataQualityAlert({
      kind: alert.kind,
      severity: alert.severity,
      ledger: alert.ledger,
      chainId: alert.chainId,
      position: alert.position,
      summary: alert.summary,
      details: alert.details,
      evidenceIds: [`ev_${'f'.repeat(24)}`],
      observedAt: '2026-08-09T00:00:06.000Z',
      modelVersion: alert.modelVersion,
    });
    await expect(dataQuality.putAlert(ungrounded)).rejects.toMatchObject({
      code: 'DATA_QUALITY_STORAGE_WRITE_FAILED',
    });
  });

  it('enforces append-only guards for anchors, alerts, and alert Evidence edges', async () => {
    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE chain_anchor_observations SET block_hash = block_hash'),
      ).rejects.toThrow(/append-only/);
      await expect(pool.query('UPDATE data_quality_alerts SET summary = summary')).rejects.toThrow(
        /append-only/,
      );
      await expect(pool.query('DELETE FROM data_quality_alert_evidence')).rejects.toThrow(
        /append-only/,
      );
    } finally {
      await pool.end();
    }
  });
});
