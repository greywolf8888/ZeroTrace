import { Pool } from 'pg';

import {
  calculateClaimVerificationObservationResultHash,
  claimVerificationObservationReportId,
  expectedClaimVerificationObservationTerminalEvidence,
} from '@zerotrace/claim-audit';
import { canonicalJson } from '@zerotrace/evidence';
import {
  ClaimVerificationObservationReportSchema,
  type ClaimStatus,
  type ClaimVerificationObservationReport,
} from '@zerotrace/schemas';

interface ReportPool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

export interface ClaimVerificationReportRepositoryOptions {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

interface InternalOptions {
  pool: ReportPool;
}

export type ClaimVerificationReportStorageErrorCode =
  | 'CLAIM_VERIFICATION_REPORT_INVALID'
  | 'CLAIM_VERIFICATION_REPORT_CONFLICT'
  | 'CLAIM_VERIFICATION_REPORT_UNAVAILABLE'
  | 'CLAIM_VERIFICATION_REPORT_NOT_INITIALIZED';

export class ClaimVerificationReportStorageError extends Error {
  readonly code: ClaimVerificationReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ClaimVerificationReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ClaimVerificationReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredClaimVerificationReport {
  id: string;
  reviewReportId: string;
  reviewResultHash: string;
  ruleId: string;
  assetId: string;
  fromBlock: string;
  toBlock: string;
  sourceObservationReportId: string;
  destinationObservationReportId: string;
  actionSemanticsReportIds: readonly string[];
  resultHash: string;
  report: ClaimVerificationObservationReport;
  status: ClaimStatus;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: 'claim-verification-observation-v0.1.0';
  capturedAt: string;
  createdAt: string;
}

type Materialized = Omit<StoredClaimVerificationReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT id, review_report_id, review_result_hash, rule_id, asset_id,
    from_block::text, to_block::text, source_observation_report_id,
    destination_observation_report_id, action_semantics_report_ids, result_hash,
    report, status, terminal_evidence_id, evidence_ids, source_set, model_version,
    captured_at, created_at
  FROM claim_verification_reports
`;

function createPool(options: ClaimVerificationReportRepositoryOptions): ReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-claim-verification-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function failure(
  code: ClaimVerificationReportStorageErrorCode,
  message: string,
  cause?: unknown,
): ClaimVerificationReportStorageError {
  return new ClaimVerificationReportStorageError(code, message, {
    ...(code === 'CLAIM_VERIFICATION_REPORT_UNAVAILABLE' ? { retryable: true } : {}),
    ...(cause === undefined ? {} : { cause }),
  });
}

function string(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    throw failure('CLAIM_VERIFICATION_REPORT_CONFLICT', `Stored ${field} is invalid.`);
  }
  return value;
}

function strings(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw failure('CLAIM_VERIFICATION_REPORT_CONFLICT', `Stored ${field} is invalid.`);
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw failure('CLAIM_VERIFICATION_REPORT_CONFLICT', `Stored ${field} is not canonical.`);
  }
  return canonical;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw failure('CLAIM_VERIFICATION_REPORT_CONFLICT', `Stored ${field} is invalid.`);
  }
  return parsed.toISOString();
}

function status(value: unknown): ClaimStatus {
  if (
    value !== 'VERIFIED' &&
    value !== 'PARTIALLY_VERIFIED' &&
    value !== 'CONTRADICTED' &&
    value !== 'INSUFFICIENT_DATA'
  ) {
    throw failure('CLAIM_VERIFICATION_REPORT_CONFLICT', 'Stored status is invalid.');
  }
  return value;
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw failure('CLAIM_VERIFICATION_REPORT_CONFLICT', 'Stored report is not JSON.', error);
  }
}

function materialize(input: ClaimVerificationObservationReport): Materialized {
  const parsed = ClaimVerificationObservationReportSchema.safeParse(input);
  if (!parsed.success) {
    throw failure(
      'CLAIM_VERIFICATION_REPORT_INVALID',
      'Claim verification report is invalid.',
      parsed.error,
    );
  }
  const report = parsed.data;
  const resultHash = calculateClaimVerificationObservationResultHash(report);
  const expectedTerminal = expectedClaimVerificationObservationTerminalEvidence(report);
  if (
    report.resultHash !== resultHash ||
    report.id !== claimVerificationObservationReportId(resultHash) ||
    report.terminalEvidenceId !== expectedTerminal.id
  ) {
    throw failure(
      'CLAIM_VERIFICATION_REPORT_INVALID',
      'Claim verification report identity or terminal Evidence is invalid.',
    );
  }
  const snapshot = report.metadata.snapshot;
  if (snapshot === null || snapshot.ledger !== 'EVM') {
    throw failure('CLAIM_VERIFICATION_REPORT_INVALID', 'Claim verification Snapshot is invalid.');
  }
  return {
    id: report.id,
    reviewReportId: report.reviewReportId,
    reviewResultHash: report.reviewResultHash,
    ruleId: report.ruleId,
    assetId: report.assetId,
    fromBlock: report.fromBlock,
    toBlock: report.toBlock,
    sourceObservationReportId: report.sourceObservationReportId,
    destinationObservationReportId: report.destinationObservationReportId,
    actionSemanticsReportIds: report.actionSemanticsReportIds,
    resultHash,
    report,
    status: report.status,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds: report.evidenceIds,
    sourceSet: report.metadata.sourceSet,
    modelVersion: 'claim-verification-observation-v0.1.0',
    capturedAt: snapshot.capturedAt,
  };
}

function same(
  stored: Omit<StoredClaimVerificationReport, 'createdAt'>,
  expected: Materialized,
): void {
  if (canonicalJson(stored) !== canonicalJson(expected)) {
    throw failure(
      'CLAIM_VERIFICATION_REPORT_CONFLICT',
      'Stored Claim verification report conflicts with the canonical report.',
    );
  }
}

function withoutCreatedAt(stored: StoredClaimVerificationReport): Materialized {
  const comparable: Partial<StoredClaimVerificationReport> = { ...stored };
  delete comparable.createdAt;
  return comparable as Materialized;
}

function fromRow(row: Record<string, unknown>): StoredClaimVerificationReport {
  const report = ClaimVerificationObservationReportSchema.parse(json(row.report));
  const stored: StoredClaimVerificationReport = {
    id: string(row, 'id'),
    reviewReportId: string(row, 'review_report_id'),
    reviewResultHash: string(row, 'review_result_hash'),
    ruleId: string(row, 'rule_id'),
    assetId: string(row, 'asset_id'),
    fromBlock: string(row, 'from_block'),
    toBlock: string(row, 'to_block'),
    sourceObservationReportId: string(row, 'source_observation_report_id'),
    destinationObservationReportId: string(row, 'destination_observation_report_id'),
    actionSemanticsReportIds: strings(row.action_semantics_report_ids, 'action report ids'),
    resultHash: string(row, 'result_hash'),
    report,
    status: status(row.status),
    terminalEvidenceId: string(row, 'terminal_evidence_id'),
    evidenceIds: strings(row.evidence_ids, 'Evidence ids'),
    sourceSet: strings(row.source_set, 'source set'),
    modelVersion: string(row, 'model_version') as 'claim-verification-observation-v0.1.0',
    capturedAt: timestamp(row.captured_at, 'captured_at'),
    createdAt: timestamp(row.created_at, 'created_at'),
  };
  same(withoutCreatedAt(stored), materialize(report));
  return stored;
}

function databaseConflict(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  return code === 'P0001' || code.startsWith('23');
}

export class PostgresClaimVerificationReportRepository {
  readonly #pool: ReportPool;

  constructor(options: ClaimVerificationReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ReportPool): PostgresClaimVerificationReportRepository {
    return new PostgresClaimVerificationReportRepository({ pool });
  }

  async put(input: ClaimVerificationObservationReport): Promise<StoredClaimVerificationReport> {
    const expected = materialize(input);
    try {
      await this.#pool.query(
        `INSERT INTO claim_verification_reports (
          id, review_report_id, review_result_hash, rule_id, asset_id, from_block, to_block,
          source_observation_report_id, destination_observation_report_id,
          action_semantics_report_ids, result_hash, report, status, terminal_evidence_id,
          evidence_ids, source_set, model_version, captured_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8, $9, $10::text[], $11,
          $12::jsonb, $13, $14, $15::text[], $16::text[], $17, $18::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.reviewReportId,
          expected.reviewResultHash,
          expected.ruleId,
          expected.assetId,
          expected.fromBlock,
          expected.toBlock,
          expected.sourceObservationReportId,
          expected.destinationObservationReportId,
          expected.actionSemanticsReportIds,
          expected.resultHash,
          canonicalJson(expected.report),
          expected.status,
          expected.terminalEvidenceId,
          expected.evidenceIds,
          expected.sourceSet,
          expected.modelVersion,
          expected.capturedAt,
        ],
      );
      const stored = await this.get(expected.id);
      if (stored === undefined) {
        throw failure(
          'CLAIM_VERIFICATION_REPORT_CONFLICT',
          'Claim verification report was not stored.',
        );
      }
      same(withoutCreatedAt(stored), expected);
      return stored;
    } catch (error) {
      if (error instanceof ClaimVerificationReportStorageError) throw error;
      if (databaseConflict(error)) {
        throw failure(
          'CLAIM_VERIFICATION_REPORT_CONFLICT',
          'PostgreSQL rejected report integrity.',
          error,
        );
      }
      throw failure(
        'CLAIM_VERIFICATION_REPORT_UNAVAILABLE',
        'Claim verification write failed.',
        error,
      );
    }
  }

  async get(id: string): Promise<StoredClaimVerificationReport | undefined> {
    if (!/^cvr_[0-9a-f]{24}$/.test(id)) {
      throw failure(
        'CLAIM_VERIFICATION_REPORT_INVALID',
        'Claim verification report ID is invalid.',
      );
    }
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [id]);
      return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof ClaimVerificationReportStorageError) throw error;
      throw failure(
        'CLAIM_VERIFICATION_REPORT_UNAVAILABLE',
        'Claim verification read failed.',
        error,
      );
    }
  }

  async latestByRule(ruleId: string): Promise<StoredClaimVerificationReport | undefined> {
    if (!/^clr_[0-9a-f]{24}$/.test(ruleId)) {
      throw failure('CLAIM_VERIFICATION_REPORT_INVALID', 'Reviewed Claim rule ID is invalid.');
    }
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT} WHERE rule_id = $1
         ORDER BY to_block DESC, captured_at DESC, created_at DESC, id DESC LIMIT 1`,
        [ruleId],
      );
      return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof ClaimVerificationReportStorageError) throw error;
      throw failure(
        'CLAIM_VERIFICATION_REPORT_UNAVAILABLE',
        'Latest verification read failed.',
        error,
      );
    }
  }

  async latestByAsset(assetId: string): Promise<StoredClaimVerificationReport | undefined> {
    if (!/^eip155:[1-9]\d*:erc20:0x[0-9a-f]{40}$/.test(assetId)) {
      throw failure('CLAIM_VERIFICATION_REPORT_INVALID', 'Claim verification asset id is invalid.');
    }
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT} WHERE asset_id = $1
         ORDER BY to_block DESC, captured_at DESC, created_at DESC, id DESC LIMIT 1`,
        [assetId],
      );
      return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
    } catch (error) {
      if (error instanceof ClaimVerificationReportStorageError) throw error;
      throw failure(
        'CLAIM_VERIFICATION_REPORT_UNAVAILABLE',
        'Latest verification asset read failed.',
        error,
      );
    }
  }

  async health() {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(`SELECT
        to_regclass('public.claim_verification_reports')::text AS table_name,
        EXISTS (SELECT 1 FROM schema_migrations WHERE version = '029_claim_verification_reports') AS migrated`);
      if (
        result.rows[0]?.table_name !== 'claim_verification_reports' ||
        result.rows[0]?.migrated !== true
      ) {
        return {
          status: 'DOWN' as const,
          backend: 'POSTGRES' as const,
          durable: true as const,
          checkedAt,
          errorCode: 'CLAIM_VERIFICATION_REPORT_NOT_INITIALIZED' as const,
        };
      }
      return {
        status: 'UP' as const,
        backend: 'POSTGRES' as const,
        durable: true as const,
        checkedAt,
      };
    } catch {
      return {
        status: 'DOWN' as const,
        backend: 'POSTGRES' as const,
        durable: true as const,
        checkedAt,
        errorCode: 'CLAIM_VERIFICATION_REPORT_UNAVAILABLE' as const,
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
