import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  BitcoinForensicGraphReportSchema,
  type BitcoinForensicGraphReport,
} from '@zerotrace/schemas';

export interface BitcoinForensicGraphReportRepositoryOptions {
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

export type BitcoinForensicGraphReportStorageErrorCode =
  | 'BITCOIN_FORENSIC_GRAPH_INVALID'
  | 'BITCOIN_FORENSIC_GRAPH_CONFLICT'
  | 'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE'
  | 'BITCOIN_FORENSIC_GRAPH_NOT_INITIALIZED';

export class BitcoinForensicGraphReportStorageError extends Error {
  readonly code: BitcoinForensicGraphReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: BitcoinForensicGraphReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'BitcoinForensicGraphReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredBitcoinForensicGraphReport {
  id: string;
  chainId: 'bitcoin-mainnet';
  snapshotHeight: string;
  snapshotHash: string;
  resultHash: string;
  report: BitcoinForensicGraphReport;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: string;
  policyVersion: string;
  capturedAt: string;
  createdAt: string;
}

function createPool(options: BitcoinForensicGraphReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-bitcoin-forensic-graphs',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): BitcoinForensicGraphReportStorageError {
  return new BitcoinForensicGraphReportStorageError('BITCOIN_FORENSIC_GRAPH_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): BitcoinForensicGraphReportStorageError {
  return new BitcoinForensicGraphReportStorageError('BITCOIN_FORENSIC_GRAPH_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored Bitcoin forensic graph is not valid JSON.', error);
  }
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime()))
    throw conflict(`Stored Bitcoin forensic ${field} is invalid.`);
  return parsed.toISOString();
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored Bitcoin forensic ${field} is invalid.`);
  }
  return value;
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw conflict(`Stored Bitcoin forensic ${field} is invalid.`);
  }
  const items = value as string[];
  const canonical = [...new Set(items)].sort();
  if (canonical.length !== items.length || canonical.some((item, index) => item !== items[index])) {
    throw conflict(`Stored Bitcoin forensic ${field} is not canonical.`);
  }
  return canonical;
}

function materialize(reportValue: BitcoinForensicGraphReport): StoredBitcoinForensicGraphReport {
  const parsed = BitcoinForensicGraphReportSchema.safeParse(reportValue);
  if (!parsed.success) throw invalid('Bitcoin forensic graph report is invalid.', parsed.error);
  const report = parsed.data;
  const value = Object.fromEntries(
    Object.entries(report).filter(([key]) => key !== 'resultHash'),
  ) as Omit<BitcoinForensicGraphReport, 'resultHash'>;
  const expectedResultHash = hashPayload(value);
  if (report.resultHash !== expectedResultHash) {
    throw invalid('Bitcoin forensic graph resultHash is not canonical.');
  }
  return {
    id: report.id,
    chainId: report.chainId,
    snapshotHeight: report.snapshotEnd.height,
    snapshotHash: report.snapshotEnd.blockHash,
    resultHash: report.resultHash,
    report,
    evidenceIds: report.evidenceIds,
    sourceSet: report.sourceSet,
    modelVersion: report.modelVersion,
    policyVersion: report.policyVersion,
    capturedAt: report.freshness,
    createdAt: report.freshness,
  };
}

const SELECT_REPORT = `
  SELECT id, chain_id, snapshot_height::text, snapshot_hash, result_hash,
         report, evidence_ids, source_set, model_version, policy_version,
         captured_at, created_at
  FROM bitcoin_forensic_graph_reports
