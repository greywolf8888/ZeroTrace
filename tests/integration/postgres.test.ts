import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import {
  EvmLedgerAdapter,
  SolanaLedgerAdapter,
  type EvmLogQuery,
  type EvmLogRecord,
  type JsonRpcTransport,
  type TransportObservation,
  type TransportReadOptions,
} from '@zerotrace/chain-adapters';
import { createDataQualityAlert, persistChainAnchorObservation } from '@zerotrace/data-quality';
import { createEvidence } from '@zerotrace/evidence';
import {
  EvmControlCoverageDomainSchema,
  SolanaControlCoverageDomainSchema,
  SolanaTransactionIntelligenceReportSchema,
  FlapEventHistorySchema,
  unknownValue,
  type EvmControlSurfaceReport,
  type SolanaControlSurfaceReport,
  type EvmClaimAddressObservation,
} from '@zerotrace/schemas';
import {
  FLAP_BSC_MAINNET_DEPLOYMENT,
  FLAP_HISTORY_MODEL_VERSION,
  discoverEvmPensionCandidates,
  projectFlapEventHistoryRestartSafe,
  type FlapHistorySegmentExecutor,
} from '@zerotrace/platform-adapters';
import {
  PostgresClaimReportRepository,
  PostgresDataQualityRepository,
  PostgresEvmControlSurfaceRepository,
  PostgresSolanaControlSurfaceRepository,
  PostgresSolanaTransactionReportRepository,
  PostgresEvidenceRepository,
  PostgresFlapHistoryProjectionRepository,
  PostgresIngestionCheckpointRepository,
  PostgresPensionCandidateReportRepository,
  PostgresSemanticScanCheckpointRepository,
} from '@zerotrace/storage';

import { querySolanaTransaction } from '../../apps/api/src/ledger-query.js';

const solanaReportSignature =
  '4ReKprwf3WdLHRrzp4ctPWNBsQDPL3VZz3zMmoZfcGJMJCHh5Vq937mPdyxhCbw54wNnA6hZ7KfNpQdpt13yY7A9';

const connectionString = process.env.TEST_POSTGRES_URL;
const postgresDescribe = connectionString === undefined ? describe.skip : describe;
const checkpointTestRunId = randomUUID();

class IntegrationNoNetworkTransport implements JsonRpcTransport {
  readonly endpointId = 'bsc-rpc@test.example';

  request<T>(_method: string, _params: readonly unknown[] = []): Promise<T> {
    throw new Error('PostgreSQL projection integration reached the network.');
  }

  requestSourced<T>(
    _method: string,
    _params: readonly unknown[] = [],
    _options: TransportReadOptions = {},
  ): Promise<TransportObservation<T>> {
    throw new Error('PostgreSQL projection integration reached the sourced network.');
  }
}

class SolanaTransactionFixtureTransport implements JsonRpcTransport {
  readonly endpointId = 'solana-rpc@integration';

  async request<T>(method: string): Promise<T> {
    return (await this.requestSourced<T>(method)).value;
  }

