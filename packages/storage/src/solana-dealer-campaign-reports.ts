import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  SolanaDealerCampaignReportSchema,
  SolanaPublicKeySchema,
  type SolanaDealerCampaignReport,
} from '@zerotrace/schemas';

export interface SolanaDealerCampaignReportRepositoryOptions {
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

export type SolanaDealerCampaignReportStorageErrorCode =
  | 'SOLANA_DEALER_REPORT_INVALID'
  | 'SOLANA_DEALER_REPORT_CONFLICT'
  | 'SOLANA_DEALER_REPORT_UNAVAILABLE'
  | 'SOLANA_DEALER_REPORT_NOT_INITIALIZED';

export class SolanaDealerCampaignReportStorageError extends Error {
  readonly code: SolanaDealerCampaignReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: SolanaDealerCampaignReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'SolanaDealerCampaignReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredSolanaDealerCampaignReport {
  id: string;
  chainId: 'solana-mainnet';
  mint: string;
  snapshotSlot: string;
  snapshotHash: string;
  resultHash: string;
  report: SolanaDealerCampaignReport;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: string;
  policyVersion: string;
  capturedAt: string;
  createdAt: string;
}

function createPool(options: SolanaDealerCampaignReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-solana-dealer-campaign-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function invalid(message: string, cause?: unknown): SolanaDealerCampaignReportStorageError {
  return new SolanaDealerCampaignReportStorageError('SOLANA_DEALER_REPORT_INVALID', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function conflict(message: string, cause?: unknown): SolanaDealerCampaignReportStorageError {
  return new SolanaDealerCampaignReportStorageError('SOLANA_DEALER_REPORT_CONFLICT', message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw conflict('Stored Solana dealer report is not valid JSON.', error);
  }
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw conflict(`Stored Solana dealer ${field} is invalid.`);
  return parsed.toISOString();
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw conflict(`Stored Solana dealer ${field} is invalid.`);
  }
  return value;
}

function canonicalStringArray(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw conflict(`Stored Solana dealer ${field} is invalid.`);
  }
  const items = value as string[];
  const canonical = [...new Set(items)].sort();
  if (canonical.length !== items.length || canonical.some((item, index) => item !== items[index])) {
    throw conflict(`Stored Solana dealer ${field} is not canonical.`);
  }
  return canonical;
}

function reportWithoutIdentity(
  report: SolanaDealerCampaignReport,
): Omit<SolanaDealerCampaignReport, 'id' | 'resultHash'> {
  return Object.fromEntries(
    Object.entries(report).filter(([key]) => key !== 'id' && key !== 'resultHash'),
  ) as Omit<SolanaDealerCampaignReport, 'id' | 'resultHash'>;
}

function materialize(reportValue: SolanaDealerCampaignReport): StoredSolanaDealerCampaignReport {
  const parsed = SolanaDealerCampaignReportSchema.safeParse(reportValue);
  if (!parsed.success) throw invalid('Solana dealer report is invalid.', parsed.error);
  const report = parsed.data;
  const value = reportWithoutIdentity(report);
  const expectedResultHash = hashPayload(value);
  const expectedId = `sdc_${hashPayload({ schema: report.schemaVersion, value }).slice(0, 24)}`;
  if (report.resultHash !== expectedResultHash || report.id !== expectedId) {
    throw invalid('Solana dealer report identity or resultHash is not canonical.');
  }
  if (report.snapshot.ledger !== 'SOLANA') {
    throw invalid('Solana dealer report must carry a Solana Snapshot.');
  }
  return {
    id: report.id,
    chainId: report.chainId,
    mint: report.mint,
    snapshotSlot: report.snapshot.slot,
    snapshotHash: report.snapshot.blockhash,
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

function reportId(value: string): string {
  if (!/^sdc_[0-9a-f]{24}$/.test(value)) throw invalid('Solana dealer report ID is invalid.');
  return value;
}

function mint(value: string): string {
  const parsed = SolanaPublicKeySchema.safeParse(value);
  if (!parsed.success) throw invalid('Solana dealer mint is invalid.', parsed.error);
  return parsed.data;
}

const SELECT_REPORT = `
  SELECT id, chain_id, mint, snapshot_slot::text, snapshot_hash, result_hash,
         report, evidence_ids, source_set, model_version, policy_version,
         captured_at, created_at
  FROM solana_dealer_campaign_reports
`;

function rowToReport(row: Record<string, unknown>): StoredSolanaDealerCampaignReport {
  const parsed = SolanaDealerCampaignReportSchema.safeParse(json(row.report));
  if (!parsed.success) throw conflict('Stored Solana dealer report is invalid.', parsed.error);
  const stored: StoredSolanaDealerCampaignReport = {
    id: requiredString(row, 'id'),
    chainId: requiredString(row, 'chain_id') as 'solana-mainnet',
    mint: requiredString(row, 'mint'),
    snapshotSlot: requiredString(row, 'snapshot_slot'),
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
    expected.mint !== stored.mint ||
    expected.snapshotSlot !== stored.snapshotSlot ||
    expected.snapshotHash !== stored.snapshotHash ||
    expected.resultHash !== stored.resultHash ||
    expected.modelVersion !== stored.modelVersion ||
    expected.policyVersion !== stored.policyVersion ||
    canonicalJson(expected.evidenceIds) !== canonicalJson(stored.evidenceIds) ||
    canonicalJson(expected.sourceSet) !== canonicalJson(stored.sourceSet)
  ) {
    throw conflict('Stored Solana dealer report conflicts with its immutable identity.');
  }
  return stored;
}

export class PostgresSolanaDealerCampaignReportRepository {
  readonly #pool: ReportPool;

  constructor(options: SolanaDealerCampaignReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromConnectionString(
    options: SolanaDealerCampaignReportRepositoryOptions,
  ): PostgresSolanaDealerCampaignReportRepository {
    return new PostgresSolanaDealerCampaignReportRepository(options);
  }

  static fromPool(pool: ReportPool): PostgresSolanaDealerCampaignReportRepository {
    return new PostgresSolanaDealerCampaignReportRepository({ pool });
  }

  async put(report: SolanaDealerCampaignReport): Promise<StoredSolanaDealerCampaignReport> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        if (
          existing.resultHash !== expected.resultHash ||
          canonicalJson(existing.report) !== canonicalJson(expected.report)
        ) {
          throw conflict('Existing Solana dealer report conflicts with the canonical report.');
        }
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO solana_dealer_campaign_reports (
          id, chain_id, mint, snapshot_slot, snapshot_hash, result_hash, report,
          evidence_ids, source_set, model_version, policy_version, captured_at
        ) VALUES ($1, $2, $3, $4::numeric, $5, $6, $7::jsonb,
                  $8::text[], $9::text[], $10, $11, $12::timestamptz)
         ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.chainId,
          expected.mint,
          expected.snapshotSlot,
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
      if (stored === undefined) throw conflict('Solana dealer report was not stored.');
      if (stored.resultHash !== expected.resultHash) {
        throw conflict('Stored Solana dealer report conflicts after insert.');
      }
      return stored;
    } catch (error) {
      if (error instanceof SolanaDealerCampaignReportStorageError) throw error;
      throw new SolanaDealerCampaignReportStorageError(
        'SOLANA_DEALER_REPORT_UNAVAILABLE',
        'Solana dealer report storage write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredSolanaDealerCampaignReport | undefined> {
    const normalizedId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [normalizedId]);
      const row = result.rows[0];
      return row === undefined ? undefined : rowToReport(row);
    } catch (error) {
      if (error instanceof SolanaDealerCampaignReportStorageError) throw error;
      throw new SolanaDealerCampaignReportStorageError(
        'SOLANA_DEALER_REPORT_UNAVAILABLE',
        'Solana dealer report storage read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async list(input: { mint: string; limit?: number }): Promise<StoredSolanaDealerCampaignReport[]> {
    const normalizedMint = mint(input.mint);
    const limit = Math.min(100, Math.max(1, Math.trunc(input.limit ?? 50)));
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE chain_id = 'solana-mainnet' AND mint = $1
         ORDER BY snapshot_slot DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT $2`,
        [normalizedMint, limit],
      );
      return result.rows.map(rowToReport);
    } catch (error) {
      if (error instanceof SolanaDealerCampaignReportStorageError) throw error;
      throw new SolanaDealerCampaignReportStorageError(
        'SOLANA_DEALER_REPORT_UNAVAILABLE',
        'Solana dealer report list failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(mintInput: string): Promise<StoredSolanaDealerCampaignReport | undefined> {
    const reports = await this.list({ mint: mintInput, limit: 1 });
    return reports[0];
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: SolanaDealerCampaignReportStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.solana_dealer_campaign_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['035_solana_dealer_campaign_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'solana_dealer_campaign_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'SOLANA_DEALER_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'SOLANA_DEALER_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
