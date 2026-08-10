import { Pool } from 'pg';

import { evidenceIdFor, hashPayload, type EvidenceNode } from '@zerotrace/evidence';
import {
  AnalysisSnapshotSchema,
  EvidenceSchema,
  type AnalysisSnapshot,
  type Evidence,
} from '@zerotrace/schemas';

export * from './raw-artifacts.js';
export * from './clickhouse.js';
export * from './ingestion-checkpoints.js';
export * from './semantic-checkpoints.js';
export * from './data-quality.js';

type DatabaseRow = Record<string, unknown>;

export interface DatabaseQueryResult {
  rows: DatabaseRow[];
  rowCount: number | null;
}

export interface DatabaseClient {
  query(text: string, values?: readonly unknown[]): Promise<DatabaseQueryResult>;
  release(): void;
}

export interface DatabasePool {
  query(text: string, values?: readonly unknown[]): Promise<DatabaseQueryResult>;
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
}

export type StorageErrorCode =
  | 'STORAGE_UNAVAILABLE'
  | 'STORAGE_NOT_INITIALIZED'
  | 'STORAGE_WRITE_FAILED'
  | 'STORAGE_READ_FAILED'
  | 'EVIDENCE_ID_MISMATCH'
  | 'EVIDENCE_PROVENANCE_INVALID'
  | 'EVIDENCE_CONFLICT'
  | 'SNAPSHOT_CONFLICT';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: StorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'StorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StorageHealth {
  status: 'UP' | 'DOWN';
  backend: 'POSTGRES';
  durable: true;
  checkedAt: string;
  errorCode?: StorageErrorCode;
}

export interface EvidenceRepository {
  put(
    evidence: Evidence,
    sourceEvidenceIds?: readonly string[],
    snapshot?: AnalysisSnapshot,
  ): Promise<EvidenceNode>;
  get(id: string): Promise<EvidenceNode | undefined>;
  drilldown(id: string): Promise<EvidenceNode[]>;
  health(): Promise<StorageHealth>;
  close(): Promise<void>;
}

export interface PostgresRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

function nodePostgresPool(options: PostgresRepositoryOptions): DatabasePool {
  const pool = new Pool({
    connectionString: options.connectionString,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 10_000,
    max: options.maxConnections ?? 10,
    idleTimeoutMillis: 30_000,
  });
  // node-postgres emits idle-client failures on the pool. Registering a listener prevents an
  // otherwise unhandled event; readiness still verifies the database with an actual query.
  pool.on('error', () => undefined);
  const values = (input: readonly unknown[] | undefined): unknown[] | undefined =>
    input === undefined ? undefined : [...input];
  return {
    query: async (text, parameters) => {
      const result = await pool.query(text, values(parameters));
      return { rows: result.rows as DatabaseRow[], rowCount: result.rowCount };
    },
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (text, parameters) => {
          const result = await client.query(text, values(parameters));
          return { rows: result.rows as DatabaseRow[], rowCount: result.rowCount };
        },
        release: () => client.release(),
      };
    },
    end: () => pool.end(),
  };
}

function sources(sourceEvidenceIds: readonly string[]): string[] {
  return [...new Set(sourceEvidenceIds)].sort();
}

function requiredString(row: DatabaseRow, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new StorageError('STORAGE_READ_FAILED', `Stored ${field} is invalid.`);
  }
  return value;
}

function optionalString(row: DatabaseRow, field: string): string | undefined {
  const value = row[field];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new StorageError('STORAGE_READ_FAILED', `Stored ${field} is invalid.`);
  }
  return value;
}

function timestamp(row: DatabaseRow, field: string): string {
  const value = row[field];
  const date = value instanceof Date ? value : new Date(requiredString(row, field));
  if (Number.isNaN(date.getTime())) {
    throw new StorageError('STORAGE_READ_FAILED', `Stored ${field} is invalid.`);
  }
  return date.toISOString();
}

function jsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new StorageError('STORAGE_READ_FAILED', 'Stored JSON is invalid.', { cause: error });
  }
}

function parseStoredSnapshot(value: unknown): AnalysisSnapshot {
  const parsed = jsonValue(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return AnalysisSnapshotSchema.parse(parsed);
  }
  const record = parsed as Record<string, unknown>;
  if (Object.hasOwn(record, 'finality')) return AnalysisSnapshotSchema.parse(record);
  if (record.ledger === 'BITCOIN') {
    return AnalysisSnapshotSchema.parse({ ...record, finality: 'best-chain' });
  }
  if (record.ledger === 'EVM') {
    const providerVersions = record.providerVersions;
    const wasFinalizedIngestion =
      typeof providerVersions === 'object' &&
      providerVersions !== null &&
      !Array.isArray(providerVersions) &&
      Object.values(providerVersions).some(
        (version) => typeof version === 'string' && version.includes('sqd-portal-finalized-http'),
      );
    return AnalysisSnapshotSchema.parse({
      ...record,
      finality: wasFinalizedIngestion ? 'finalized' : 'latest',
    });
  }
  return AnalysisSnapshotSchema.parse(record);
}