  async requestSourced<T>(method: string): Promise<TransportObservation<T>> {
    const signature = solanaReportSignature;
    const response =
      method === 'getTransaction'
        ? {
            slot: 300_000_002,
            blockTime: 1_700_000_100,
            version: 'legacy',
            transaction: {
              signatures: [signature],
              message: {
                accountKeys: ['11111111111111111111111111111111'],
                header: {
                  numRequiredSignatures: 1,
                  numReadonlySignedAccounts: 0,
                  numReadonlyUnsignedAccounts: 0,
                },
                instructions: [],
                recentBlockhash: '11111111111111111111111111111111',
              },
            },
            meta: {
              err: null,
              fee: 5000,
              preBalances: [10_000],
              postBalances: [5_000],
              innerInstructions: [],
              preTokenBalances: [],
              postTokenBalances: [],
              logMessages: [],
              computeUnitsConsumed: 0,
            },
          }
        : method === 'getBlock'
          ? {
              blockhash: '3ySAYPQqMfpyZL6QhH4RzgT68HWpV72G2JAa2XWrpHEi',
              previousBlockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
              parentSlot: 300_000_001,
              blockTime: 1_700_000_100,
            }
          : undefined;
    if (response === undefined) throw new Error(`Unexpected Solana fixture method ${method}.`);
    return { value: response as T, endpointId: this.endpointId };
  }
}

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
    const terminalState = {
      ...secondState,
      result: { origin: 'UNKNOWN', reason: 'INSUFFICIENT_DATA' },
    };
    const completed = await checkpoints.finish(started.id, {
      state: terminalState,
      evidenceIds: [evidenceA, evidenceB],
    });
    expect(completed).toMatchObject({
      status: 'REQUESTED_RANGE_COMPLETE',
      nextBlock: 20,
      lastErrorCode: null,
      state: terminalState,
      completedAt: expect.any(String),
    });
    await expect(
      checkpoints.finish(started.id, {
        state: terminalState,
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

postgresDescribe('PostgreSQL Flap history projection integration', () => {
  const token = '0xdcfb441a1f38802820a4e7b4cc8aab37833c7777';
  const historySnapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '19',
    blockHash: `0x${'8'.repeat(64)}`,
    parentBlockHash: `0x${'7'.repeat(64)}`,
    finality: 'finalized' as const,
    capturedAt: '2026-08-10T01:00:00.000Z',
    providerVersions: { 'bsc-rpc@test.example': 'evm-ledger-v0.1.0' },
    adapterVersions: { evm: 'evm-ledger-v0.1.0' },
    configHash: '6'.repeat(64),
    entityModelVersion: 'entity-model-unapplied',
    labelSnapshot: 'labels-unapplied',
  };
  const rangeEvidence = createEvidence({
    ledger: 'EVM',
    chainId: historySnapshot.chainId,
    kind: 'PROVIDER_OBSERVATION',
    source: 'sqd:binance-mainnet',
    locator: 'flap-portal-logs:portal:0-19',
    payload: { logs: [] },
    observedAt: historySnapshot.capturedAt,
    blockOrSlot: historySnapshot.blockNumber,
    finality: historySnapshot.finality,
    summary: 'PostgreSQL Flap history range Evidence.',
  });
  const modelVersion = 'flap-bounded-event-history-v1';
  const terminalEvidence = createEvidence({
    ledger: 'EVM',
    chainId: historySnapshot.chainId,
    kind: 'NEGATIVE_EVIDENCE',
    source: `zerotrace:${modelVersion}`,
    locator: `flap-event-history:${token}:0-19`,
    payload: { token, chronology: [] },
    observedAt: historySnapshot.capturedAt,
    blockOrSlot: historySnapshot.blockNumber,
    finality: historySnapshot.finality,
    summary: 'PostgreSQL Flap history terminal Evidence.',
    sourceEvidenceIds: [rangeEvidence.id],
  });
  const history = FlapEventHistorySchema.parse({
    platform: 'flap',
    token,
    requestedRange: { fromBlock: '0', toBlock: '19', chunkSize: 10, chunkCount: 2 },
    requestedRangeCoverage: 1,
    lifetimeCoverage: unknownValue('INSUFFICIENT_DATA'),
    chronology: [],
    transactions: [],
    unrecognizedPortalLogCount: 0,
    metadata: {
      snapshot: historySnapshot,
      dataCoverage: 1,
      sourceCoverage: 1,
      historyCoverage: 0,
      simulationCoverage: 0,
      freshness: historySnapshot.capturedAt,
      sourceSet: ['bsc-rpc@test.example', 'sqd:binance-mainnet'],
      modelVersion,
      confidence: 0.95,
      evidenceIds: [rangeEvidence.id, terminalEvidence.id].sort(),
    },
    evidence: [rangeEvidence, terminalEvidence],
  });

  let evidence: PostgresEvidenceRepository;
  let checkpoints: PostgresSemanticScanCheckpointRepository;
  let projection: PostgresFlapHistoryProjectionRepository;

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    checkpoints = new PostgresSemanticScanCheckpointRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    projection = new PostgresFlapHistoryProjectionRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => {
    await Promise.all([evidence.close(), checkpoints.close(), projection.close()]);
  });

  it('stores each Evidence-backed segment before cursor advance and rejects mutation', async () => {
    await evidence.put(rangeEvidence, [], historySnapshot);
    await evidence.put(terminalEvidence, [rangeEvidence.id], historySnapshot);
    const run = await checkpoints.begin({
      scanType: 'FLAP_EVENT_HISTORY',
      source: 'sqd:binance-mainnet',
      ledger: 'EVM',
      chainId: historySnapshot.chainId,
      subject: token,
      fromBlock: 0,
      toBlock: 19,
      chunkSize: 20,
      identity: { modelVersion, testRunId: checkpointTestRunId },
      initialState: { segmentCount: 0 },
    });
    const stored = await projection.putSegment({ scanId: run.id, result: history });
    await expect(projection.putSegment({ scanId: run.id, result: history })).resolves.toEqual(
      stored,
    );
    await projection.close();
    projection = new PostgresFlapHistoryProjectionRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(projection.listSegments(run.id)).resolves.toEqual([stored]);

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query(
          `INSERT INTO flap_history_segments (
            id, scan_id, chain_id, token, from_block, to_block, result_hash, result,
            snapshot_hash, terminal_evidence_id, evidence_ids, source_set, model_version,
            transaction_count, unrecognized_portal_log_count
          ) SELECT
            $2, scan_id, chain_id, token, from_block, to_block, result_hash, result,
            snapshot_hash, terminal_evidence_id,
            ARRAY(
              SELECT item
              FROM unnest(ARRAY[$3, source.terminal_evidence_id]) item
              ORDER BY item
            ), source_set,
            model_version, transaction_count, unrecognized_portal_log_count
          FROM flap_history_segments source WHERE id = $1`,
          [stored.id, `fhs_${'f'.repeat(24)}`, `ev_${'f'.repeat(24)}`],
        ),
      ).rejects.toThrow(/missing Evidence/);
    } finally {
      await pool.end();
    }

    await checkpoints.advance(run.id, {
      expectedNextBlock: 0,
      completedToBlock: 19,
      state: { segmentCount: 1, lastSegmentId: stored.id },
      evidenceIds: stored.evidenceIds,
    });
    await checkpoints.finish(run.id, {
      state: { segmentCount: 1, lastSegmentId: stored.id },
      evidenceIds: stored.evidenceIds,
    });
    await expect(projection.putSegment({ scanId: run.id, result: history })).resolves.toEqual(
      stored,
    );

    const immutablePool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        immutablePool.query('UPDATE flap_history_segments SET result = result WHERE id = $1', [
          stored.id,
        ]),
      ).rejects.toThrow(/mutation is forbidden/);
      await expect(
        immutablePool.query('DELETE FROM flap_history_segments WHERE id = $1', [stored.id]),
      ).rejects.toThrow(/mutation is forbidden/);
    } finally {
      await immutablePool.end();
    }
  });

  it('recovers the cross-range runner when a segment commits before its cursor advance', async () => {
    const runnerToken = `0x${randomUUID().replaceAll('-', '').padEnd(40, '0')}`;
    const adapter = new EvmLedgerAdapter(
      {
        id: 'bsc-rpc@test.example',
        chainId: 56,
        chainName: 'BNB Smart Chain',
        snapshotBlockTag: 'finalized',
      },
      new IntegrationNoNetworkTransport(),
    );
    const calls: string[] = [];
    const executeSegment: FlapHistorySegmentExecutor = async (options) => {
      calls.push(`${options.fromBlock}-${options.toBlock}`);
      const blockHash = BigInt(options.toBlock).toString(16).padStart(64, '0');
      const parentHash = (BigInt(options.toBlock) - 1n).toString(16).padStart(64, '0');
      const segmentSnapshot = {
        ledger: 'EVM' as const,
        chainId: 'eip155:56',
        blockNumber: options.toBlock,
        blockHash: `0x${blockHash}`,
        parentBlockHash: `0x${parentHash}`,
        finality: 'finalized' as const,
        capturedAt: '2026-08-10T02:00:00.000Z',
        providerVersions: {
          'bsc-rpc@test.example': 'evm-ledger-v0.1.0',
          'sqd:binance-mainnet': 'sqd-finalized-v1',
        },
        adapterVersions: { evm: 'evm-ledger-v0.1.0' },
        configHash: '5'.repeat(64),
        entityModelVersion: 'entity-model-unapplied',
        labelSnapshot: 'labels-unapplied',
      };
      const observation = await options.writeEvidence(
        createEvidence({
          ledger: 'EVM',
          chainId: segmentSnapshot.chainId,
          kind: 'PROVIDER_OBSERVATION',
          source: 'sqd:binance-mainnet',
          locator: `postgres-flap-logs:${options.fromBlock}-${options.toBlock}`,
          payload: { logs: [] },
          observedAt: segmentSnapshot.capturedAt,
          blockOrSlot: segmentSnapshot.blockNumber,
          finality: segmentSnapshot.finality,
          summary: 'PostgreSQL runner bounded log Evidence.',
        }),
        [],
        segmentSnapshot,
      );
      const terminal = await options.writeEvidence(
        createEvidence({
          ledger: 'EVM',
          chainId: segmentSnapshot.chainId,
          kind: 'NEGATIVE_EVIDENCE',
          source: `zerotrace:${FLAP_HISTORY_MODEL_VERSION}`,
          locator:
            `flap-event-history:${options.token}:` + `${options.fromBlock}-${options.toBlock}`,
          payload: { token: options.token, chronology: [] },
          observedAt: segmentSnapshot.capturedAt,
          blockOrSlot: segmentSnapshot.blockNumber,
          finality: segmentSnapshot.finality,
          summary: 'PostgreSQL runner bounded negative Evidence.',
          sourceEvidenceIds: [observation.id],
        }),
        [observation.id],
        segmentSnapshot,
      );
      return FlapEventHistorySchema.parse({
        platform: 'flap',
        token: options.token,
        requestedRange: {
          fromBlock: options.fromBlock,
          toBlock: options.toBlock,
          chunkSize: options.chunkSize,
          chunkCount: Number(BigInt(options.toBlock) - BigInt(options.fromBlock) + 1n),
        },
        requestedRangeCoverage: 1,
        lifetimeCoverage: unknownValue('INSUFFICIENT_DATA'),
        chronology: [],
        transactions: [],
        unrecognizedPortalLogCount: 0,
        metadata: {
          snapshot: segmentSnapshot,
          dataCoverage: 1,
          sourceCoverage: 1,
          historyCoverage: 0,
          simulationCoverage: 0,
          freshness: segmentSnapshot.capturedAt,
          sourceSet: ['bsc-rpc@test.example', 'sqd:binance-mainnet'],
          modelVersion: FLAP_HISTORY_MODEL_VERSION,
          confidence: 0.95,
          evidenceIds: [observation.id, terminal.id].sort(),
        },
        evidence: [observation, terminal],
      });
    };
    const writeEvidence = async (
      item: Parameters<typeof evidence.put>[0],
      sources: readonly string[] = [],
      boundSnapshot?: Parameters<typeof evidence.put>[2],
    ) => (await evidence.put(item, sources, boundSnapshot)).evidence;
    let failAdvance = true;
    const interruptedCheckpoints = {
      begin: checkpoints.begin.bind(checkpoints),
      advance: async (...args: Parameters<typeof checkpoints.advance>) => {
        if (failAdvance) {
          failAdvance = false;
          const error = new Error('PostgreSQL integration cursor interruption') as Error & {
            code: string;
          };
          error.code = 'SEMANTIC_CHECKPOINT_UNAVAILABLE';
          throw error;
        }
        return checkpoints.advance(...args);
      },
      finish: checkpoints.finish.bind(checkpoints),
      recordFailure: checkpoints.recordFailure.bind(checkpoints),
    };
    const options = {
      adapter,
      logReader: {
        endpointId: 'sqd:binance-mainnet' as const,
        getLogsObservation: () => {
          throw new Error('Injected integration executor was bypassed.');
        },
      },
      token: runnerToken,
      fromBlock: '100',
      toBlock: '103',
      segmentSize: 2,
      chunkSize: 1,
      deployment: FLAP_BSC_MAINNET_DEPLOYMENT,
      writeEvidence,
      projection,
      executeSegment,
    };

    await expect(
      projectFlapEventHistoryRestartSafe({ ...options, checkpoints: interruptedCheckpoints }),
    ).rejects.toMatchObject({ code: 'SEMANTIC_CHECKPOINT_UNAVAILABLE' });
    expect(calls).toEqual(['100-101']);

    const result = await projectFlapEventHistoryRestartSafe({ ...options, checkpoints });
    expect(result.requestedRangeCoverage).toBe(1);
    expect(result.lifetimeCoverage.state).toBe('unknown');
    expect(result.segments.map((segment) => [segment.fromBlock, segment.toBlock])).toEqual([
      ['100', '101'],
      ['102', '103'],
    ]);
    expect(calls).toEqual(['100-101', '102-103']);
    const pool = new Pool({ connectionString: connectionString as string });
    try {
      const persisted = await pool.query(
        `SELECT id::text, status, next_block::text
         FROM semantic_scan_runs
         WHERE scan_type = 'FLAP_EVENT_HISTORY' AND subject = $1`,
        [runnerToken],
      );
      expect(persisted.rows).toHaveLength(1);
      expect(persisted.rows[0]).toMatchObject({
        status: 'REQUESTED_RANGE_COMPLETE',
        next_block: '104',
      });
      await expect(projection.listSegments(String(persisted.rows[0]?.id))).resolves.toHaveLength(2);
    } finally {
      await pool.end();
    }
  });

  it('reports migration-backed projection health', async () => {
    await expect(projection.health()).resolves.toMatchObject({
      status: 'UP',
      backend: 'POSTGRES',
      durable: true,
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

postgresDescribe('PostgreSQL durable Claim Report integration', () => {
  let evidence: PostgresEvidenceRepository;
  let reports: PostgresClaimReportRepository;
  const token = `0x${'1'.repeat(40)}`;
  const address = `0x${'2'.repeat(40)}`;
  const counterparty = `0x${'3'.repeat(40)}`;
  const reportSnapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '100',
    blockHash: `0x${'4'.repeat(64)}`,
    finality: 'finalized' as const,
    blockTimestamp: '2026-08-10T00:00:00.000Z',
    capturedAt: '2026-08-10T00:00:01.000Z',
    providerVersions: { fixture: '1' },
    adapterVersions: { claim: '1' },
    configHash: '5'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    reports = new PostgresClaimReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => {
    await Promise.all([evidence.close(), reports.close()]);
  });

  it('persists, restart-replays, and SQL-protects a fully evidenced Claim Report', async () => {
    const observedAt = reportSnapshot.capturedAt;
    const custody = createEvidence({
      ledger: 'EVM',
      chainId: reportSnapshot.chainId,
      kind: 'CONTRACT_STATE',
      source: 'rpc:bsc',
      locator: `safe:${address}@100`,
      payload: { kind: 'SAFE_MULTISIG', threshold: 2, owners: 3 },
      observedAt,
      blockOrSlot: '100',
      finality: 'finalized',
      summary: 'Claim Report integration custody source.',
    });
    const query = createEvidence({
      ledger: 'EVM',
      chainId: reportSnapshot.chainId,
      kind: 'PROVIDER_OBSERVATION',
      source: 'sqd:bsc',
      locator: `erc20-transfer-range:${token}:90-100:to`,
      payload: { resultCount: 1 },
      observedAt,
      blockOrSlot: '100',
      finality: 'finalized',
      summary: 'Claim Report integration range source.',
    });
    const transfer = createEvidence({
      ledger: 'EVM',
      chainId: reportSnapshot.chainId,
      kind: 'LOG',
      source: 'sqd:bsc',
      locator: `erc20-transfer:${token}:fixture:0`,
      payload: { from: counterparty, to: address, amount: '1000000' },
      observedAt,
      blockOrSlot: '100',
      finality: 'finalized',
      summary: 'Claim Report integration Transfer source.',
    });
    const sourceIds = [custody.id, query.id, transfer.id].sort();
    const terminal = createEvidence({
      ledger: 'EVM',
      chainId: reportSnapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:evm-claim-address-observation-v1.0.0',
      locator: `evm-claim-address:${token}:${address}:90-100`,
      payload: { tokenAddress: token, address, fromBlock: '90', toBlock: '100' },
      observedAt,
      blockOrSlot: '100',
      finality: 'finalized',
      summary: 'Claim Report integration terminal root.',
      sourceEvidenceIds: sourceIds,
    });
    for (const item of [custody, query, transfer]) {
      await evidence.put(item, [], reportSnapshot);
    }
    await evidence.put(terminal, sourceIds, reportSnapshot);
    const window = { from: '2026-08-02T00:00:00.000Z', to: reportSnapshot.blockTimestamp };
    const report: EvmClaimAddressObservation = {
      tokenAddress: token,
      address,
      fromBlock: '90',
      toBlock: '100',
      window,
      custody: {
        address,
        kind: 'SAFE_MULTISIG' as const,
        canMoveFunds: { state: 'known' as const, value: true },
        threshold: 2,
        ownerCount: 3,
        executedTransactions: 1,
        evidenceIds: [custody.id],
      },
      custodyMetadata: {
        snapshot: reportSnapshot,
        dataCoverage: 1,
        sourceCoverage: 0.5,
        historyCoverage: 0,
        simulationCoverage: 0,
        freshness: reportSnapshot.blockTimestamp,
        sourceSet: ['rpc:bsc'],
        modelVersion: 'safe-compatible-read-v1.1.0',
        confidence: 0.95,
        evidenceIds: [custody.id],
      },
      flow: {
        address,
        window,
        inflow: {
          observedAmount: '1000000',
          actualAmount: unknownValue('INSUFFICIENT_DATA'),
          transferCount: 1,
          uniqueCounterparties: 1,
          firstObservedAt: { state: 'known' as const, value: observedAt },
          lastObservedAt: { state: 'known' as const, value: observedAt },
          evidenceIds: [transfer.id],
        },
        outflow: {
          observedAmount: '0',
          actualAmount: unknownValue('INSUFFICIENT_DATA'),
          transferCount: 0,
          uniqueCounterparties: 0,
          firstObservedAt: unknownValue('INSUFFICIENT_DATA'),
          lastObservedAt: unknownValue('INSUFFICIENT_DATA'),
          evidenceIds: [],
        },
        shareUnitAssessment: null,
        selfTransferCount: 0,
        selfTransferObservedAmount: '0',
        topCounterparties: [
          {
            direction: 'INFLOW' as const,
            address: counterparty,
            observedAmount: '1000000',
            transferCount: 1,
            firstObservedAt: observedAt,
            lastObservedAt: observedAt,
            evidenceIds: [transfer.id],
          },
        ],
        metadata: {
          snapshot: reportSnapshot,
          dataCoverage: 1,
          sourceCoverage: 0.5,
          historyCoverage: 1,
          simulationCoverage: 0,
          freshness: reportSnapshot.blockTimestamp,
          sourceSet: ['sqd:bsc'],
          modelVersion: 'claim-flow-summary-v1.0.0',
          confidence: 0.95,
          evidenceIds: [query.id, transfer.id].sort(),
        },
      },
      terminalEvidenceId: terminal.id,
      metadata: {
        snapshot: reportSnapshot,
        dataCoverage: 1,
        sourceCoverage: 0.5,
        historyCoverage: 0,
        simulationCoverage: 0,
        freshness: reportSnapshot.blockTimestamp,
        sourceSet: ['rpc:bsc', 'sqd:bsc'],
        modelVersion: 'evm-claim-address-observation-v1.0.0',
        confidence: 0.95,
        evidenceIds: [...sourceIds, terminal.id].sort(),
      },
    };

    const stored = await reports.put(report);
    await expect(reports.put(report)).resolves.toEqual(stored);
    await reports.close();
    reports = new PostgresClaimReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(reports.get(stored.id)).resolves.toEqual(stored);
    await expect(reports.latest('eip155:56', token, address)).resolves.toEqual(stored);
    await expect(reports.health()).resolves.toMatchObject({ status: 'UP', durable: true });

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE evm_claim_reports SET report = report WHERE id = $1', [stored.id]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM evm_claim_reports WHERE id = $1', [stored.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool.end();
    }
  });
});

postgresDescribe('PostgreSQL durable EVM control surface integration', () => {
  let evidence: PostgresEvidenceRepository;
  let reports: PostgresEvmControlSurfaceRepository;
  const subject = `0x${'a'.repeat(40)}`;
  const capturedAt = '2026-08-11T12:00:01.000Z';
  const snapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '101',
    blockHash: `0x${'a'.repeat(64)}`,
    parentBlockHash: `0x${'b'.repeat(64)}`,
    finality: 'finalized' as const,
    blockTimestamp: '2026-08-11T12:00:00.000Z',
    capturedAt,
    providerVersions: { 'bsc-rpc@integration': 'json-rpc' },
    adapterVersions: { evm: 'integration' },
    configHash: 'c'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    reports = new PostgresEvmControlSurfaceRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => {
    await Promise.all([evidence.close(), reports.close()]);
  });

  it('persists, replays, and rejects mutation of a provenance-bound report', async () => {
    const raw = createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'CONTRACT_STATE',
      source: 'bsc-rpc@integration',
      locator: `eth_getCode:${subject}@${snapshot.blockHash}`,
      payload: { code: '0x6000' },
      observedAt: capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Control surface integration contract state.',
    });
    const terminal = createEvidence({
      ledger: 'EVM',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:evm-control-surface-v1.1.0',
      locator: `evm-control-surface-report:${subject}@${snapshot.blockHash}`,
      payload: { subject, snapshotHash: snapshot.blockHash },
      observedAt: capturedAt,
      blockOrSlot: snapshot.blockNumber,
      finality: snapshot.finality,
      summary: 'Control surface integration terminal root.',
      sourceEvidenceIds: [raw.id],
    });
    await evidence.put(raw, [], snapshot);
    await evidence.put(terminal, [raw.id], snapshot);

    const report: EvmControlSurfaceReport = {
      ledger: 'EVM',
      chainId: snapshot.chainId,
      subject,
      contractKind: { state: 'known', value: 'DIRECT_CONTRACT' },
      implementationAddress: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      proxyAdminAddress: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      beaconAddress: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      ownerAddress: { state: 'unknown', reason: 'UNSUPPORTED' },
      safe: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      logicCode: {
        state: 'known',
        value: {
          address: subject,
          relation: 'SUBJECT',
          runtimeBytecodeHash: `0x${'f'.repeat(64)}`,
          runtimeBytecodeBytes: 2,
        },
      },
      verifiedSource: { state: 'unknown', reason: 'PROVIDER_UNCONFIGURED' },
      declaredCapabilities: [],
      sourceAgreement: { state: 'known', value: true },
      sourceIndependence: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      rights: [],
      coverage: EvmControlCoverageDomainSchema.options.map((domain) => ({
        domain,
        observed:
          domain === 'CONTRACT_CODE'
            ? ({ state: 'known', value: true } as const)
            : ({ state: 'unknown', reason: 'NOT_QUERIED' } as const),
        detail: `${domain} integration coverage.`,
        evidenceIds: domain === 'CONTRACT_CODE' ? [raw.id] : [],
      })),
      terminalEvidenceId: terminal.id,
      metadata: {
        snapshot,
        dataCoverage: 1 / EvmControlCoverageDomainSchema.options.length,
        sourceCoverage: 0.5,
        historyCoverage: 0,
        simulationCoverage: 0,
        freshness: snapshot.blockTimestamp,
        sourceSet: ['bsc-rpc@integration'],
        modelVersion: 'evm-control-surface-v1.1.0',
        confidence: 0.8,
        evidenceIds: [raw.id, terminal.id].sort(),
      },
      evidence: [raw, terminal].sort((left, right) => left.id.localeCompare(right.id)),
    };

    const stored = await reports.put(report);
    await expect(reports.put(report)).resolves.toEqual(stored);
    await reports.close();
    reports = new PostgresEvmControlSurfaceRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(reports.get(stored.id)).resolves.toEqual(stored);
    await expect(reports.latest(snapshot.chainId, subject)).resolves.toEqual(stored);
    await expect(reports.health()).resolves.toMatchObject({ status: 'UP', durable: true });

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE evm_control_surface_reports SET report = report WHERE id = $1', [
          stored.id,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM evm_control_surface_reports WHERE id = $1', [stored.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool.end();
    }
  });
});

