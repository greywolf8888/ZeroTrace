import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  EntityInvestigationGraphTimelineReportSchema,
  type EntityInvestigationGraphTimelineReport,
  type Ledger,
} from '@zerotrace/schemas';

export interface EntityInvestigationGraphTimelineRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface GraphTimelinePool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export type EntityInvestigationGraphTimelineStorageErrorCode =
  | 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID'
  | 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_CONFLICT'
  | 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE'
  | 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_NOT_INITIALIZED';

export class EntityInvestigationGraphTimelineStorageError extends Error {
  readonly code: EntityInvestigationGraphTimelineStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: EntityInvestigationGraphTimelineStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'EntityInvestigationGraphTimelineStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredEntityInvestigationGraphTimeline {
  id: string;
  ledger: Ledger;
  chainId: string;
  fromPosition: string;
  toPosition: string;
  graphSetHash: string;
  resultHash: string;
  report: EntityInvestigationGraphTimelineReport;
  terminalEvidenceId: string;
  graphIds: readonly string[];
  subjectIds: readonly string[];
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: 'entity-investigation-graph-timeline-v0.1.0';
  capturedAt: string;
  createdAt: string;
}

type MaterializedGraphTimeline = Omit<StoredEntityInvestigationGraphTimeline, 'createdAt'>;

const SELECT_TIMELINE = `
  SELECT
    id, ledger, chain_id, from_position::text, to_position::text, graph_set_hash,
    result_hash, report, terminal_evidence_id, graph_ids, subject_ids, evidence_ids,
    source_set, model_version, captured_at, created_at
  FROM entity_investigation_graph_timeline_reports
`;

function createPool(options: EntityInvestigationGraphTimelineRepositoryOptions): GraphTimelinePool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-entity-investigation-graph-timelines',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): EntityInvestigationGraphTimelineStorageError {
  return new EntityInvestigationGraphTimelineStorageError(
    'ENTITY_INVESTIGATION_GRAPH_TIMELINE_INVALID',
    message,
    { ...(cause === undefined ? {} : { cause }) },
  );
}

function conflict(message: string, cause?: unknown): EntityInvestigationGraphTimelineStorageError {
  return new EntityInvestigationGraphTimelineStorageError(
    'ENTITY_INVESTIGATION_GRAPH_TIMELINE_CONFLICT',
    message,
    { ...(cause === undefined ? {} : { cause }) },
  );
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored Entity investigation graph timeline ${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored Entity investigation graph timeline ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored Entity investigation graph timeline is not JSON.', error);
  }
}

function stringArray(value: unknown, field: string, sorted: boolean): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw conflict(`Stored Entity investigation graph timeline ${field} is invalid.`);
  }
  const parsed = value as string[];
  if (new Set(parsed).size !== parsed.length) {
    throw conflict(`Stored Entity investigation graph timeline ${field} contains duplicates.`);
  }
  if (sorted && parsed.some((item, index) => item !== [...parsed].sort()[index])) {
    throw conflict(`Stored Entity investigation graph timeline ${field} is not canonical.`);
  }
  return parsed;
}

function materialize(input: EntityInvestigationGraphTimelineReport): MaterializedGraphTimeline {
  const parsed = EntityInvestigationGraphTimelineReportSchema.safeParse(input);
  if (!parsed.success)
    throw invalid('Entity investigation graph timeline report is invalid.', parsed.error);
  const report = parsed.data;
  const terminal = report.evidence.find((item) => item.id === report.terminalEvidenceId);
  if (
    terminal === undefined ||
    terminal.payloadHash !== hashPayload({ timeline: report.timeline })
  ) {
    throw invalid(
      'Entity investigation graph timeline terminal Evidence payload does not match the report.',
    );
  }
  const resultHash = hashPayload(report);
  const subjectIds = [
    ...new Set(report.timeline.observations.flatMap((item) => item.subjectIds)),
  ].sort();
  return {
    id: `eit_${hashPayload({ schema: 'zerotrace-entity-investigation-graph-timeline-report-v1', resultHash }).slice(0, 24)}`,
    ledger: report.timeline.request.ledger,
    chainId: report.timeline.request.chainId,
    fromPosition: report.timeline.request.fromPosition,
    toPosition: report.timeline.request.toPosition,
    graphSetHash: report.timeline.request.graphSetHash,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    graphIds: report.timeline.request.graphIds,
    subjectIds,
    evidenceIds: report.evidence.map((item) => item.id).sort(),
    sourceSet: report.timeline.metadata.sourceSet,
    modelVersion: 'entity-investigation-graph-timeline-v0.1.0',
    capturedAt: new Date(report.timeline.metadata.snapshot.capturedAt).toISOString(),
  };
}

function assertSame(
  stored: StoredEntityInvestigationGraphTimeline,
  expected: MaterializedGraphTimeline,
): void {
  if (
    stored.id !== expected.id ||
    stored.ledger !== expected.ledger ||
    stored.chainId !== expected.chainId ||
    stored.fromPosition !== expected.fromPosition ||
    stored.toPosition !== expected.toPosition ||
    stored.graphSetHash !== expected.graphSetHash ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.capturedAt !== expected.capturedAt ||
    canonicalJson(stored.graphIds) !== canonicalJson(expected.graphIds) ||
    canonicalJson(stored.subjectIds) !== canonicalJson(expected.subjectIds) ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw conflict(
      'Stored Entity investigation graph timeline conflicts with the canonical report.',
    );
  }
}