function rowToNode(row: DatabaseRow): EvidenceNode {
  const rawSources = row.source_evidence_ids;
  if (!Array.isArray(rawSources) || rawSources.some((value) => typeof value !== 'string')) {
    throw new StorageError('STORAGE_READ_FAILED', 'Stored Evidence edges are invalid.');
  }
  const evidence = EvidenceSchema.parse({
    id: requiredString(row, 'id'),
    ledger: requiredString(row, 'ledger'),
    chainId: requiredString(row, 'chain_id'),
    kind: requiredString(row, 'evidence_kind'),
    source: requiredString(row, 'source'),
    locator: requiredString(row, 'locator'),
    payloadHash: requiredString(row, 'payload_hash'),
    observedAt: timestamp(row, 'observed_at'),
    summary: requiredString(row, 'summary'),
    ...(optionalString(row, 'source_uri') === undefined
      ? {}
      : { sourceUri: optionalString(row, 'source_uri') }),
    ...(optionalString(row, 'block_or_slot') === undefined
      ? {}
      : { blockOrSlot: optionalString(row, 'block_or_slot') }),
    ...(optionalString(row, 'finality') === undefined
      ? {}
      : { finality: optionalString(row, 'finality') }),
    ...(optionalString(row, 'raw_artifact_ref') === undefined
      ? {}
      : { rawArtifactRef: optionalString(row, 'raw_artifact_ref') }),
  });
  const snapshotPayload = row.snapshot_payload;
  const snapshot =
    snapshotPayload === null || snapshotPayload === undefined
      ? undefined
      : parseStoredSnapshot(snapshotPayload);
  const normalizedSources = sources(rawSources as string[]);
  if (evidence.id !== evidenceIdFor(evidence, normalizedSources)) {
    throw new StorageError(
      'EVIDENCE_ID_MISMATCH',
      'Stored Evidence ID does not match its observation and derivation sources.',
    );
  }
  validateSnapshot(evidence, snapshot);
  return {
    evidence,
    sourceEvidenceIds: normalizedSources,
    ...(snapshot === undefined ? {} : { snapshot }),
  };
}

function snapshotPosition(snapshot: AnalysisSnapshot): string {
  switch (snapshot.ledger) {
    case 'EVM':
      return snapshot.blockNumber;
    case 'BITCOIN':
      return snapshot.height;
    case 'SOLANA':
      return snapshot.slot;
  }
}

function snapshotHash(snapshot: AnalysisSnapshot): string {
  return snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
}

function validateSnapshot(evidence: Evidence, snapshot: AnalysisSnapshot | undefined): void {
  if (snapshot === undefined) return;
  if (snapshot.ledger !== evidence.ledger || snapshot.chainId !== evidence.chainId) {
    throw new StorageError(
      'SNAPSHOT_CONFLICT',
      'Evidence and Snapshot must use the same ledger and chain.',
    );
  }
  if (evidence.blockOrSlot !== undefined && evidence.blockOrSlot !== snapshotPosition(snapshot)) {
    throw new StorageError('SNAPSHOT_CONFLICT', 'Evidence and Snapshot positions do not match.');
  }
}

const SELECT_EVIDENCE = `
  SELECT
    e.*,
    s.payload AS snapshot_payload,
    COALESCE(
      array_agg(ee.source_evidence_id ORDER BY ee.source_evidence_id)
        FILTER (WHERE ee.source_evidence_id IS NOT NULL),
      ARRAY[]::text[]
    ) AS source_evidence_ids
  FROM evidence e
  LEFT JOIN analysis_snapshots s ON s.id = e.snapshot_id
  LEFT JOIN evidence_edges ee ON ee.derived_evidence_id = e.id
  WHERE e.id = $1
  GROUP BY e.id, s.payload
`;

const SELECT_DRILLDOWN = `
  WITH RECURSIVE walk(id, depth, path) AS (
    SELECT e.id, 0, ARRAY[e.id]::text[]
    FROM evidence e
    WHERE e.id = $1
    UNION ALL
    SELECT ee.source_evidence_id, walk.depth + 1, walk.path || ee.source_evidence_id
    FROM walk
    JOIN evidence_edges ee ON ee.derived_evidence_id = walk.id
    WHERE NOT ee.source_evidence_id = ANY(walk.path)
  ), nearest AS (
    SELECT id, MIN(depth) AS depth
    FROM walk
    GROUP BY id
  )
  SELECT
    e.*,
    s.payload AS snapshot_payload,
    nearest.depth,
    COALESCE(
      array_agg(edges.source_evidence_id ORDER BY edges.source_evidence_id)
        FILTER (WHERE edges.source_evidence_id IS NOT NULL),
      ARRAY[]::text[]
    ) AS source_evidence_ids
  FROM nearest
  JOIN evidence e ON e.id = nearest.id
  LEFT JOIN analysis_snapshots s ON s.id = e.snapshot_id
  LEFT JOIN evidence_edges edges ON edges.derived_evidence_id = e.id
  GROUP BY e.id, s.payload, nearest.depth
  ORDER BY nearest.depth, e.id
`;