postgresDescribe('PostgreSQL durable Solana control surface integration', () => {
  let evidence: PostgresEvidenceRepository;
  let reports: PostgresSolanaControlSurfaceRepository;
  const subject = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi';
  const capturedAt = '2026-08-11T12:30:01.000Z';
  const snapshot = {
    ledger: 'SOLANA' as const,
    chainId: 'solana-mainnet' as const,
    slot: '300000001',
    blockhash: '3ySAYPQqMfpyZL6QhH4RzgT68HWpV72G2JAa2XWrpHEi',
    parentSlot: '300000000',
    previousBlockhash: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi',
    commitment: 'finalized' as const,
    blockTimestamp: '2026-08-11T12:30:00.000Z',
    capturedAt,
    providerVersions: { 'solana-rpc@integration': 'solana-json-rpc' },
    adapterVersions: { solana: 'integration' },
    configHash: '7'.repeat(64),
    entityModelVersion: 'entity-v0.1.0',
    labelSnapshot: 'labels-v1',
  };

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    reports = new PostgresSolanaControlSurfaceRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => {
    await Promise.all([evidence.close(), reports.close()]);
  });

  it('persists, replays, and rejects mutation of a Solana provenance root', async () => {
    const raw = createEvidence({
      ledger: 'SOLANA',
      chainId: snapshot.chainId,
      kind: 'ACCOUNT_STATE',
      source: 'solana-rpc@integration',
      locator: `solana-account-set:${subject}@${snapshot.slot}`,
      payload: { owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', space: 82 },
      observedAt: capturedAt,
      blockOrSlot: snapshot.slot,
      finality: snapshot.commitment,
      summary: 'Solana control integration account state.',
    });
    const terminal = createEvidence({
      ledger: 'SOLANA',
      chainId: snapshot.chainId,
      kind: 'DERIVED_FEATURE',
      source: 'zerotrace:solana-control-surface-v1.0.0',
      locator: `solana-control-surface-report:${subject}@${snapshot.blockhash}`,
      payload: { subject, snapshotHash: snapshot.blockhash },
      observedAt: capturedAt,
      blockOrSlot: snapshot.slot,
      finality: snapshot.commitment,
      summary: 'Solana control integration terminal root.',
      sourceEvidenceIds: [raw.id],
    });
    await evidence.put(raw, [], snapshot);
    await evidence.put(terminal, [raw.id], snapshot);

    const report: SolanaControlSurfaceReport = {
      ledger: 'SOLANA',
      chainId: snapshot.chainId,
      subject,
      accountKind: { state: 'known', value: 'SPL_TOKEN_MINT' },
      ownerProgram: {
        state: 'known',
        value: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      },
      executable: { state: 'known', value: false },
      mint: {
        state: 'known',
        value: {
          tokenProgram: 'SPL_TOKEN',
          supply: '0',
          decimals: 9,
          initialized: true,
          mintAuthority: { state: 'unknown', reason: 'NOT_APPLICABLE' },
          freezeAuthority: { state: 'unknown', reason: 'NOT_APPLICABLE' },
        },
      },
      tokenAccount: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      multisig: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      program: { state: 'unknown', reason: 'NOT_APPLICABLE' },
      extensions: [],
      sourceAgreement: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      sourceIndependence: { state: 'unknown', reason: 'INSUFFICIENT_DATA' },
      rights: [],
      coverage: SolanaControlCoverageDomainSchema.options.map((domain) => ({
        domain,
        observed:
          domain === 'ACCOUNT_STATE'
            ? ({ state: 'known', value: true } as const)
            : ({ state: 'unknown', reason: 'NOT_QUERIED' } as const),
        detail: `${domain} integration coverage.`,
        evidenceIds: domain === 'ACCOUNT_STATE' ? [raw.id] : [],
      })),
      terminalEvidenceId: terminal.id,
      metadata: {
        snapshot,
        dataCoverage: 1 / SolanaControlCoverageDomainSchema.options.length,
        sourceCoverage: 0.5,
        historyCoverage: 0,
        simulationCoverage: 0,
        freshness: snapshot.blockTimestamp,
        sourceSet: ['solana-rpc@integration'],
        modelVersion: 'solana-control-surface-v1.0.0',
        confidence: 0.8,
        evidenceIds: [raw.id, terminal.id].sort(),
      },
      evidence: [raw, terminal].sort((left, right) => left.id.localeCompare(right.id)),
    };

    const stored = await reports.put(report);
    await expect(reports.put(report)).resolves.toEqual(stored);
    await reports.close();
    reports = new PostgresSolanaControlSurfaceRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(reports.get(stored.id)).resolves.toEqual(stored);
    await expect(reports.latest(subject)).resolves.toEqual(stored);
    await expect(reports.health()).resolves.toMatchObject({ status: 'UP', durable: true });

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE solana_control_surface_reports SET report = report WHERE id = $1', [
          stored.id,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM solana_control_surface_reports WHERE id = $1', [stored.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool.end();
    }
  });
});

