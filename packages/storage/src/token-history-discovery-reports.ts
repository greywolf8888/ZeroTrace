import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  TokenHistoryDiscoveryReportSchema,
  type TokenHistoryDiscoveryReport,
} from '@zerotrace/schemas';

interface TokenHistoryReportPool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export interface TokenHistoryDiscoveryReportRepositoryOptions {
  connectionString: string;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  maxConnections?: number;
}

interface InternalOptions {
  pool: TokenHistoryReportPool;
}

export type TokenHistoryDiscoveryReportStorageErrorCode =
  | 'TOKEN_HISTORY_REPORT_UNAVAILABLE'
  | 'TOKEN_HISTORY_REPORT_NOT_INITIALIZED'
  | 'TOKEN_HISTORY_REPORT_INVALID'
  | 'TOKEN_HISTORY_REPORT_CONFLICT';

export class TokenHistoryDiscoveryReportStorageError extends Error {
  readonly code: TokenHistoryDiscoveryReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: TokenHistoryDiscoveryReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'TokenHistoryDiscoveryReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

const SELECT_REPORT = `
  SELECT
    id,
    report,
    created_at
  FROM token_history_discovery_reports
`;

function createPool(options: TokenHistoryDiscoveryReportRepositoryOptions): TokenHistoryReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-token-history-discovery-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new TokenHistoryDiscoveryReportStorageError(
      'TOKEN_HISTORY_REPORT_CONFLICT',
      'Stored Token History Discovery report is not JSON.',
      { cause: error },
    );
  }
}

function reportCore(report: TokenHistoryDiscoveryReport) {
  return Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'resultHash'));
}

function validateReport(report: unknown): TokenHistoryDiscoveryReport {
  const parsed = TokenHistoryDiscoveryReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new TokenHistoryDiscoveryReportStorageError(
      'TOKEN_HISTORY_REPORT_INVALID',
      'Token History Discovery report is invalid.',
      { cause: parsed.error },
    );
  }
  const value = parsed.data;
  const resultHash = hashPayload({
    schema: 'token-history-discovery-result-v1',
    reportCore: reportCore(value),
  });
  if (value.resultHash !== resultHash) {
    throw new TokenHistoryDiscoveryReportStorageError(
      'TOKEN_HISTORY_REPORT_INVALID',
      'Token History Discovery result hash does not match its canonical report.',
    );
  }
  return value;
}

function reportId(value: string): string {
  if (!/^thd_[0-9a-f]{24}$/.test(value)) {
    throw new TokenHistoryDiscoveryReportStorageError(
      'TOKEN_HISTORY_REPORT_INVALID',
      'Token History Discovery report ID is invalid.',
    );
  }
  return value;
}

function rowReport(row: Record<string, unknown>): TokenHistoryDiscoveryReport {
  const id = row.id;
  if (typeof id !== 'string') {
    throw new TokenHistoryDiscoveryReportStorageError(
      'TOKEN_HISTORY_REPORT_CONFLICT',
      'Stored Token History Discovery report ID is invalid.',
    );
  }
  const report = validateReport(json(row.report));
  if (report.id !== id) {
    throw new TokenHistoryDiscoveryReportStorageError(
      'TOKEN_HISTORY_REPORT_CONFLICT',
      'Stored Token History Discovery report ID conflicts with its payload.',
    );
  }
  return report;
}

function isIntegrityError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && (code === 'P0001' || code.startsWith('23'));
}

export class PostgresTokenHistoryDiscoveryReportRepository {
  readonly #pool: TokenHistoryReportPool;

  constructor(options: TokenHistoryDiscoveryReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: TokenHistoryReportPool): PostgresTokenHistoryDiscoveryReportRepository {
    return new PostgresTokenHistoryDiscoveryReportRepository({ pool });
  }

  async put(report: TokenHistoryDiscoveryReport): Promise<TokenHistoryDiscoveryReport> {
    const expected = validateReport(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        if (canonicalJson(existing) !== canonicalJson(expected)) {
          throw new TokenHistoryDiscoveryReportStorageError(
            'TOKEN_HISTORY_REPORT_CONFLICT',
            'Stored Token History Discovery report conflicts with the canonical result.',
          );
        }
        return existing;
      }
      const snapshot = expected.snapshot;
      if (snapshot.ledger !== 'EVM') {
        throw new TokenHistoryDiscoveryReportStorageError(
          'TOKEN_HISTORY_REPORT_INVALID',
          'Token History Discovery report Snapshot must be EVM.',
        );
      }
      await this.#pool.query(
        `INSERT INTO token_history_discovery_reports (
          id, ledger, chain_id, token, from_block, to_block, status,
          snapshot_position, snapshot_hash, result_hash, report,
          relevant_transaction_hashes, range_evidence_ids, evidence_ids, source_set,
          model_version, policy_version, freshness
        ) VALUES (
          $1, $2::ledger_kind, $3, $4, $5::numeric, $6::numeric, $7,
          $8::numeric, $9, $10, $11::jsonb,
          $12::text[], $13::text[], $14::text[], $15::text[],
          $16, $17, $18::timestamptz
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
          expected.relevantTransactionHashes,
          expected.rangeEvidenceIds,
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.policyVersion,
          expected.freshness,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) {
        throw new TokenHistoryDiscoveryReportStorageError(
          'TOKEN_HISTORY_REPORT_UNAVAILABLE',
          'Token History Discovery report was not stored.',
          { retryable: true },
        );
      }
      if (canonicalJson(stored) !== canonicalJson(expected)) {
        throw new TokenHistoryDiscoveryReportStorageError(
          'TOKEN_HISTORY_REPORT_CONFLICT',
          'Stored Token History Discovery report conflicts with the canonical result.',
        );
      }
      return stored;
    } catch (error) {
      if (error instanceof TokenHistoryDiscoveryReportStorageError) throw error;
      if (isIntegrityError(error)) {
        throw new TokenHistoryDiscoveryReportStorageError(
          'TOKEN_HISTORY_REPORT_CONFLICT',
          'PostgreSQL rejected Token History Discovery report integrity.',
          { cause: error },
        );
      }
      throw new TokenHistoryDiscoveryReportStorageError(
        'TOKEN_HISTORY_REPORT_UNAVAILABLE',
        'Token History Discovery report write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<TokenHistoryDiscoveryReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowReport(result.rows[0]);
    } catch (error) {
      if (error instanceof TokenHistoryDiscoveryReportStorageError) throw error;
      throw new TokenHistoryDiscoveryReportStorageError(
        'TOKEN_HISTORY_REPORT_UNAVAILABLE',
        'Token History Discovery report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: 'TOKEN_HISTORY_REPORT_UNAVAILABLE' | 'TOKEN_HISTORY_REPORT_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.token_history_discovery_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['032_token_history_discovery_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'token_history_discovery_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'TOKEN_HISTORY_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'TOKEN_HISTORY_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
