import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  EntityRelationshipReportSchema,
  type EntityRelationshipReport,
  type Ledger,
} from '@zerotrace/schemas';

export interface EntityRelationshipReportRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface ReportPool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

interface InternalOptions {
  pool: ReportPool;
}

export type EntityRelationshipReportStorageErrorCode =
  | 'ENTITY_RELATIONSHIP_REPORT_INVALID'
  | 'ENTITY_RELATIONSHIP_REPORT_CONFLICT'
  | 'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE'
  | 'ENTITY_RELATIONSHIP_REPORT_NOT_INITIALIZED';

export class EntityRelationshipReportStorageError extends Error {
  readonly code: EntityRelationshipReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: EntityRelationshipReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'EntityRelationshipReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredEntityRelationshipReport {
  id: string;
  ledger: Ledger;
  chainId: string;
  subjectA: string;
  subjectB: string;
  snapshotPosition: string;
  snapshotHash: string;
  resultHash: string;
  report: EntityRelationshipReport;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: 'entity-v0.1.0';
  capturedAt: string;
  createdAt: string;
}

type Materialized = Omit<StoredEntityRelationshipReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    ledger,
    chain_id,
    subject_a,
    subject_b,
    snapshot_position::text,
    snapshot_hash,
    result_hash,
    report,
    terminal_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    captured_at,
    created_at
  FROM entity_relationship_reports