postgresDescribe('PostgreSQL durable Solana transaction intelligence integration', () => {
  let evidence: PostgresEvidenceRepository;
  let reports: PostgresSolanaTransactionReportRepository;
  const signature = solanaReportSignature;

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    reports = new PostgresSolanaTransactionReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => {
    await Promise.all([evidence.close(), reports.close()]);
  });

  it('persists a production-query report, replays after repository restart, and rejects mutation', async () => {
    const adapter = new SolanaLedgerAdapter(
      { id: 'solana-rpc@integration', commitment: 'finalized' },
      new SolanaTransactionFixtureTransport(),
    );
    const queried = await querySolanaTransaction(
      adapter,
      {
        ledger: 'SOLANA',
        chainId: 'solana-mainnet',
        type: 'TRANSACTION',
        id: signature,
        normalizedId: signature,
        validation: 'STRUCTURALLY_VALID',
        confidence: 1,
      },
      async (item, sourceEvidenceIds = [], itemSnapshot) =>
        (await evidence.put(item, sourceEvidenceIds, itemSnapshot)).evidence,
    );
    const report = SolanaTransactionIntelligenceReportSchema.parse(queried);
    expect(report.evidence).toHaveLength(2);
    expect(report.facts.coreAssetFlowCount).toEqual({ state: 'known', value: 0 });
    expect(report.facts.tokenFlowReconciliation).toMatchObject({
      state: 'known',
      value: { status: 'NOT_APPLICABLE', recommendedMaxRelativeError: 0 },
    });

    const stored = await reports.put(report);
    await expect(reports.put(report)).resolves.toEqual(stored);
    await reports.close();
    reports = new PostgresSolanaTransactionReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(reports.get(stored.id)).resolves.toEqual(stored);
    await expect(reports.latest(signature)).resolves.toEqual(stored);
    await expect(reports.health()).resolves.toMatchObject({ status: 'UP', durable: true });

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE solana_transaction_reports SET report = report WHERE id = $1', [
          stored.id,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM solana_transaction_reports WHERE id = $1', [stored.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool.end();
    }
  });
});