function rowToTimeline(row: Record<string, unknown>): StoredEntityInvestigationGraphTimeline {
  const parsed = EntityInvestigationGraphTimelineReportSchema.safeParse(json(row.report));
  if (!parsed.success)
    throw conflict('Stored Entity investigation graph timeline payload is invalid.', parsed.error);
  const stored: StoredEntityInvestigationGraphTimeline = {
    id: requiredString(row, 'id'),
    ledger: requiredString(row, 'ledger') as Ledger,
    chainId: requiredString(row, 'chain_id'),
    fromPosition: requiredString(row, 'from_position'),
    toPosition: requiredString(row, 'to_position'),
    graphSetHash: requiredString(row, 'graph_set_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    graphIds: stringArray(row.graph_ids, 'graph IDs', false),
    subjectIds: stringArray(row.subject_ids, 'subject IDs', true),
    evidenceIds: stringArray(row.evidence_ids, 'Evidence IDs', true),
    sourceSet: stringArray(row.source_set, 'source set', true),
    modelVersion: requiredString(
      row,
      'model_version',
    ) as 'entity-investigation-graph-timeline-v0.1.0',
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function timelineId(value: string): string {
  if (!/^eit_[0-9a-f]{24}$/.test(value))
    throw invalid('Entity investigation graph timeline ID is invalid.');
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
    throw invalid('Entity investigation graph timeline identity is invalid.');
  }
  return { ledger: input.ledger, chainId, ...(subjectId === undefined ? {} : { subjectId }) };
}

export class PostgresEntityInvestigationGraphTimelineRepository {
  readonly #pool: GraphTimelinePool;

  constructor(
    options: EntityInvestigationGraphTimelineRepositoryOptions | { pool: GraphTimelinePool },
  ) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: GraphTimelinePool): PostgresEntityInvestigationGraphTimelineRepository {
    return new PostgresEntityInvestigationGraphTimelineRepository({ pool });
  }

  async put(
    report: EntityInvestigationGraphTimelineReport,
  ): Promise<StoredEntityInvestigationGraphTimeline> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO entity_investigation_graph_timeline_reports (
          id, ledger, chain_id, from_position, to_position, graph_set_hash,
          result_hash, report, terminal_evidence_id, graph_ids, subject_ids,
          evidence_ids, source_set, model_version, captured_at
        ) VALUES (
          $1, $2::ledger_kind, $3, $4::numeric, $5::numeric, $6,
          $7, $8::jsonb, $9, $10::text[], $11::text[],
          $12::text[], $13::text[], $14, $15::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.ledger,
          expected.chainId,
          expected.fromPosition,
          expected.toPosition,
          expected.graphSetHash,
          expected.resultHash,
          canonicalJson(expected.report),
          expected.terminalEvidenceId,
          expected.graphIds,
          expected.subjectIds,
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.capturedAt,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined)
        throw conflict('Entity investigation graph timeline was not stored.');
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof EntityInvestigationGraphTimelineStorageError) throw error;
      throw new EntityInvestigationGraphTimelineStorageError(
        'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
        'Entity investigation graph timeline write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredEntityInvestigationGraphTimeline | undefined> {
    const expectedId = timelineId(id);
    try {
      const result = await this.#pool.query(`${SELECT_TIMELINE} WHERE id = $1`, [expectedId]);
      return result.rows[0] === undefined ? undefined : rowToTimeline(result.rows[0]);
    } catch (error) {
      if (error instanceof EntityInvestigationGraphTimelineStorageError) throw error;
      throw new EntityInvestigationGraphTimelineStorageError(
        'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
        'Entity investigation graph timeline read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(input: {
    ledger: Ledger;
    chainId: string;
    subjectId?: string;
  }): Promise<StoredEntityInvestigationGraphTimeline | undefined> {
    const expected = identity(input);
    try {
      const result = await this.#pool.query(
        `${SELECT_TIMELINE}
         WHERE ledger = $1::ledger_kind AND chain_id = $2
           AND ($3::text IS NULL OR subject_ids @> ARRAY[$3]::text[])
         ORDER BY to_position DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [expected.ledger, expected.chainId, expected.subjectId ?? null],
      );
      return result.rows[0] === undefined ? undefined : rowToTimeline(result.rows[0]);
    } catch (error) {
      if (error instanceof EntityInvestigationGraphTimelineStorageError) throw error;
      throw new EntityInvestigationGraphTimelineStorageError(
        'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
        'Latest Entity investigation graph timeline read failed.',
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
      | 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE'
      | 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT to_regclass('public.entity_investigation_graph_timeline_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['021_entity_investigation_graph_timelines'],
      );
      if (
        result.rows[0]?.table_name !== 'entity_investigation_graph_timeline_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'ENTITY_INVESTIGATION_GRAPH_TIMELINE_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