`;

function createPool(options: EntityRelationshipReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-entity-relationship-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): EntityRelationshipReportStorageError {
  return new EntityRelationshipReportStorageError('ENTITY_RELATIONSHIP_REPORT_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): EntityRelationshipReportStorageError {
  return new EntityRelationshipReportStorageError('ENTITY_RELATIONSHIP_REPORT_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored entity relationship report ${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored entity relationship report ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored entity relationship report is not JSON.', error);
  }
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw conflict(`Stored entity relationship report ${field} is invalid.`);
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw conflict(`Stored entity relationship report ${field} is not canonical.`);
  }
  return canonical;
}

function snapshotIdentity(report: EntityRelationshipReport): {
  ledger: Ledger;
  chainId: string;
  position: string;
  hash: string;
  capturedAt: string;
} {
  const snapshot = report.result.metadata.snapshot;
  switch (snapshot.ledger) {
    case 'EVM':
      return {
        ledger: snapshot.ledger,
        chainId: snapshot.chainId,
        position: snapshot.blockNumber,
        hash: snapshot.blockHash,
        capturedAt: snapshot.capturedAt,
      };
    case 'BITCOIN':
      return {
        ledger: snapshot.ledger,
        chainId: snapshot.chainId,
        position: snapshot.height,
        hash: snapshot.blockHash,
        capturedAt: snapshot.capturedAt,
      };
    case 'SOLANA':
      return {
        ledger: snapshot.ledger,
        chainId: snapshot.chainId,
        position: snapshot.slot,
        hash: snapshot.blockhash,
        capturedAt: snapshot.capturedAt,
      };
  }
}

function materialize(input: EntityRelationshipReport): Materialized {
  const parsed = EntityRelationshipReportSchema.safeParse(input);
  if (!parsed.success) throw invalid('Entity relationship report is invalid.', parsed.error);
  const report = parsed.data;
  const terminal = report.evidence.find((item) => item.id === report.terminalEvidenceId);
  const terminalInputResult = {
    ...report.result,
    metadata: {
      ...report.result.metadata,
      evidenceIds: report.result.metadata.evidenceIds.filter(
        (evidenceId) => evidenceId !== report.terminalEvidenceId,
      ),
    },
  };
  if (
    terminal === undefined ||
    terminal.payloadHash !== hashPayload({ input: report.input, result: terminalInputResult })
  ) {
    throw invalid('Entity relationship terminal Evidence payload does not match the report.');
  }
  const snapshot = snapshotIdentity(report);
  const resultHash = hashPayload(report);
  return {
    id: `erh_${hashPayload({ schema: 'zerotrace-entity-relationship-report-v1', resultHash }).slice(0, 24)}`,
    ledger: snapshot.ledger,
    chainId: snapshot.chainId,
    subjectA: report.result.subjectA,
    subjectB: report.result.subjectB,
    snapshotPosition: snapshot.position,
    snapshotHash: snapshot.hash,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds: report.result.metadata.evidenceIds,
    sourceSet: report.result.metadata.sourceSet,
    modelVersion: 'entity-v0.1.0',
    capturedAt: new Date(snapshot.capturedAt).toISOString(),
  };
}

function assertSame(stored: StoredEntityRelationshipReport, expected: Materialized): void {
  if (
    stored.id !== expected.id ||
    stored.ledger !== expected.ledger ||
    stored.chainId !== expected.chainId ||
    stored.subjectA !== expected.subjectA ||
    stored.subjectB !== expected.subjectB ||
    stored.snapshotPosition !== expected.snapshotPosition ||
    stored.snapshotHash !== expected.snapshotHash ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.capturedAt !== expected.capturedAt ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw conflict('Stored entity relationship report conflicts with the canonical report.');
  }
}

function rowToReport(row: Record<string, unknown>): StoredEntityRelationshipReport {
  const parsed = EntityRelationshipReportSchema.safeParse(json(row.report));
  if (!parsed.success)
    throw conflict('Stored entity relationship payload is invalid.', parsed.error);
  const stored: StoredEntityRelationshipReport = {
    id: requiredString(row, 'id'),
    ledger: requiredString(row, 'ledger') as Ledger,
    chainId: requiredString(row, 'chain_id'),
    subjectA: requiredString(row, 'subject_a'),
    subjectB: requiredString(row, 'subject_b'),
    snapshotPosition: requiredString(row, 'snapshot_position'),
    snapshotHash: requiredString(row, 'snapshot_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version') as 'entity-v0.1.0',
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function reportId(value: string): string {
  if (!/^erh_[0-9a-f]{24}$/.test(value)) throw invalid('Entity relationship report ID is invalid.');
  return value;
}

function identity(input: { ledger: Ledger; chainId: string; subjectA: string; subjectB: string }): {
  ledger: Ledger;
  chainId: string;
  subjectA: string;
  subjectB: string;
} {
  if (!['EVM', 'BITCOIN', 'SOLANA'].includes(input.ledger)) {
    throw invalid('Entity relationship ledger is invalid.');
  }
  const chainId = input.chainId.trim();
  const subjects = [input.subjectA.trim(), input.subjectB.trim()].sort();
  if (
    chainId.length === 0 ||
    chainId.length > 128 ||
    subjects[0] === undefined ||
    subjects[1] === undefined ||
    subjects[0].length === 0 ||
    subjects[1].length === 0 ||
    subjects[0].length > 512 ||
    subjects[1].length > 512 ||
    subjects[0] === subjects[1]
  ) {
    throw invalid('Entity relationship report identity is invalid.');
  }
  return { ledger: input.ledger, chainId, subjectA: subjects[0], subjectB: subjects[1] };
}

export class PostgresEntityRelationshipReportRepository {
  readonly #pool: ReportPool;

  constructor(options: EntityRelationshipReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ReportPool): PostgresEntityRelationshipReportRepository {
    return new PostgresEntityRelationshipReportRepository({ pool });
  }

  async put(report: EntityRelationshipReport): Promise<StoredEntityRelationshipReport> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO entity_relationship_reports (
          id, ledger, chain_id, subject_a, subject_b, snapshot_position, snapshot_hash,
          result_hash, report, terminal_evidence_id, evidence_ids, source_set, model_version,
          captured_at
        ) VALUES (
          $1, $2::ledger_kind, $3, $4, $5, $6::numeric, $7,
          $8, $9::jsonb, $10, $11::text[], $12::text[], $13, $14::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.ledger,
          expected.chainId,
          expected.subjectA,
          expected.subjectB,
          expected.snapshotPosition,
          expected.snapshotHash,
          expected.resultHash,
          canonicalJson(expected.report),
          expected.terminalEvidenceId,
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.capturedAt,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) throw conflict('Entity relationship report was not stored.');
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof EntityRelationshipReportStorageError) throw error;
      throw new EntityRelationshipReportStorageError(
        'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
        'Entity relationship report write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredEntityRelationshipReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof EntityRelationshipReportStorageError) throw error;
      throw new EntityRelationshipReportStorageError(
        'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
        'Entity relationship report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(input: {
    ledger: Ledger;
    chainId: string;
    subjectA: string;
    subjectB: string;
  }): Promise<StoredEntityRelationshipReport | undefined> {
    const expected = identity(input);
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE ledger = $1::ledger_kind
           AND chain_id = $2
           AND subject_a = $3
           AND subject_b = $4
         ORDER BY snapshot_position DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [expected.ledger, expected.chainId, expected.subjectA, expected.subjectB],
      );
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof EntityRelationshipReportStorageError) throw error;
      throw new EntityRelationshipReportStorageError(
        'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
        'Latest entity relationship report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async history(input: {
    ledger: Ledger;
    chainId: string;
    subjectA: string;
    subjectB: string;
    fromPosition?: string;
    toPosition?: string;
    limit?: number;
  }): Promise<StoredEntityRelationshipReport[]> {
    const expected = identity(input);
    const fromPosition = input.fromPosition?.trim();
    const toPosition = input.toPosition?.trim();
    const limit = input.limit ?? 1_001;
    if (
      (fromPosition !== undefined && !/^(?:0|[1-9]\d*)$/.test(fromPosition)) ||
      (toPosition !== undefined && !/^(?:0|[1-9]\d*)$/.test(toPosition)) ||
      (fromPosition !== undefined &&
        toPosition !== undefined &&
        BigInt(fromPosition) > BigInt(toPosition)) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1_001
    ) {
      throw invalid('Entity relationship report history range is invalid.');
    }
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE ledger = $1::ledger_kind
           AND chain_id = $2
           AND subject_a = $3
           AND subject_b = $4
           AND ($5::numeric IS NULL OR snapshot_position >= $5::numeric)
           AND ($6::numeric IS NULL OR snapshot_position <= $6::numeric)
         ORDER BY snapshot_position ASC, captured_at ASC, created_at ASC, id ASC
         LIMIT $7`,
        [
          expected.ledger,
          expected.chainId,
          expected.subjectA,
          expected.subjectB,
          fromPosition ?? null,
          toPosition ?? null,
          limit,
        ],
      );
      return result.rows.map(rowToReport);
    } catch (error) {
      if (error instanceof EntityRelationshipReportStorageError) throw error;
      throw new EntityRelationshipReportStorageError(
        'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
        'Entity relationship report history read failed.',
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
      'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE' | 'ENTITY_RELATIONSHIP_REPORT_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.entity_relationship_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['018_entity_relationship_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'entity_relationship_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'ENTITY_RELATIONSHIP_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'ENTITY_RELATIONSHIP_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