postgresDescribe('PostgreSQL durable EVM pension candidate integration', () => {
  let evidence: PostgresEvidenceRepository;
  let reports: PostgresPensionCandidateReportRepository;
  const token = `0x${randomUUID().replaceAll('-', '').padEnd(40, '0')}`;
  const candidate = `0x${'d'.repeat(40)}`;
  const shareUnit = 1_000_000n;
  const reportSnapshot = {
    ledger: 'EVM' as const,
    chainId: 'eip155:56',
    blockNumber: '120',
    blockHash: `0x${'f'.repeat(64)}`,
    parentBlockHash: `0x${'e'.repeat(64)}`,
    finality: 'finalized' as const,
    blockTimestamp: '2026-08-10T00:01:00.000Z',
    capturedAt: '2026-08-10T00:01:01.000Z',
    providerVersions: {
      'bsc-rpc@test.example': 'evm-ledger-v0.1.0',
      'sqd:binance-mainnet': 'sqd-finalized-v1',
    },
    adapterVersions: { evm: 'evm-ledger-v0.1.0' },
    configHash: '7'.repeat(64),
    entityModelVersion: 'entity-model-unapplied',
    labelSnapshot: 'labels-unapplied',
  };

  beforeAll(() => {
    evidence = PostgresEvidenceRepository.fromConnectionString({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    reports = new PostgresPensionCandidateReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
  });

  afterAll(async () => {
    await Promise.all([evidence.close(), reports.close()]);
  });

  it('persists a production-composed behavioral report, replays it, and rejects mutation', async () => {
    const indexed = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
    const logs: EvmLogRecord[] = [2, 3, 4].map((digit, index) => ({
      address: token,
      blockHash: `0x${String(digit).repeat(64)}`,
      blockNumber: `0x${(101 + index).toString(16)}`,
      blockTimestamp: `2026-08-0${index + 2}T00:00:00.000Z`,
      transactionHash: `0x${String(digit).repeat(64)}`,
      transactionIndex: '0x0',
      logIndex: '0x0',
      data: `0x${shareUnit.toString(16).padStart(64, '0')}`,
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        indexed(`0x${String(digit).repeat(40)}`),
        indexed(candidate),
      ],
      removed: false,
      raw: { integration: true },
    }));
    const logReader = {
      getLogsObservation: async (query: EvmLogQuery) => {
        expect(query).toMatchObject({ address: token, fromBlock: '100', toBlock: '120' });
        return { endpointId: 'sqd:binance-mainnet', value: logs };
      },
    };
    const run = await discoverEvmPensionCandidates({
      tokenAddress: token,
      fromBlock: '100',
      toBlock: '120',
      snapshot: reportSnapshot,
      policy: {
        shareUnitAtomic: shareUnit.toString(),
        minimumExactUnitDeposits: 3,
        minimumUniqueExactUnitDepositors: 3,
        maximumCandidates: 20,
      },
      logReader,
      writeEvidence: async (item, sourceEvidenceIds = [], itemSnapshot) =>
        (await evidence.put(item, sourceEvidenceIds, itemSnapshot)).evidence,
      now: () => '2026-08-10T00:01:02.000Z',
    });
    expect(run.report.candidates).toEqual([
      expect.objectContaining({
        address: candidate,
        exactUnitDepositCount: 3,
        roleAttribution: expect.objectContaining({
          state: 'unknown',
          reason: 'INSUFFICIENT_DATA',
        }),
      }),
    ]);

    const stored = await reports.put(run.report);
    await expect(reports.put(run.report)).resolves.toEqual(stored);
    await reports.close();
    reports = new PostgresPensionCandidateReportRepository({
      connectionString: connectionString as string,
      maxConnections: 2,
    });
    await expect(reports.get(stored.id)).resolves.toEqual(stored);
    await expect(reports.latest(token)).resolves.toEqual(stored);
    await expect(reports.health()).resolves.toMatchObject({ status: 'UP', durable: true });

    const pool = new Pool({ connectionString: connectionString as string });
    try {
      await expect(
        pool.query('UPDATE evm_pension_candidate_reports SET report = report WHERE id = $1', [
          stored.id,
        ]),
      ).rejects.toThrow(/immutable/);
      await expect(
        pool.query('DELETE FROM evm_pension_candidate_reports WHERE id = $1', [stored.id]),
      ).rejects.toThrow(/immutable/);
    } finally {
      await pool.end();
    }
  });
});