`;

function rowToReport(row: Record<string, unknown>): StoredBitcoinForensicGraphReport {
  const parsed = BitcoinForensicGraphReportSchema.safeParse(json(row.report));
  if (!parsed.success)
    throw conflict('Stored Bitcoin forensic graph payload is invalid.', parsed.error);
  const stored: StoredBitcoinForensicGraphReport = {
    id: requiredString(row, 'id'),
    chainId: requiredString(row, 'chain_id') as 'bitcoin-mainnet',
    snapshotHeight: requiredString(row, 'snapshot_height'),
    snapshotHash: requiredString(row, 'snapshot_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    evidenceIds: canonicalStringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version'),
    policyVersion: requiredString(row, 'policy_version'),
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  const expected = materialize(stored.report);
  if (
    expected.id !== stored.id ||
    expected.chainId !== stored.chainId ||
    expected.snapshotHeight !== stored.snapshotHeight ||
    expected.snapshotHash !== stored.snapshotHash ||
    expected.resultHash !== stored.resultHash ||
    expected.modelVersion !== stored.modelVersion ||
    expected.policyVersion !== stored.policyVersion ||
    canonicalJson(expected.evidenceIds) !== canonicalJson(stored.evidenceIds) ||
    canonicalJson(expected.sourceSet) !== canonicalJson(stored.sourceSet)
  ) {
    throw conflict('Stored Bitcoin forensic graph conflicts with immutable report identity.');
  }
  return stored;
}

function reportId(value: string): string {
  if (!/^bfg_[0-9a-f]{24}$/.test(value))
    throw invalid('Bitcoin forensic graph report ID is invalid.');
  return value;
}

export class PostgresBitcoinForensicGraphReportRepository {
  readonly #pool: ReportPool;

  constructor(options: BitcoinForensicGraphReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromConnectionString(
    options: BitcoinForensicGraphReportRepositoryOptions,
  ): PostgresBitcoinForensicGraphReportRepository {
    return new PostgresBitcoinForensicGraphReportRepository(options);
  }

  static fromPool(pool: ReportPool): PostgresBitcoinForensicGraphReportRepository {
    return new PostgresBitcoinForensicGraphReportRepository({ pool });
  }

  async put(report: BitcoinForensicGraphReport): Promise<StoredBitcoinForensicGraphReport> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        if (canonicalJson(existing.report) !== canonicalJson(expected.report)) {
          throw conflict('Existing Bitcoin forensic graph conflicts with the canonical report.');
        }
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO bitcoin_forensic_graph_reports (
          id, chain_id, snapshot_height, snapshot_hash, result_hash, report,
          evidence_ids, source_set, model_version, policy_version, captured_at
        ) VALUES ($1, $2, $3::numeric, $4, $5, $6::jsonb,
                  $7::text[], $8::text[], $9, $10, $11::timestamptz)
         ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.chainId,
          expected.snapshotHeight,
          expected.snapshotHash,
          expected.resultHash,
          canonicalJson(expected.report),
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.policyVersion,
          expected.capturedAt,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) throw conflict('Bitcoin forensic graph was not stored.');
      if (stored.resultHash !== expected.resultHash) {
        throw conflict('Stored Bitcoin forensic graph conflicts after insert.');
      }
      return stored;
    } catch (error) {
      if (error instanceof BitcoinForensicGraphReportStorageError) throw error;
      throw new BitcoinForensicGraphReportStorageError(
        'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
        'Bitcoin forensic graph storage write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredBitcoinForensicGraphReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof BitcoinForensicGraphReportStorageError) throw error;
      throw new BitcoinForensicGraphReportStorageError(
        'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
        'Bitcoin forensic graph storage read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async list(
    input: { rootTxid?: string; limit?: number } = {},
  ): Promise<StoredBitcoinForensicGraphReport[]> {
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 50)));
    if (input.rootTxid !== undefined && !/^[0-9a-fA-F]{64}$/.test(input.rootTxid)) {
      throw invalid('Bitcoin root transaction ID is invalid.');
    }
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         ${input.rootTxid === undefined ? '' : "WHERE report->'rootTxids' ? $1"}
         ORDER BY snapshot_height DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT $${input.rootTxid === undefined ? 1 : 2}`,
        input.rootTxid === undefined ? [limit] : [input.rootTxid.toLowerCase(), limit],
      );
      return result.rows.map(rowToReport);
    } catch (error) {
      if (error instanceof BitcoinForensicGraphReportStorageError) throw error;
      throw new BitcoinForensicGraphReportStorageError(
        'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
        'Bitcoin forensic graph list failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: BitcoinForensicGraphReportStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.bitcoin_forensic_graph_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['036_bitcoin_forensic_graph_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'bitcoin_forensic_graph_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'BITCOIN_FORENSIC_GRAPH_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'BITCOIN_FORENSIC_GRAPH_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
