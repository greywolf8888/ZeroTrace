import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  EntityRelationshipTimelineReportSchema,
  type EntityRelationshipTimelineReport,
  type Ledger,
} from '@zerotrace/schemas';

export interface EntityRelationshipTimelineRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface TimelinePool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export type EntityRelationshipTimelineStorageErrorCode =
  | 'ENTITY_RELATIONSHIP_TIMELINE_INVALID'
  | 'ENTITY_RELATIONSHIP_TIMELINE_CONFLICT'
  | 'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE'
  | 'ENTITY_RELATIONSHIP_TIMELINE_NOT_INITIALIZED';

export class EntityRelationshipTimelineStorageError extends Error {
  readonly code: EntityRelationshipTimelineStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: EntityRelationshipTimelineStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'EntityRelationshipTimelineStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredEntityRelationshipTimeline {
  id: string;
  ledger: Ledger;
  chainId: string;
  subjectA: string;
  subjectB: string;
  fromPosition: string;
  toPosition: string;
  resultHash: string;
  report: EntityRelationshipTimelineReport;
  terminalEvidenceId: string;
  reportIds: readonly string[];
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: 'entity-timeline-v0.1.0';
  capturedAt: string;
  createdAt: string;
}

type MaterializedTimeline = Omit<StoredEntityRelationshipTimeline, 'createdAt'>;

const SELECT_TIMELINE = `
  SELECT
    id, ledger, chain_id, subject_a, subject_b, from_position::text, to_position::text,
    result_hash, report, terminal_evidence_id, report_ids, evidence_ids, source_set,
    model_version, captured_at, created_at
  FROM entity_relationship_timeline_reports
`;

function createPool(options: EntityRelationshipTimelineRepositoryOptions): TimelinePool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-entity-relationship-timelines',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): EntityRelationshipTimelineStorageError {
  return new EntityRelationshipTimelineStorageError(
    'ENTITY_RELATIONSHIP_TIMELINE_INVALID',
    message,
    {
      ...(cause === undefined ? {} : { cause }),
    },
  );
}

function conflict(message: string, cause?: unknown): EntityRelationshipTimelineStorageError {
  return new EntityRelationshipTimelineStorageError(
    'ENTITY_RELATIONSHIP_TIMELINE_CONFLICT',
    message,
    {
      ...(cause === undefined ? {} : { cause }),
    },
  );
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored entity relationship timeline ${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored entity relationship timeline ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored entity relationship timeline is not JSON.', error);
  }
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw conflict(`Stored entity relationship timeline ${field} is invalid.`);
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw conflict(`Stored entity relationship timeline ${field} is not canonical.`);
  }
  return canonical;
}

function materialize(input: EntityRelationshipTimelineReport): MaterializedTimeline {
  const parsed = EntityRelationshipTimelineReportSchema.safeParse(input);
  if (!parsed.success)
    throw invalid('Entity relationship timeline report is invalid.', parsed.error);
  const report = parsed.data;
  const terminal = report.evidence.find((item) => item.id === report.terminalEvidenceId);
  if (
    terminal === undefined ||
    terminal.payloadHash !== hashPayload({ timeline: report.timeline })
  ) {
    throw invalid(
      'Entity relationship timeline terminal Evidence payload does not match the report.',
    );
  }
  const resultHash = hashPayload(report);
  return {
    id: `ert_${hashPayload({ schema: 'zerotrace-entity-relationship-timeline-report-v1', resultHash }).slice(0, 24)}`,
    ledger: report.timeline.request.ledger,
    chainId: report.timeline.request.chainId,
    subjectA: report.timeline.request.subjectA,
    subjectB: report.timeline.request.subjectB,
    fromPosition: report.timeline.request.fromPosition,
    toPosition: report.timeline.request.toPosition,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    reportIds: report.timeline.observations.map((item) => item.reportId).sort(),
    evidenceIds: report.evidence.map((item) => item.id).sort(),
    sourceSet: report.timeline.metadata.sourceSet,
    modelVersion: 'entity-timeline-v0.1.0',
    capturedAt: new Date(report.timeline.metadata.snapshot.capturedAt).toISOString(),
  };
}

function assertSame(
  stored: StoredEntityRelationshipTimeline,
  expected: MaterializedTimeline,
): void {
  if (
    stored.id !== expected.id ||
    stored.ledger !== expected.ledger ||
    stored.chainId !== expected.chainId ||
    stored.subjectA !== expected.subjectA ||
    stored.subjectB !== expected.subjectB ||
    stored.fromPosition !== expected.fromPosition ||
    stored.toPosition !== expected.toPosition ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.capturedAt !== expected.capturedAt ||
    canonicalJson(stored.reportIds) !== canonicalJson(expected.reportIds) ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw conflict('Stored entity relationship timeline conflicts with the canonical report.');
  }
}

