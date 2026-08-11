import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  SolanaTransactionIntelligenceReportSchema,
  type SolanaTransactionIntelligenceReport,
} from '@zerotrace/schemas';

export interface SolanaTransactionReportRepositoryOptions {
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

export type SolanaTransactionReportStorageErrorCode =
  | 'SOLANA_TRANSACTION_REPORT_INVALID'
  | 'SOLANA_TRANSACTION_REPORT_CONFLICT'
  | 'SOLANA_TRANSACTION_REPORT_UNAVAILABLE'
  | 'SOLANA_TRANSACTION_REPORT_NOT_INITIALIZED';

export class SolanaTransactionReportStorageError extends Error {
  readonly code: SolanaTransactionReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: SolanaTransactionReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SolanaTransactionReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredSolanaTransactionReport {
  id: string;
  chainId: 'solana-mainnet';
  signature: string;
  snapshotSlot: string;
  snapshotHash: string;
  resultHash: string;
  report: SolanaTransactionIntelligenceReport;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: 'solana-transaction-query-v1.1.0';
  capturedAt: string;
  createdAt: string;
}

type Materialized = Omit<StoredSolanaTransactionReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    chain_id,
    signature,
    snapshot_slot::text,
    snapshot_hash,
    result_hash,
    report,
    terminal_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    captured_at,
    created_at
  FROM solana_transaction_reports
`;

function createPool(options: SolanaTransactionReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-solana-transaction-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): SolanaTransactionReportStorageError {
  return new SolanaTransactionReportStorageError('SOLANA_TRANSACTION_REPORT_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): SolanaTransactionReportStorageError {
  return new SolanaTransactionReportStorageError('SOLANA_TRANSACTION_REPORT_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored Solana transaction report ${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored Solana transaction report ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored Solana transaction report is not JSON.', error);
  }
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw conflict(`Stored Solana transaction report ${field} is invalid.`);
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw conflict(`Stored Solana transaction report ${field} is not canonical.`);
  }
  return canonical;
}

function materialize(input: SolanaTransactionIntelligenceReport): Materialized {
  const parsed = SolanaTransactionIntelligenceReportSchema.safeParse(input);
  if (!parsed.success) {
    throw invalid('Solana transaction intelligence report is invalid.', parsed.error);
  }
  const report = parsed.data;
  const snapshot = report.metadata.snapshot;
  if (snapshot?.ledger !== 'SOLANA') {
    throw invalid('Solana transaction report requires a finalized Solana Snapshot.');
  }
  const evidenceIds = [...report.metadata.evidenceIds].sort();
  const sourceSet = [...report.metadata.sourceSet];
  const resultHash = hashPayload(report);
  return {
    id: `str_${hashPayload({ schema: 'zerotrace-solana-transaction-report-v1', resultHash }).slice(0, 24)}`,
    chainId: 'solana-mainnet',
    signature: report.signature,
    snapshotSlot: snapshot.slot,
    snapshotHash: snapshot.blockhash,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds,
    sourceSet,
    modelVersion: 'solana-transaction-query-v1.1.0',
    capturedAt: new Date(snapshot.capturedAt).toISOString(),
  };
}

function assertSame(stored: StoredSolanaTransactionReport, expected: Materialized): void {
  if (
    stored.id !== expected.id ||
    stored.chainId !== expected.chainId ||
    stored.signature !== expected.signature ||
    stored.snapshotSlot !== expected.snapshotSlot ||
    stored.snapshotHash !== expected.snapshotHash ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.capturedAt !== expected.capturedAt ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw conflict('Stored Solana transaction report conflicts with the canonical report.');
  }
}

function rowToReport(row: Record<string, unknown>): StoredSolanaTransactionReport {
  const parsed = SolanaTransactionIntelligenceReportSchema.safeParse(json(row.report));
  if (!parsed.success) {
    throw conflict('Stored Solana transaction report payload is invalid.', parsed.error);
  }
  const stored: StoredSolanaTransactionReport = {
    id: requiredString(row, 'id'),
    chainId: requiredString(row, 'chain_id') as 'solana-mainnet',
    signature: requiredString(row, 'signature'),
    snapshotSlot: requiredString(row, 'snapshot_slot'),
    snapshotHash: requiredString(row, 'snapshot_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version') as 'solana-transaction-query-v1.1.0',
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function reportId(value: string): string {
  if (!/^str_[0-9a-f]{24}$/.test(value)) {
    throw invalid('Solana transaction report ID is invalid.');
  }
  return value;
}

function signature(value: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(value)) {
    throw invalid('Solana transaction signature is invalid.');
  }
  return value;
}

export class PostgresSolanaTransactionReportRepository {
  readonly #pool: ReportPool;

  constructor(options: SolanaTransactionReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ReportPool): PostgresSolanaTransactionReportRepository {
    return new PostgresSolanaTransactionReportRepository({ pool });
  }

  async put(report: SolanaTransactionIntelligenceReport): Promise<StoredSolanaTransactionReport> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO solana_transaction_reports (
          id, chain_id, signature, snapshot_slot, snapshot_hash, result_hash,
          report, terminal_evidence_id, evidence_ids, source_set, model_version, captured_at
        ) VALUES (
          $1, $2, $3, $4::numeric, $5, $6,
          $7::jsonb, $8, $9::text[], $10::text[], $11, $12::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.chainId,
          expected.signature,
          expected.snapshotSlot,
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
      if (stored === undefined) {
        throw conflict('Solana transaction report was not stored.');
      }
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof SolanaTransactionReportStorageError) throw error;
      throw new SolanaTransactionReportStorageError(
        'SOLANA_TRANSACTION_REPORT_UNAVAILABLE',
        'Solana transaction report write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredSolanaTransactionReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof SolanaTransactionReportStorageError) throw error;
      throw new SolanaTransactionReportStorageError(
        'SOLANA_TRANSACTION_REPORT_UNAVAILABLE',
        'Solana transaction report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(signatureInput: string): Promise<StoredSolanaTransactionReport | undefined> {
    const canonicalSignature = signature(signatureInput);
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE chain_id = 'solana-mainnet' AND signature = $1
         ORDER BY snapshot_slot DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [canonicalSignature],
      );
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof SolanaTransactionReportStorageError) throw error;
      throw new SolanaTransactionReportStorageError(
        'SOLANA_TRANSACTION_REPORT_UNAVAILABLE',
        'Latest Solana transaction report read failed.',
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
      'SOLANA_TRANSACTION_REPORT_UNAVAILABLE' | 'SOLANA_TRANSACTION_REPORT_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.solana_transaction_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['015_solana_transaction_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'solana_transaction_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'SOLANA_TRANSACTION_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'SOLANA_TRANSACTION_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
