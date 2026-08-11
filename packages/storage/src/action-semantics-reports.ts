import { Pool } from 'pg';

import {
  ACTION_SEMANTICS_SUPPORTED_MODEL_VERSIONS,
  actionSemanticsReportId,
  calculateActionSemanticsResultHash,
  canonicalActionTransactionId,
  expectedActionSemanticsTerminalEvidence,
  type ActionSemanticsModelVersion,
} from '@zerotrace/action-semantics';
import { canonicalJson } from '@zerotrace/evidence';
import {
  ActionSemanticsReportSchema,
  type ActionSemanticsReport,
  type Ledger,
} from '@zerotrace/schemas';

export interface ActionSemanticsReportRepositoryOptions {
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

export type ActionSemanticsReportStorageErrorCode =
  | 'ACTION_SEMANTICS_REPORT_INVALID'
  | 'ACTION_SEMANTICS_REPORT_CONFLICT'
  | 'ACTION_SEMANTICS_REPORT_UNAVAILABLE'
  | 'ACTION_SEMANTICS_REPORT_NOT_INITIALIZED';

export class ActionSemanticsReportStorageError extends Error {
  readonly code: ActionSemanticsReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ActionSemanticsReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ActionSemanticsReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface ActionSemanticsReportLookup {
  ledger: Ledger;
  chainId: string;
  transactionId: string;
}

export interface StoredActionSemanticsReport {
  id: string;
  ledger: Ledger;
  chainId: string;
  snapshotPosition: string;
  snapshotHash: string;
  transactionIds: readonly string[];
  resultHash: string;
  report: ActionSemanticsReport;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: ActionSemanticsModelVersion;
  classificationCoverage: number;
  capturedAt: string;
  createdAt: string;
}

type Materialized = Omit<StoredActionSemanticsReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    ledger::text,
    chain_id,
    snapshot_position::text,
    snapshot_hash,
    transaction_ids,
    result_hash,
    report,
    terminal_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    classification_coverage,
    captured_at,
    created_at
  FROM action_semantics_reports
`;

function createPool(options: ActionSemanticsReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-action-semantics-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): ActionSemanticsReportStorageError {
  return new ActionSemanticsReportStorageError('ACTION_SEMANTICS_REPORT_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): ActionSemanticsReportStorageError {
  return new ActionSemanticsReportStorageError('ACTION_SEMANTICS_REPORT_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function isDatabaseIntegrityRejection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (code === 'P0001' || code.startsWith('23'));
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored Action Semantics report ${field} is invalid.`);
  }
  return value;
}

function ledger(value: unknown): Ledger {
  if (value !== 'EVM' && value !== 'BITCOIN' && value !== 'SOLANA') {
    throw conflict('Stored Action Semantics report ledger is invalid.');
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored Action Semantics report ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored Action Semantics report is not JSON.', error);
  }
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw conflict(`Stored Action Semantics report ${field} is invalid.`);
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw conflict(`Stored Action Semantics report ${field} is not canonical.`);
  }
  return canonical;
}

function ratio(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw conflict(`Stored Action Semantics report ${field} is invalid.`);
  }
  return parsed;
}

function snapshotIdentity(report: ActionSemanticsReport): {
  position: string;
  hash: string;
} {
  switch (report.snapshot.ledger) {
    case 'EVM':
      return { position: report.snapshot.blockNumber, hash: report.snapshot.blockHash };
    case 'BITCOIN':
      return { position: report.snapshot.height, hash: report.snapshot.blockHash };
    case 'SOLANA':
      return { position: report.snapshot.slot, hash: report.snapshot.blockhash };
  }
}

function materialize(input: ActionSemanticsReport): Materialized {
  const parsed = ActionSemanticsReportSchema.safeParse(input);
  if (!parsed.success) {
    throw invalid('Action Semantics report is invalid.', parsed.error);
  }
  const report = parsed.data;
  const resultHash = calculateActionSemanticsResultHash(report);
  if (report.resultHash !== resultHash) {
    throw invalid('Action Semantics result hash does not match its canonical report core.');
  }
  const modelVersion = ACTION_SEMANTICS_SUPPORTED_MODEL_VERSIONS.find(
    (item) => item === report.metadata.modelVersion,
  );
  if (modelVersion === undefined || report.metadata.confidence !== 1) {
    throw invalid('Action Semantics model identity or deterministic confidence is invalid.');
  }
  const expectedTerminal = expectedActionSemanticsTerminalEvidence(report);
  const terminal = report.evidence.find((item) => item.id === report.terminalEvidenceId);
  if (terminal === undefined || canonicalJson(terminal) !== canonicalJson(expectedTerminal)) {
    throw invalid('Action Semantics terminal Evidence does not match the report result.');
  }
  const identity = snapshotIdentity(report);
  const transactionIds = [
    ...new Set(
      report.actions.map((item) => canonicalActionTransactionId(item.ledger, item.transactionId)),
    ),
  ].sort();
  return {
    id: actionSemanticsReportId(resultHash),
    ledger: report.snapshot.ledger,
    chainId: report.snapshot.chainId,
    snapshotPosition: identity.position,
    snapshotHash: identity.hash,
    transactionIds,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds: [...report.metadata.evidenceIds],
    sourceSet: [...report.metadata.sourceSet],
    modelVersion,
    classificationCoverage: report.classificationCoverage,
    capturedAt: new Date(report.snapshot.capturedAt).toISOString(),
  };
}