export class PostgresEvidenceRepository implements EvidenceRepository {
  readonly #pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.#pool = pool;
  }

  static fromConnectionString(options: PostgresRepositoryOptions): PostgresEvidenceRepository {
    return new PostgresEvidenceRepository(nodePostgresPool(options));
  }

  async put(
    evidence: Evidence,
    sourceEvidenceIds: readonly string[] = [],
    snapshot?: AnalysisSnapshot,
  ): Promise<EvidenceNode> {
    const parsedEvidence = EvidenceSchema.parse(evidence);
    const parsedSnapshot =
      snapshot === undefined ? undefined : AnalysisSnapshotSchema.parse(snapshot);
    const normalizedSources = sources(sourceEvidenceIds);
    if (
      (parsedEvidence.kind === 'DERIVED_FEATURE' || parsedEvidence.kind === 'NEGATIVE_EVIDENCE') &&
      normalizedSources.length === 0
    ) {
      throw new StorageError(
        'EVIDENCE_PROVENANCE_INVALID',
        `${parsedEvidence.kind} requires at least one source observation.`,
      );
    }
    if (
      normalizedSources.length > 0 &&
      !['DERIVED_FEATURE', 'NEGATIVE_EVIDENCE', 'ANALYST_OBSERVATION'].includes(parsedEvidence.kind)
    ) {
      throw new StorageError(
        'EVIDENCE_PROVENANCE_INVALID',
        `${parsedEvidence.kind} may not derive from another observation.`,
      );
    }
    if (parsedEvidence.id !== evidenceIdFor(parsedEvidence, normalizedSources)) {
      throw new StorageError(
        'EVIDENCE_ID_MISMATCH',
        'Evidence ID does not match its observation and derivation sources.',
      );
    }
    validateSnapshot(parsedEvidence, parsedSnapshot);

    let client: DatabaseClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw new StorageError('STORAGE_UNAVAILABLE', 'Durable Evidence storage is unavailable.', {
        retryable: true,
        cause: error,
      });
    }

    try {
      await client.query('BEGIN');
      const snapshotId =
        parsedSnapshot === undefined ? undefined : await this.#putSnapshot(client, parsedSnapshot);
      const evidenceInsert = await client.query(
        `
          INSERT INTO evidence (
            id, ledger, chain_id, evidence_kind, source, locator, source_uri, payload_hash,
            observed_at, block_or_slot, finality, summary, raw_artifact_ref, snapshot_id
          ) VALUES (
            $1, $2::ledger_kind, $3, $4, $5, $6, $7, $8, $9::timestamptz,
            $10::numeric, $11, $12, $13, $14::uuid
          )
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `,
        [
          parsedEvidence.id,
          parsedEvidence.ledger,
          parsedEvidence.chainId,
          parsedEvidence.kind,
          parsedEvidence.source,
          parsedEvidence.locator,
          parsedEvidence.sourceUri ?? null,
          parsedEvidence.payloadHash,
          parsedEvidence.observedAt,
          parsedEvidence.blockOrSlot ?? null,
          parsedEvidence.finality ?? null,
          parsedEvidence.summary,
          parsedEvidence.rawArtifactRef ?? null,
          snapshotId ?? null,
        ],
      );
      if (evidenceInsert.rowCount !== 0 && evidenceInsert.rowCount !== 1) {
        throw new StorageError('STORAGE_WRITE_FAILED', 'Evidence insert returned invalid state.');
      }
      if (evidenceInsert.rowCount === 1) {
        for (const sourceId of normalizedSources) {
          await client.query(
            `
              INSERT INTO evidence_edges (derived_evidence_id, source_evidence_id)
              VALUES ($1, $2)
            `,
            [parsedEvidence.id, sourceId],
          );
        }
      }
      const stored = await this.#getWith(client, parsedEvidence.id);
      if (stored === undefined) {
        throw new StorageError('STORAGE_WRITE_FAILED', 'Evidence was not stored.', {
          retryable: true,
        });
      }
      if (
        hashPayload(stored.evidence) !== hashPayload(parsedEvidence) ||
        hashPayload(stored.sourceEvidenceIds) !== hashPayload(normalizedSources)
      ) {
        throw new StorageError(
          'EVIDENCE_CONFLICT',
          'Stored Evidence conflicts with the canonical observation.',
        );
      }
      if (hashPayload(stored.snapshot ?? null) !== hashPayload(parsedSnapshot ?? null)) {
        throw new StorageError('SNAPSHOT_CONFLICT', 'Stored Evidence uses a different Snapshot.');
      }
      await client.query('COMMIT');
      return stored;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original storage failure.
      }
      if (error instanceof StorageError) throw error;
      throw new StorageError('STORAGE_WRITE_FAILED', 'Durable Evidence write failed.', {
        retryable: true,
        cause: error,
      });
    } finally {
      client.release();
    }
  }

  async get(id: string): Promise<EvidenceNode | undefined> {
    try {
      return await this.#getWith(this.#pool, id);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError('STORAGE_READ_FAILED', 'Durable Evidence read failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async drilldown(id: string): Promise<EvidenceNode[]> {
    try {
      const result = await this.#pool.query(SELECT_DRILLDOWN, [id]);
      return result.rows.map(rowToNode);
    } catch (error) {
      if (error instanceof StorageError) throw error;
      throw new StorageError('STORAGE_READ_FAILED', 'Evidence drilldown failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async health(): Promise<StorageHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const tables = await this.#pool.query(`
        SELECT
          to_regclass('public.evidence')::text AS evidence_table,
          to_regclass('public.evidence_edges')::text AS evidence_edges_table,
          to_regclass('public.analysis_snapshots')::text AS snapshots_table
      `);
      if (
        tables.rows[0]?.evidence_table !== 'evidence' ||
        tables.rows[0]?.evidence_edges_table !== 'evidence_edges' ||
        tables.rows[0]?.snapshots_table !== 'analysis_snapshots'
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'STORAGE_NOT_INITIALIZED',
        };
      }
      const migration = await this.#pool.query(
        `SELECT EXISTS (
          SELECT 1 FROM schema_migrations WHERE version = $1
        ) AS migration_applied`,
        ['006_snapshot_observation_identity'],
      );
      if (migration.rows[0]?.migration_applied !== true) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'STORAGE_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'STORAGE_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }

  async #getWith(
    queryable: Pick<DatabasePool, 'query'> | Pick<DatabaseClient, 'query'>,
    id: string,
  ): Promise<EvidenceNode | undefined> {
    const result = await queryable.query(SELECT_EVIDENCE, [id]);
    const row = result.rows[0];
    return row === undefined ? undefined : rowToNode(row);
  }

  async #putSnapshot(client: DatabaseClient, snapshot: AnalysisSnapshot): Promise<string> {
    const position = snapshotPosition(snapshot);
    const blockHash = snapshotHash(snapshot);
    const commitment = snapshot.ledger === 'SOLANA' ? snapshot.commitment : null;
    const inserted = await client.query(
      `
        INSERT INTO analysis_snapshots (
          ledger, chain_id, block_or_slot, block_hash, commitment, captured_at,
          provider_versions, adapter_versions, entity_model_version, label_snapshot,
          config_hash, payload
        ) VALUES (
          $1::ledger_kind, $2, $3::numeric, $4, $5, $6::timestamptz,
          $7::jsonb, $8::jsonb, $9, $10, $11, $12::jsonb
        )
        ON CONFLICT (
          ledger, chain_id, block_or_slot, block_hash, config_hash, captured_at
        ) DO NOTHING
        RETURNING id::text, payload
      `,
      [
        snapshot.ledger,
        snapshot.chainId,
        position,
        blockHash,
        commitment,
        snapshot.capturedAt,
        JSON.stringify(snapshot.providerVersions),
        JSON.stringify(snapshot.adapterVersions),
        snapshot.entityModelVersion,
        snapshot.labelSnapshot,
        snapshot.configHash,
        JSON.stringify(snapshot),
      ],
    );
    const existing =
      inserted.rows[0] ??
      (
        await client.query(
          `
            SELECT id::text, payload
            FROM analysis_snapshots
            WHERE ledger = $1::ledger_kind
              AND chain_id = $2
              AND block_or_slot = $3::numeric
              AND block_hash = $4
              AND config_hash = $5
              AND captured_at = $6::timestamptz
          `,
          [
            snapshot.ledger,
            snapshot.chainId,
            position,
            blockHash,
            snapshot.configHash,
            snapshot.capturedAt,
          ],
        )
      ).rows[0];
    if (existing === undefined) {
      throw new StorageError('STORAGE_WRITE_FAILED', 'Snapshot was not stored.', {
        retryable: true,
      });
    }
    const storedSnapshot = parseStoredSnapshot(existing.payload);
    if (hashPayload(storedSnapshot) !== hashPayload(snapshot)) {
      throw new StorageError('SNAPSHOT_CONFLICT', 'Stored Snapshot content conflicts.');
    }
    return requiredString(existing, 'id');
  }
}
