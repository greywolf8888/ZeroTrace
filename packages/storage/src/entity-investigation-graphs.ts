import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  EntityInvestigationGraphReportSchema,
  type EntityInvestigationGraphReport,
  type Ledger,
} from '@zerotrace/schemas';

export interface EntityInvestigationGraphRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface InvestigationGraphPool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export type EntityInvestigationGraphStorageErrorCode =
  | 'ENTITY_INVESTIGATION_GRAPH_INVALID'
  | 'ENTITY_INVESTIGATION_GRAPH_CONFLICT'
  | 'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE'
  | 'ENTITY_INVESTIGATION_GRAPH_NOT_INITIALIZED';

export class EntityInvestigationGraphStorageError extends Error {
  readonly code: EntityInvestigationGraphStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: EntityInvestigationGraphStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'EntityInvestigationGraphStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredEntityInvestigationGraph {
  id: string;
  ledger: Ledger;
  chainId: string;
  asOfPosition: string;
  asOfHash: string;
  timelineSetHash: string;
  resultHash: string;
  report: EntityInvestigationGraphReport;
  terminalEvidenceId: string;
  timelineIds: readonly string[];
  subjectIds: readonly string[];
  edgeIds: readonly string[];
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: 'entity-investigation-graph-v0.1.0';
  capturedAt: string;
  createdAt: string;
}

type MaterializedInvestigationGraph = Omit<StoredEntityInvestigationGraph, 'createdAt'>;

const SELECT_GRAPH = `
  SELECT
    id, ledger, chain_id, as_of_position::text, as_of_hash, timeline_set_hash,
    result_hash, report, terminal_evidence_id, timeline_ids, subject_ids, edge_ids,
    evidence_ids, source_set, model_version, captured_at, created_at
  FROM entity_investigation_graph_reports
`;

function createPool(options: EntityInvestigationGraphRepositoryOptions): InvestigationGraphPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-entity-investigation-graphs',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): EntityInvestigationGraphStorageError {
  return new EntityInvestigationGraphStorageError('ENTITY_INVESTIGATION_GRAPH_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): EntityInvestigationGraphStorageError {
  return new EntityInvestigationGraphStorageError('ENTITY_INVESTIGATION_GRAPH_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored entity investigation graph ${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored entity investigation graph ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored entity investigation graph is not JSON.', error);
  }
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw conflict(`Stored entity investigation graph ${field} is invalid.`);
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw conflict(`Stored entity investigation graph ${field} is not canonical.`);
  }
  return canonical;
}

function snapshotPosition(report: EntityInvestigationGraphReport): string {
  const snapshot = report.graph.metadata.snapshot;
  return snapshot.ledger === 'EVM'
    ? snapshot.blockNumber
    : snapshot.ledger === 'BITCOIN'
      ? snapshot.height
      : snapshot.slot;
}

function snapshotHash(report: EntityInvestigationGraphReport): string {
  const snapshot = report.graph.metadata.snapshot;
  return snapshot.ledger === 'SOLANA' ? snapshot.blockhash : snapshot.blockHash;
}

function materialize(input: EntityInvestigationGraphReport): MaterializedInvestigationGraph {
  const parsed = EntityInvestigationGraphReportSchema.safeParse(input);
  if (!parsed.success) throw invalid('Entity investigation graph report is invalid.', parsed.error);
  const report = parsed.data;
  const terminal = report.evidence.find((item) => item.id === report.terminalEvidenceId);
  if (terminal === undefined || terminal.payloadHash !== hashPayload({ graph: report.graph })) {
    throw invalid(
      'Entity investigation graph terminal Evidence payload does not match the report.',
    );
  }
  const resultHash = hashPayload(report);
  return {
    id: `eig_${hashPayload({ schema: 'zerotrace-entity-investigation-graph-report-v1', resultHash }).slice(0, 24)}`,
    ledger: report.graph.request.ledger,
    chainId: report.graph.request.chainId,
    asOfPosition: snapshotPosition(report),
    asOfHash: snapshotHash(report),
    timelineSetHash: report.graph.request.timelineSetHash,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    timelineIds: report.graph.request.timelineIds,
    subjectIds: report.graph.nodes.map((item) => item.subjectId).sort(),
    edgeIds: report.graph.edges.map((item) => item.id).sort(),
    evidenceIds: report.evidence.map((item) => item.id).sort(),
    sourceSet: report.graph.metadata.sourceSet,
    modelVersion: 'entity-investigation-graph-v0.1.0',
    capturedAt: new Date(report.graph.metadata.snapshot.capturedAt).toISOString(),
  };
}

function assertSame(
  stored: StoredEntityInvestigationGraph,
  expected: MaterializedInvestigationGraph,
): void {
  if (
    stored.id !== expected.id ||
    stored.ledger !== expected.ledger ||
    stored.chainId !== expected.chainId ||
    stored.asOfPosition !== expected.asOfPosition ||
    stored.asOfHash !== expected.asOfHash ||
    stored.timelineSetHash !== expected.timelineSetHash ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.capturedAt !== expected.capturedAt ||
    canonicalJson(stored.timelineIds) !== canonicalJson(expected.timelineIds) ||
    canonicalJson(stored.subjectIds) !== canonicalJson(expected.subjectIds) ||
    canonicalJson(stored.edgeIds) !== canonicalJson(expected.edgeIds) ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw conflict('Stored entity investigation graph conflicts with the canonical report.');
  }
}

