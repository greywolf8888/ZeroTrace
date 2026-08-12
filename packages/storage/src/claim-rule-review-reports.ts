import { Pool } from 'pg';

import { validateClaimRuleReviewReport } from '@zerotrace/claim-audit';
import { canonicalJson } from '@zerotrace/evidence';
import {
  ClaimRuleReviewReportSchema,
  type ClaimRuleReviewReport,
  type Ledger,
} from '@zerotrace/schemas';

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface ClaimRuleReviewReportPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

export interface ClaimRuleReviewReportRepositoryOptions {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

interface InternalOptions {
  pool: ClaimRuleReviewReportPool;
}

export type ClaimRuleReviewReportStorageErrorCode =
  | 'CLAIM_RULE_REVIEW_REPORT_UNAVAILABLE'
  | 'CLAIM_RULE_REVIEW_REPORT_NOT_INITIALIZED'
  | 'CLAIM_RULE_REVIEW_REPORT_INVALID'
  | 'CLAIM_RULE_REVIEW_REPORT_CONFLICT';

export class ClaimRuleReviewReportStorageError extends Error {
  readonly code: ClaimRuleReviewReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ClaimRuleReviewReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ClaimRuleReviewReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredClaimRuleReviewReport {
  id: string;
  declarationReportId: string;
  declarationResultHash: string;
  documentHash: string;
  draftId: string;
  ruleId: string;
  ledger: Ledger;
  chainId: string;
  assetId: string;
  resultHash: string;
  report: ClaimRuleReviewReport;
  reviewEvidenceId: string;
  terminalEvidenceId: string;
  tokenDecimalsEvidenceId: string | null;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: string;
  reviewedAt: string;
  createdAt: string;
}

type MaterializedClaimRuleReviewReport = Omit<StoredClaimRuleReviewReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    declaration_report_id,
    declaration_result_hash,
    document_hash,
    draft_id,
    rule_id,
    ledger,
    chain_id,
    asset_id,
    result_hash,
    report,
    review_evidence_id,
    terminal_evidence_id,
    token_decimals_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    reviewed_at,
    created_at
  FROM claim_rule_review_reports
`;

function createPool(options: ClaimRuleReviewReportRepositoryOptions): ClaimRuleReviewReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-claim-rule-review-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ClaimRuleReviewReportStorageError(
      'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
      `Stored Claim rule review ${field} is invalid.`,
    );
  }
  return value;
}

function nullableString(row: Record<string, unknown>, field: string): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  return requiredString(row, field);
}

function timestamp(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ClaimRuleReviewReportStorageError(
      'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
      `Stored Claim rule review ${field} is invalid.`,
    );
  }
  return date.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new ClaimRuleReviewReportStorageError(
      'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
      'Stored Claim rule review JSON is invalid.',
      { cause: error },
    );
  }
}

function canonicalStrings(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new ClaimRuleReviewReportStorageError(
      'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
      `Stored Claim rule review ${field} is invalid.`,
    );
  }
  const strings = value as string[];
  const canonical = [...new Set(strings)].sort();
  if (
    canonical.length !== strings.length ||
    canonical.some((item, index) => item !== strings[index])
  ) {
    throw new ClaimRuleReviewReportStorageError(
      'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
      `Stored Claim rule review ${field} is not canonical.`,
    );
  }
  return canonical;
}

function materialize(reportInput: ClaimRuleReviewReport): MaterializedClaimRuleReviewReport {
  let report: ClaimRuleReviewReport;
  try {
    report = validateClaimRuleReviewReport(ClaimRuleReviewReportSchema.parse(reportInput));
  } catch (error) {
    throw new ClaimRuleReviewReportStorageError(
      'CLAIM_RULE_REVIEW_REPORT_INVALID',
      'Claim rule review report is invalid.',
      { cause: error },
    );
  }
  const reviewEvidence = report.evidence.find((item) => item.id === report.reviewEvidenceId);
  if (reviewEvidence === undefined) {
    throw new ClaimRuleReviewReportStorageError(
      'CLAIM_RULE_REVIEW_REPORT_INVALID',
      'Claim rule review Evidence is missing.',
    );
  }
  return {
    id: report.id,
    declarationReportId: report.declarationReportId,
    declarationResultHash: report.declarationResultHash,
    documentHash: report.documentHash,
    draftId: report.draftId,
    ruleId: report.rule.id,
    ledger: reviewEvidence.ledger,
    chainId: reviewEvidence.chainId,
    assetId: report.assetId,
    resultHash: report.resultHash,
    report,
    reviewEvidenceId: report.reviewEvidenceId,
    terminalEvidenceId: report.terminalEvidenceId,
    tokenDecimalsEvidenceId: report.tokenDecimalsEvidenceId ?? null,
    evidenceIds: report.evidenceIds,
    sourceSet: report.sourceSet,
    modelVersion: report.modelVersion,
    reviewedAt: report.reviewedAt,
  };
}

function fromRow(row: Record<string, unknown>): StoredClaimRuleReviewReport {
  const report = validateClaimRuleReviewReport(ClaimRuleReviewReportSchema.parse(json(row.report)));
  const stored: StoredClaimRuleReviewReport = {
    id: requiredString(row, 'id'),
    declarationReportId: requiredString(row, 'declaration_report_id'),
    declarationResultHash: requiredString(row, 'declaration_result_hash'),
    documentHash: requiredString(row, 'document_hash'),
    draftId: requiredString(row, 'draft_id'),
    ruleId: requiredString(row, 'rule_id'),
    ledger: report.evidence.find((item) => item.id === report.reviewEvidenceId)?.ledger ?? 'EVM',
    chainId: requiredString(row, 'chain_id'),
    assetId: requiredString(row, 'asset_id'),
    resultHash: requiredString(row, 'result_hash'),
    report,
    reviewEvidenceId: requiredString(row, 'review_evidence_id'),
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    tokenDecimalsEvidenceId: nullableString(row, 'token_decimals_evidence_id'),
    evidenceIds: canonicalStrings(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStrings(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version'),
    reviewedAt: timestamp(row.reviewed_at, 'reviewed at'),
    createdAt: timestamp(row.created_at, 'created at'),
  };
  const expected = materialize(report);
  const actualComparable = { ...stored };
  delete (actualComparable as Partial<StoredClaimRuleReviewReport>).createdAt;
  if (
    requiredString(row, 'ledger') !== expected.ledger ||
    canonicalJson(actualComparable) !== canonicalJson(expected)
  ) {
    throw new ClaimRuleReviewReportStorageError(
      'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
      'Stored Claim rule review columns conflict with the canonical report.',
    );
  }
  return stored;
}

function writeError(error: unknown): ClaimRuleReviewReportStorageError {
  if (error instanceof ClaimRuleReviewReportStorageError) return error;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  if (code === '23503' || code === '23505' || code === '23514' || code === 'P0001') {
    return new ClaimRuleReviewReportStorageError(
      'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
      'Claim rule review report conflicts with durable Evidence or immutable state.',
      { cause: error },
    );
  }
  return new ClaimRuleReviewReportStorageError(
    'CLAIM_RULE_REVIEW_REPORT_UNAVAILABLE',
    'Durable Claim rule review report storage is unavailable.',
    { retryable: true, cause: error },
  );
}

export class PostgresClaimRuleReviewReportRepository {
  readonly #pool: ClaimRuleReviewReportPool;

  constructor(options: ClaimRuleReviewReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ClaimRuleReviewReportPool): PostgresClaimRuleReviewReportRepository {
    return new PostgresClaimRuleReviewReportRepository({ pool });
  }

  async put(reportInput: ClaimRuleReviewReport): Promise<StoredClaimRuleReviewReport> {
    const report = materialize(reportInput);
    try {
      await this.#pool.query(
        `
          INSERT INTO claim_rule_review_reports (
            id, declaration_report_id, declaration_result_hash, document_hash, draft_id,
            rule_id, ledger, chain_id, asset_id, result_hash, report, review_evidence_id,
            terminal_evidence_id, token_decimals_evidence_id, evidence_ids, source_set,
            model_version, reviewed_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7::ledger_kind, $8, $9, $10, $11::jsonb, $12,
            $13, $14, $15::text[], $16::text[], $17, $18::timestamptz
          )
          ON CONFLICT (id) DO NOTHING
        `,
        [
          report.id,
          report.declarationReportId,
          report.declarationResultHash,
          report.documentHash,
          report.draftId,
          report.ruleId,
          report.ledger,
          report.chainId,
          report.assetId,
          report.resultHash,
          JSON.stringify(report.report),
          report.reviewEvidenceId,
          report.terminalEvidenceId,
          report.tokenDecimalsEvidenceId,
          report.evidenceIds,
          report.sourceSet,
          report.modelVersion,
          report.reviewedAt,
        ],
      );
      const stored = await this.get(report.id);
      if (stored === undefined || canonicalJson(stored.report) !== canonicalJson(report.report)) {
        throw new ClaimRuleReviewReportStorageError(
          'CLAIM_RULE_REVIEW_REPORT_CONFLICT',
          'Stored Claim rule review report conflicts with the submitted report.',
        );
      }
      return stored;
    } catch (error) {
      throw writeError(error);
    }
  }

  async get(id: string): Promise<StoredClaimRuleReviewReport | undefined> {
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [id]);
      return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
    } catch (error) {
      throw writeError(error);
    }
  }

  async latestByAsset(assetId: string): Promise<StoredClaimRuleReviewReport | undefined> {
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE asset_id = $1
         ORDER BY reviewed_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [assetId],
      );
      return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
    } catch (error) {
      throw writeError(error);
    }
  }

  async latestByDraft(
    declarationReportId: string,
    draftId: string,
  ): Promise<StoredClaimRuleReviewReport | undefined> {
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE declaration_report_id = $1 AND draft_id = $2
         ORDER BY reviewed_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [declarationReportId, draftId],
      );
      return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
    } catch (error) {
      throw writeError(error);
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: ClaimRuleReviewReportStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(`
        SELECT
          to_regclass('public.claim_rule_review_reports')::text AS reports,
          EXISTS (
            SELECT 1 FROM schema_migrations
            WHERE version = '028_claim_rule_review_reports'
          ) AS migrated
      `);
      if (
        result.rows[0]?.reports !== 'claim_rule_review_reports' ||
        result.rows[0]?.migrated !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'CLAIM_RULE_REVIEW_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'CLAIM_RULE_REVIEW_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
