import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  FlapPancakeV2PensionEntryResultSchema,
  type FlapPancakeV2PensionEntryResult,
} from '@zerotrace/schemas';

export interface FlapPensionEntryReportRepositoryOptions {
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

export type FlapPensionEntryReportStorageErrorCode =
  | 'FLAP_PENSION_ENTRY_REPORT_INVALID'
  | 'FLAP_PENSION_ENTRY_REPORT_CONFLICT'
  | 'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE'
  | 'FLAP_PENSION_ENTRY_REPORT_NOT_INITIALIZED';

export class FlapPensionEntryReportStorageError extends Error {
  readonly code: FlapPensionEntryReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: FlapPensionEntryReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'FlapPensionEntryReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredFlapPensionEntryReport {
  id: string;
  chainId: 'eip155:56';
  tokenAddress: string;
  pensionReportId: string;
  pensionWallet: string;
  blockNumber: string;
  snapshotHash: string;
  resultHash: string;
  report: FlapPancakeV2PensionEntryResult;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: 'flap-pension-entry-economics-v0.1.0';
  capturedAt: string;
  createdAt: string;
}

type Materialized = Omit<StoredFlapPensionEntryReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    chain_id,
    token_address,
    pension_report_id,
    pension_wallet,
    block_number::text,
    snapshot_hash,
    result_hash,
    report,
    terminal_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    captured_at,
    created_at
  FROM flap_pension_entry_reports
`;

function createPool(options: FlapPensionEntryReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-flap-pension-entry-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): FlapPensionEntryReportStorageError {
  return new FlapPensionEntryReportStorageError('FLAP_PENSION_ENTRY_REPORT_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): FlapPensionEntryReportStorageError {
  return new FlapPensionEntryReportStorageError('FLAP_PENSION_ENTRY_REPORT_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored Flap pension entry report ${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored Flap pension entry report ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored Flap pension entry report is not JSON.', error);
  }
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw conflict(`Stored Flap pension entry report ${field} is invalid.`);
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw conflict(`Stored Flap pension entry report ${field} is not canonical.`);
  }
  return canonical;
}

function materialize(input: FlapPancakeV2PensionEntryResult): Materialized {
  const parsed = FlapPancakeV2PensionEntryResultSchema.safeParse(input);
  if (!parsed.success) throw invalid('Flap pension entry result is invalid.', parsed.error);
  const report = parsed.data;
  const snapshot = report.metadata.snapshot;
  if (snapshot?.ledger !== 'EVM' || snapshot.chainId !== 'eip155:56') {
    throw invalid('Flap pension entry report requires a finalized BSC Snapshot.');
  }
  const resultHash = hashPayload(report);
  return {
    id: `per_${hashPayload({ schema: 'zerotrace-flap-pension-entry-report-v1', resultHash }).slice(0, 24)}`,
    chainId: 'eip155:56',
    tokenAddress: report.token,
    pensionReportId: report.behavior.reportId,
    pensionWallet: report.behavior.wallet,
    blockNumber: snapshot.blockNumber,
    snapshotHash: snapshot.blockHash,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds: [...report.metadata.evidenceIds].sort(),
    sourceSet: [...report.metadata.sourceSet].sort(),
    modelVersion: 'flap-pension-entry-economics-v0.1.0',
    capturedAt: new Date(snapshot.capturedAt).toISOString(),
  };
}

function assertSame(stored: StoredFlapPensionEntryReport, expected: Materialized): void {
  if (
    stored.id !== expected.id ||
    stored.chainId !== expected.chainId ||
    stored.tokenAddress !== expected.tokenAddress ||
    stored.pensionReportId !== expected.pensionReportId ||
    stored.pensionWallet !== expected.pensionWallet ||
    stored.blockNumber !== expected.blockNumber ||
    stored.snapshotHash !== expected.snapshotHash ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.capturedAt !== expected.capturedAt ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw conflict('Stored Flap pension entry report conflicts with the canonical report.');
  }
}

function rowToReport(row: Record<string, unknown>): StoredFlapPensionEntryReport {
  const parsed = FlapPancakeV2PensionEntryResultSchema.safeParse(json(row.report));
  if (!parsed.success)
    throw conflict('Stored Flap pension entry payload is invalid.', parsed.error);
  const stored: StoredFlapPensionEntryReport = {
    id: requiredString(row, 'id'),
    chainId: requiredString(row, 'chain_id') as 'eip155:56',
    tokenAddress: requiredString(row, 'token_address'),
    pensionReportId: requiredString(row, 'pension_report_id'),
    pensionWallet: requiredString(row, 'pension_wallet'),
    blockNumber: requiredString(row, 'block_number'),
    snapshotHash: requiredString(row, 'snapshot_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(
      row,
      'model_version',
    ) as StoredFlapPensionEntryReport['modelVersion'],
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function reportId(value: string): string {
  if (!/^per_[0-9a-f]{24}$/.test(value)) throw invalid('Flap pension entry report ID is invalid.');
  return value;
}

function tokenAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw invalid('Flap pension entry token is invalid.');
  return value.toLowerCase();
}

export class PostgresFlapPensionEntryReportRepository {
  readonly #pool: ReportPool;

  constructor(options: FlapPensionEntryReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ReportPool): PostgresFlapPensionEntryReportRepository {
    return new PostgresFlapPensionEntryReportRepository({ pool });
  }

  async put(report: FlapPancakeV2PensionEntryResult): Promise<StoredFlapPensionEntryReport> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO flap_pension_entry_reports (
          id, chain_id, token_address, pension_report_id, pension_wallet, block_number,
          snapshot_hash, result_hash, report, terminal_evidence_id, evidence_ids, source_set,
          model_version, captured_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::numeric,
          $7, $8, $9::jsonb, $10, $11::text[], $12::text[],
          $13, $14::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.chainId,
          expected.tokenAddress,
          expected.pensionReportId,
          expected.pensionWallet,
          expected.blockNumber,
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
      if (stored === undefined) throw conflict('Flap pension entry report was not stored.');
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof FlapPensionEntryReportStorageError) throw error;
      throw new FlapPensionEntryReportStorageError(
        'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
        'Flap pension entry report write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredFlapPensionEntryReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof FlapPensionEntryReportStorageError) throw error;
      throw new FlapPensionEntryReportStorageError(
        'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
        'Flap pension entry report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(tokenInput: string): Promise<StoredFlapPensionEntryReport | undefined> {
    const canonicalToken = tokenAddress(tokenInput);
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE token_address = $1
         ORDER BY block_number DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [canonicalToken],
      );
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof FlapPensionEntryReportStorageError) throw error;
      throw new FlapPensionEntryReportStorageError(
        'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
        'Latest Flap pension entry report read failed.',
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
      'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE' | 'FLAP_PENSION_ENTRY_REPORT_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.flap_pension_entry_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['017_flap_pension_entry_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'flap_pension_entry_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'FLAP_PENSION_ENTRY_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'FLAP_PENSION_ENTRY_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