function rowToGraph(row: Record<string, unknown>): StoredEntityInvestigationGraph {
  const parsed = EntityInvestigationGraphReportSchema.safeParse(json(row.report));
  if (!parsed.success)
    throw conflict('Stored entity investigation graph payload is invalid.', parsed.error);
  const stored: StoredEntityInvestigationGraph = {
    id: requiredString(row, 'id'),
    ledger: requiredString(row, 'ledger') as Ledger,
    chainId: requiredString(row, 'chain_id'),
    asOfPosition: requiredString(row, 'as_of_position'),
    asOfHash: requiredString(row, 'as_of_hash'),
    timelineSetHash: requiredString(row, 'timeline_set_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    timelineIds: canonicalStringArray(row.timeline_ids, 'timeline IDs'),
    subjectIds: canonicalStringArray(row.subject_ids, 'subject IDs'),
    edgeIds: canonicalStringArray(row.edge_ids, 'edge IDs'),
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version') as 'entity-investigation-graph-v0.1.0',
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function graphId(value: string): string {
  if (!/^eig_[0-9a-f]{24}$/.test(value)) throw invalid('Entity investigation graph ID is invalid.');
  return value;
}

function identity(input: { ledger: Ledger; chainId: string; subjectId?: string }) {
  const chainId = input.chainId.trim();
  const subjectId = input.subjectId?.trim();
  if (
    !['EVM', 'BITCOIN', 'SOLANA'].includes(input.ledger) ||
    chainId.length === 0 ||
    subjectId === ''
  ) {
    throw invalid('Entity investigation graph identity is invalid.');
  }
  return { ledger: input.ledger, chainId, ...(subjectId === undefined ? {} : { subjectId }) };
}

export class PostgresEntityInvestigationGraphRepository {
  readonly #pool: InvestigationGraphPool;

  constructor(
    options: EntityInvestigationGraphRepositoryOptions | { pool: InvestigationGraphPool },
  ) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: InvestigationGraphPool): PostgresEntityInvestigationGraphRepository {
    return new PostgresEntityInvestigationGraphRepository({ pool });
  }

  async put(report: EntityInvestigationGraphReport): Promise<StoredEntityInvestigationGraph> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO entity_investigation_graph_reports (
          id, ledger, chain_id, as_of_position, as_of_hash, timeline_set_hash,
          result_hash, report, terminal_evidence_id, timeline_ids, subject_ids, edge_ids,
          evidence_ids, source_set, model_version, captured_at
        ) VALUES (
          $1, $2::ledger_kind, $3, $4::numeric, $5, $6,
          $7, $8::jsonb, $9, $10::text[], $11::text[], $12::text[],
          $13::text[], $14::text[], $15, $16::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.ledger,
          expected.chainId,
          expected.asOfPosition,
          expected.asOfHash,
          expected.timelineSetHash,
          expected.resultHash,
          canonicalJson(expected.report),
          expected.terminalEvidenceId,
          expected.timelineIds,
          expected.subjectIds,
          expected.edgeIds,
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.capturedAt,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) throw conflict('Entity investigation graph was not stored.');
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof EntityInvestigationGraphStorageError) throw error;
      throw new EntityInvestigationGraphStorageError(
        'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
        'Entity investigation graph write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredEntityInvestigationGraph | undefined> {
    const expectedId = graphId(id);
    try {
      const result = await this.#pool.query(`${SELECT_GRAPH} WHERE id = $1`, [expectedId]);
      return result.rows[0] === undefined ? undefined : rowToGraph(result.rows[0]);
    } catch (error) {
      if (error instanceof EntityInvestigationGraphStorageError) throw error;
      throw new EntityInvestigationGraphStorageError(
        'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
        'Entity investigation graph read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(input: {
    ledger: Ledger;
    chainId: string;
    subjectId?: string;
  }): Promise<StoredEntityInvestigationGraph | undefined> {
    const expected = identity(input);
    try {
      const result = await this.#pool.query(
        `${SELECT_GRAPH}
         WHERE ledger = $1::ledger_kind AND chain_id = $2
           AND ($3::text IS NULL OR subject_ids @> ARRAY[$3]::text[])
         ORDER BY as_of_position DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [expected.ledger, expected.chainId, expected.subjectId ?? null],
      );
      return result.rows[0] === undefined ? undefined : rowToGraph(result.rows[0]);
    } catch (error) {
      if (error instanceof EntityInvestigationGraphStorageError) throw error;
      throw new EntityInvestigationGraphStorageError(
        'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
        'Latest entity investigation graph read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?:
      'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE' | 'ENTITY_INVESTIGATION_GRAPH_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT to_regclass('public.entity_investigation_graph_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['020_entity_investigation_graphs'],
      );
      if (
        result.rows[0]?.table_name !== 'entity_investigation_graph_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'ENTITY_INVESTIGATION_GRAPH_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'ENTITY_INVESTIGATION_GRAPH_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
