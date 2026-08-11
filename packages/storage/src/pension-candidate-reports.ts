import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  EvmPensionCandidateDiscoverySchema,
  type EvmPensionCandidateDiscovery,
} from '@zerotrace/schemas';

export interface PensionCandidateReportRepositoryOptions {
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

export type PensionCandidateReportStorageErrorCode =
  | 'PENSION_CANDIDATE_REPORT_INVALID'
  | 'PENSION_CANDIDATE_REPORT_CONFLICT'
  | 'PENSION_CANDIDATE_REPORT_UNAVAILABLE'
  | 'PENSION_CANDIDATE_REPORT_NOT_INITIALIZED';

export class PensionCandidateReportStorageError extends Error {
  readonly code: PensionCandidateReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: PensionCandidateReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'PensionCandidateReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredPensionCandidateReport {
  id: string;
  chainId: string;
  tokenAddress: string;
  fromBlock: string;
  toBlock: string;
  snapshotHash: string;
  resultHash: string;
  report: EvmPensionCandidateDiscovery;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: 'evm-pension-candidate-discovery-v1.0.0';
  capturedAt: string;
  createdAt: string;
}

type Materialized = Omit<StoredPensionCandidateReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    chain_id,
    token_address,
    from_block::text,
    to_block::text,
    snapshot_hash,
    result_hash,
    report,
    terminal_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    captured_at,
    created_at
  FROM evm_pension_candidate_reports
`;

function createPool(options: PensionCandidateReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-pension-candidate-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): PensionCandidateReportStorageError {
  return new PensionCandidateReportStorageError('PENSION_CANDIDATE_REPORT_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): PensionCandidateReportStorageError {
  return new PensionCandidateReportStorageError('PENSION_CANDIDATE_REPORT_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored pension candidate report ${field} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw conflict(`Stored pension candidate report ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored pension candidate report is not JSON.', error);
  }
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw conflict(`Stored pension candidate report ${field} is invalid.`);
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw conflict(`Stored pension candidate report ${field} is not canonical.`);
  }
  return canonical;
}

function materialize(input: EvmPensionCandidateDiscovery): Materialized {
  const parsed = EvmPensionCandidateDiscoverySchema.safeParse(input);
  if (!parsed.success)
    throw invalid('Pension candidate discovery report is invalid.', parsed.error);
  const report = parsed.data;
  const snapshot = report.metadata.snapshot;
  if (snapshot?.ledger !== 'EVM') {
    throw invalid('Pension candidate report requires a finalized EVM Snapshot.');
  }
  const resultHash = hashPayload(report);
  return {
    id: `pcr_${hashPayload({ schema: 'zerotrace-pension-candidate-report-v1', resultHash }).slice(0, 24)}`,
    chainId: snapshot.chainId,
    tokenAddress: report.tokenAddress,
    fromBlock: report.fromBlock,
    toBlock: report.toBlock,
    snapshotHash: snapshot.blockHash,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds: [...report.metadata.evidenceIds].sort(),
    sourceSet: [...report.metadata.sourceSet],
    modelVersion: 'evm-pension-candidate-discovery-v1.0.0',
    capturedAt: new Date(snapshot.capturedAt).toISOString(),
  };
}

function assertSame(stored: StoredPensionCandidateReport, expected: Materialized): void {
  if (
    stored.id !== expected.id ||
    stored.chainId !== expected.chainId ||
    stored.tokenAddress !== expected.tokenAddress ||
    stored.fromBlock !== expected.fromBlock ||
    stored.toBlock !== expected.toBlock ||
    stored.snapshotHash !== expected.snapshotHash ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.capturedAt !== expected.capturedAt ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw conflict('Stored pension candidate report conflicts with the canonical report.');
  }
}

function rowToReport(row: Record<string, unknown>): StoredPensionCandidateReport {
  const parsed = EvmPensionCandidateDiscoverySchema.safeParse(json(row.report));
  if (!parsed.success)
    throw conflict('Stored pension candidate report payload is invalid.', parsed.error);
  const stored: StoredPensionCandidateReport = {
    id: requiredString(row, 'id'),
    chainId: requiredString(row, 'chain_id'),
    tokenAddress: requiredString(row, 'token_address'),
    fromBlock: requiredString(row, 'from_block'),
    toBlock: requiredString(row, 'to_block'),
    snapshotHash: requiredString(row, 'snapshot_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(
      row,
      'model_version',
    ) as StoredPensionCandidateReport['modelVersion'],
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function reportId(value: string): string {
  if (!/^pcr_[0-9a-f]{24}$/.test(value)) throw invalid('Pension candidate report ID is invalid.');
  return value;
}

function tokenAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw invalid('Pension candidate token is invalid.');
  return value.toLowerCase();
}

export class PostgresPensionCandidateReportRepository {
  readonly #pool: ReportPool;

  constructor(options: PensionCandidateReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ReportPool): PostgresPensionCandidateReportRepository {
    return new PostgresPensionCandidateReportRepository({ pool });
  }

  async put(report: EvmPensionCandidateDiscovery): Promise<StoredPensionCandidateReport> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO evm_pension_candidate_reports (
          id, chain_id, token_address, from_block, to_block, snapshot_hash, result_hash,
          report, terminal_evidence_id, evidence_ids, source_set, model_version, captured_at
        ) VALUES (
          $1, $2, $3, $4::numeric, $5::numeric, $6, $7,
          $8::jsonb, $9, $10::text[], $11::text[], $12, $13::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.chainId,
          expected.tokenAddress,
          expected.fromBlock,
          expected.toBlock,
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
      if (stored === undefined) throw conflict('Pension candidate report was not stored.');
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof PensionCandidateReportStorageError) throw error;
      throw new PensionCandidateReportStorageError(
        'PENSION_CANDIDATE_REPORT_UNAVAILABLE',
        'Pension candidate report write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredPensionCandidateReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof PensionCandidateReportStorageError) throw error;
      throw new PensionCandidateReportStorageError(
        'PENSION_CANDIDATE_REPORT_UNAVAILABLE',
        'Pension candidate report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(tokenInput: string): Promise<StoredPensionCandidateReport | undefined> {
    const canonicalToken = tokenAddress(tokenInput);
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE token_address = $1
         ORDER BY to_block DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [canonicalToken],
      );
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof PensionCandidateReportStorageError) throw error;
      throw new PensionCandidateReportStorageError(
        'PENSION_CANDIDATE_REPORT_UNAVAILABLE',
        'Latest pension candidate report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: 'PENSION_CANDIDATE_REPORT_UNAVAILABLE' | 'PENSION_CANDIDATE_REPORT_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.evm_pension_candidate_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['016_evm_pension_candidate_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'evm_pension_candidate_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'PENSION_CANDIDATE_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'PENSION_CANDIDATE_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