function assertSame(stored: StoredActionSemanticsReport, expected: Materialized): void {
  if (
    stored.id !== expected.id ||
    stored.ledger !== expected.ledger ||
    stored.chainId !== expected.chainId ||
    stored.snapshotPosition !== expected.snapshotPosition ||
    stored.snapshotHash !== expected.snapshotHash ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.classificationCoverage !== expected.classificationCoverage ||
    stored.capturedAt !== expected.capturedAt ||
    canonicalJson(stored.transactionIds) !== canonicalJson(expected.transactionIds) ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw conflict('Stored Action Semantics report conflicts with the canonical report.');
  }
}

function rowToReport(row: Record<string, unknown>): StoredActionSemanticsReport {
  const parsed = ActionSemanticsReportSchema.safeParse(json(row.report));
  if (!parsed.success) {
    throw conflict('Stored Action Semantics report payload is invalid.', parsed.error);
  }
  const stored: StoredActionSemanticsReport = {
    id: requiredString(row, 'id'),
    ledger: ledger(row.ledger),
    chainId: requiredString(row, 'chain_id'),
    snapshotPosition: requiredString(row, 'snapshot_position'),
    snapshotHash: requiredString(row, 'snapshot_hash'),
    transactionIds: canonicalStringArray(row.transaction_ids, 'transaction IDs'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version') as ActionSemanticsModelVersion,
    classificationCoverage: ratio(row.classification_coverage, 'classification coverage'),
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function reportId(value: string): string {
  if (!/^asr_[0-9a-f]{24}$/.test(value)) {
    throw invalid('Action Semantics report ID is invalid.');
  }
  return value;
}

function lookup(input: ActionSemanticsReportLookup): ActionSemanticsReportLookup {
  const chainId = input.chainId.trim();
  if (chainId.length === 0 || chainId.length > 128) {
    throw invalid('Action Semantics chain ID is invalid.');
  }
  return {
    ledger: input.ledger,
    chainId,
    transactionId: canonicalActionTransactionId(input.ledger, input.transactionId),
  };
}

export class PostgresActionSemanticsReportRepository {
  readonly #pool: ReportPool;

  constructor(options: ActionSemanticsReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ReportPool): PostgresActionSemanticsReportRepository {
    return new PostgresActionSemanticsReportRepository({ pool });
  }

  async put(report: ActionSemanticsReport): Promise<StoredActionSemanticsReport> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO action_semantics_reports (
          id, ledger, chain_id, snapshot_position, snapshot_hash, transaction_ids,
          result_hash, report, terminal_evidence_id, evidence_ids, source_set,
          model_version, classification_coverage, captured_at
        ) VALUES (
          $1, $2::ledger_kind, $3, $4::numeric, $5, $6::text[],
          $7, $8::jsonb, $9, $10::text[], $11::text[],
          $12, $13::double precision, $14::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.ledger,
          expected.chainId,
          expected.snapshotPosition,
          expected.snapshotHash,
          expected.transactionIds,
          expected.resultHash,
          canonicalJson(expected.report),
          expected.terminalEvidenceId,
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.classificationCoverage,
          expected.capturedAt,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) throw conflict('Action Semantics report was not stored.');
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof ActionSemanticsReportStorageError) throw error;
      if (isDatabaseIntegrityRejection(error)) {
        throw conflict('PostgreSQL rejected the Action Semantics report integrity.', error);
      }
      throw new ActionSemanticsReportStorageError(
        'ACTION_SEMANTICS_REPORT_UNAVAILABLE',
        'Action Semantics report write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredActionSemanticsReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof ActionSemanticsReportStorageError) throw error;
      throw new ActionSemanticsReportStorageError(
        'ACTION_SEMANTICS_REPORT_UNAVAILABLE',
        'Action Semantics report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(
    input: ActionSemanticsReportLookup,
  ): Promise<StoredActionSemanticsReport | undefined> {
    const canonical = lookup(input);
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE ledger = $1::ledger_kind
           AND chain_id = $2
           AND transaction_ids @> ARRAY[$3]::text[]
         ORDER BY snapshot_position DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [canonical.ledger, canonical.chainId, canonical.transactionId],
      );
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof ActionSemanticsReportStorageError) throw error;
      throw new ActionSemanticsReportStorageError(
        'ACTION_SEMANTICS_REPORT_UNAVAILABLE',
        'Latest Action Semantics report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: 'ACTION_SEMANTICS_REPORT_UNAVAILABLE' | 'ACTION_SEMANTICS_REPORT_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.action_semantics_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['026_action_semantics_v2'],
      );
      if (
        result.rows[0]?.table_name !== 'action_semantics_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'ACTION_SEMANTICS_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'ACTION_SEMANTICS_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
