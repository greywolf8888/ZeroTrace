import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import { FundingSettlementReportSchema, type FundingSettlementReport } from '@zerotrace/schemas';

interface FundingSettlementReportPool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export interface FundingSettlementReportRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface InternalOptions {
  pool: FundingSettlementReportPool;
}

export type FundingSettlementReportStorageErrorCode =
  | 'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE'
  | 'FUNDING_SETTLEMENT_REPORT_NOT_INITIALIZED'
  | 'FUNDING_SETTLEMENT_REPORT_INVALID'
  | 'FUNDING_SETTLEMENT_REPORT_CONFLICT';

export class FundingSettlementReportStorageError extends Error {
  readonly code: FundingSettlementReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: FundingSettlementReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'FundingSettlementReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

const SELECT_REPORT = `
  SELECT
    id,
    report,
    created_at
  FROM funding_settlement_reports
`;

function createPool(
  options: FundingSettlementReportRepositoryOptions,
): FundingSettlementReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-funding-settlement-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new FundingSettlementReportStorageError(
      'FUNDING_SETTLEMENT_REPORT_CONFLICT',
      'Stored Funding Settlement report is not JSON.',
      { cause: error },
    );
  }
}

function reportCore(report: FundingSettlementReport) {
  return Object.fromEntries(
    Object.entries(report).filter(([key]) => key !== 'id' && key !== 'resultHash'),
  );
}

function validateReport(report: unknown): FundingSettlementReport {
  const parsed = FundingSettlementReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new FundingSettlementReportStorageError(
      'FUNDING_SETTLEMENT_REPORT_INVALID',
      'Funding Settlement report is invalid.',
      { cause: parsed.error },
    );
  }
  const value = parsed.data;
  const resultHash = hashPayload({
    schema: 'funding-settlement-report-v1',
    report: reportCore(value),
  });
  if (value.resultHash !== resultHash) {
    throw new FundingSettlementReportStorageError(
      'FUNDING_SETTLEMENT_REPORT_INVALID',
      'Funding Settlement result hash does not match its canonical report.',
    );
  }
  return value;
}

function reportId(value: string): string {
  if (!/^fsr_[0-9a-f]{24}$/.test(value)) {
    throw new FundingSettlementReportStorageError(
      'FUNDING_SETTLEMENT_REPORT_INVALID',
      'Funding Settlement report ID is invalid.',
    );
  }
  return value;
}

function rowReport(row: Record<string, unknown>): FundingSettlementReport {
  const id = row.id;
  if (typeof id !== 'string') {
    throw new FundingSettlementReportStorageError(
      'FUNDING_SETTLEMENT_REPORT_CONFLICT',
      'Stored Funding Settlement report ID is invalid.',
    );
  }
  const report = validateReport(json(row.report));
  if (report.id !== id) {
    throw new FundingSettlementReportStorageError(
      'FUNDING_SETTLEMENT_REPORT_CONFLICT',
      'Stored Funding Settlement report ID conflicts with its payload.',
    );
  }
  return report;
}

function isIntegrityError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (code === 'P0001' || code.startsWith('23'));
}

export class PostgresFundingSettlementReportRepository {
  readonly #pool: FundingSettlementReportPool;

  constructor(options: FundingSettlementReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: FundingSettlementReportPool): PostgresFundingSettlementReportRepository {
    return new PostgresFundingSettlementReportRepository({ pool });
  }

  async put(report: FundingSettlementReport): Promise<FundingSettlementReport> {
    const expected = validateReport(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        if (canonicalJson(existing) !== canonicalJson(expected)) {
          throw new FundingSettlementReportStorageError(
            'FUNDING_SETTLEMENT_REPORT_CONFLICT',
            'Stored Funding Settlement report conflicts with the canonical result.',
          );
        }
        return existing;
      }
      const snapshot = expected.snapshot;
      if (snapshot.ledger !== 'EVM') {
        throw new FundingSettlementReportStorageError(
          'FUNDING_SETTLEMENT_REPORT_INVALID',
          'Funding Settlement report Snapshot must be EVM.',
        );
      }
      await this.#pool.query(
        `INSERT INTO funding_settlement_reports (
          id, ledger, chain_id, token, from_block, to_block, status,
          snapshot_position, snapshot_hash, result_hash, report,
          coverage_scope, funding_edge_count, settlement_edge_count,
          evidence_ids, source_set, model_version, policy_version, freshness
        ) VALUES (
          $1, $2::ledger_kind, $3, $4, $5::numeric, $6::numeric, $7,
          $8::numeric, $9, $10, $11::jsonb,
          $12, $13, $14, $15::text[], $16::text[], $17, $18, $19::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.ledger,
          expected.chainId,
          expected.token,
          expected.fromBlock,
          expected.toBlock,
          expected.status,
          snapshot.blockNumber,
          snapshot.blockHash,
          expected.resultHash,
          canonicalJson(expected),
          expected.coverageScope,
          expected.fundingEdges.length,
          expected.settlementEdges.length,
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.policyVersion,
          expected.freshness,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) {
        throw new FundingSettlementReportStorageError(
          'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
          'Funding Settlement report was not stored.',
          { retryable: true },
        );
      }
      if (canonicalJson(stored) !== canonicalJson(expected)) {
        throw new FundingSettlementReportStorageError(
          'FUNDING_SETTLEMENT_REPORT_CONFLICT',
          'Stored Funding Settlement report conflicts with the canonical result.',
        );
      }
      return stored;
    } catch (error) {
      if (error instanceof FundingSettlementReportStorageError) throw error;
      if (isIntegrityError(error)) {
        throw new FundingSettlementReportStorageError(
          'FUNDING_SETTLEMENT_REPORT_CONFLICT',
          'PostgreSQL rejected Funding Settlement report integrity.',
          { cause: error },
        );
      }
      throw new FundingSettlementReportStorageError(
        'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
        'Funding Settlement report write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<FundingSettlementReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowReport(result.rows[0]);
    } catch (error) {
      if (error instanceof FundingSettlementReportStorageError) throw error;
      throw new FundingSettlementReportStorageError(
        'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
        'Funding Settlement report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(chainId: string, token: string): Promise<FundingSettlementReport | undefined> {
    if (!/^eip155:[1-9]\d*$/.test(chainId) || !/^0x[0-9a-f]{40}$/.test(token)) {
      throw new FundingSettlementReportStorageError(
        'FUNDING_SETTLEMENT_REPORT_INVALID',
        'Funding Settlement latest lookup identity is invalid.',
      );
    }
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT} WHERE chain_id = $1 AND token = $2 ORDER BY to_block DESC, freshness DESC, created_at DESC, id DESC LIMIT 1`,
        [chainId, token],
      );
      return result.rows[0] === undefined ? undefined : rowReport(result.rows[0]);
    } catch (error) {
      if (error instanceof FundingSettlementReportStorageError) throw error;
      throw new FundingSettlementReportStorageError(
        'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
        'Latest Funding Settlement report read failed.',
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
      'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE' | 'FUNDING_SETTLEMENT_REPORT_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.funding_settlement_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['033_funding_settlement_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'funding_settlement_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'FUNDING_SETTLEMENT_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'FUNDING_SETTLEMENT_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