function rowToTimeline(row: Record<string, unknown>): StoredEntityRelationshipTimeline {
  const parsed = EntityRelationshipTimelineReportSchema.safeParse(json(row.report));
  if (!parsed.success)
    throw conflict('Stored entity relationship timeline payload is invalid.', parsed.error);
  const stored: StoredEntityRelationshipTimeline = {
    id: requiredString(row, 'id'),
    ledger: requiredString(row, 'ledger') as Ledger,
    chainId: requiredString(row, 'chain_id'),
    subjectA: requiredString(row, 'subject_a'),
    subjectB: requiredString(row, 'subject_b'),
    fromPosition: requiredString(row, 'from_position'),
    toPosition: requiredString(row, 'to_position'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    reportIds: canonicalStringArray(row.report_ids, 'report IDs'),
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version') as 'entity-timeline-v0.1.0',
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function timelineId(value: string): string {
  if (!/^ert_[0-9a-f]{24}$/.test(value))
    throw invalid('Entity relationship timeline ID is invalid.');
  return value;
}

function identity(input: { ledger: Ledger; chainId: string; subjectA: string; subjectB: string }) {
  const subjects = [input.subjectA.trim(), input.subjectB.trim()].sort();
  if (
    !['EVM', 'BITCOIN', 'SOLANA'].includes(input.ledger) ||
    input.chainId.trim().length === 0 ||
    subjects[0] === undefined ||
    subjects[1] === undefined ||
    subjects[0].length === 0 ||
    subjects[1].length === 0 ||
    subjects[0] === subjects[1]
  ) {
    throw invalid('Entity relationship timeline identity is invalid.');
  }
  return {
    ledger: input.ledger,
    chainId: input.chainId.trim(),
    subjectA: subjects[0],
    subjectB: subjects[1],
  };
}

export class PostgresEntityRelationshipTimelineRepository {
  readonly #pool: TimelinePool;

  constructor(options: EntityRelationshipTimelineRepositoryOptions | { pool: TimelinePool }) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: TimelinePool): PostgresEntityRelationshipTimelineRepository {
    return new PostgresEntityRelationshipTimelineRepository({ pool });
  }

  async put(report: EntityRelationshipTimelineReport): Promise<StoredEntityRelationshipTimeline> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO entity_relationship_timeline_reports (
          id, ledger, chain_id, subject_a, subject_b, from_position, to_position,
          result_hash, report, terminal_evidence_id, report_ids, evidence_ids, source_set,
          model_version, captured_at
        ) VALUES (
          $1, $2::ledger_kind, $3, $4, $5, $6::numeric, $7::numeric,
          $8, $9::jsonb, $10, $11::text[], $12::text[], $13::text[], $14, $15::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.ledger,
          expected.chainId,
          expected.subjectA,
          expected.subjectB,
          expected.fromPosition,
          expected.toPosition,
          expected.resultHash,
          canonicalJson(expected.report),
          expected.terminalEvidenceId,
          expected.reportIds,
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.capturedAt,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) throw conflict('Entity relationship timeline was not stored.');
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof EntityRelationshipTimelineStorageError) throw error;
      throw new EntityRelationshipTimelineStorageError(
        'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
        'Entity relationship timeline write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredEntityRelationshipTimeline | undefined> {
    const expectedId = timelineId(id);
    try {
      const result = await this.#pool.query(`${SELECT_TIMELINE} WHERE id = $1`, [expectedId]);
      return result.rows[0] === undefined ? undefined : rowToTimeline(result.rows[0]);
    } catch (error) {
      if (error instanceof EntityRelationshipTimelineStorageError) throw error;
      throw new EntityRelationshipTimelineStorageError(
        'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
        'Entity relationship timeline read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(input: {
    ledger: Ledger;
    chainId: string;
    subjectA: string;
    subjectB: string;
  }): Promise<StoredEntityRelationshipTimeline | undefined> {
    const expected = identity(input);
    try {
      const result = await this.#pool.query(
        `${SELECT_TIMELINE}
         WHERE ledger = $1::ledger_kind AND chain_id = $2 AND subject_a = $3 AND subject_b = $4
         ORDER BY to_position DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [expected.ledger, expected.chainId, expected.subjectA, expected.subjectB],
      );
      return result.rows[0] === undefined ? undefined : rowToTimeline(result.rows[0]);
    } catch (error) {
      if (error instanceof EntityRelationshipTimelineStorageError) throw error;
      throw new EntityRelationshipTimelineStorageError(
        'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
        'Latest entity relationship timeline read failed.',
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
      'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE' | 'ENTITY_RELATIONSHIP_TIMELINE_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT to_regclass('public.entity_relationship_timeline_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['019_entity_relationship_timelines'],
      );
      if (
        result.rows[0]?.table_name !== 'entity_relationship_timeline_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'ENTITY_RELATIONSHIP_TIMELINE_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'ENTITY_RELATIONSHIP_TIMELINE_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
