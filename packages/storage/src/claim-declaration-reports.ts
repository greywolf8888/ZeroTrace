import { Pool } from 'pg';

import { validateClaimDeclarationReport } from '@zerotrace/claim-audit';
import { canonicalJson } from '@zerotrace/evidence';
import {
  ClaimDeclarationParseResultSchema,
  type ClaimDeclarationParseResult,
  type Ledger,
} from '@zerotrace/schemas';

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface ClaimDeclarationReportPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

export interface ClaimDeclarationReportRepositoryOptions {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

interface InternalOptions {
  pool: ClaimDeclarationReportPool;
}

export type ClaimDeclarationReportStorageErrorCode =
  | 'CLAIM_DECLARATION_REPORT_UNAVAILABLE'
  | 'CLAIM_DECLARATION_REPORT_NOT_INITIALIZED'
  | 'CLAIM_DECLARATION_REPORT_INVALID'
  | 'CLAIM_DECLARATION_REPORT_CONFLICT';

export class ClaimDeclarationReportStorageError extends Error {
  readonly code: ClaimDeclarationReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ClaimDeclarationReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ClaimDeclarationReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredClaimDeclarationReport {
  id: string;
  sourceSnapshotId: string;
  documentHash: string;
  contentHash: string;
  ledger: Ledger;
  chainId: string;
  assetId: string;
  resultHash: string;
  report: ClaimDeclarationParseResult;
  sourceEvidenceId: string;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: string;
  freshness: string;
  fieldExtractionCoverage: number | null;
  extractionConfidence: number | null;
  createdAt: string;
}

type MaterializedClaimDeclarationReport = Omit<StoredClaimDeclarationReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    source_snapshot_id,
    document_hash,
    content_hash,
    ledger,
    chain_id,
    asset_id,
    result_hash,
    report,
    source_evidence_id,
    terminal_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    freshness,
    field_extraction_coverage,
    extraction_confidence,
    created_at
  FROM claim_declaration_reports
`;

function createPool(options: ClaimDeclarationReportRepositoryOptions): ClaimDeclarationReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-claim-declaration-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ClaimDeclarationReportStorageError(
      'CLAIM_DECLARATION_REPORT_CONFLICT',
      `Stored Claim declaration ${field} is invalid.`,
    );
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ClaimDeclarationReportStorageError(
      'CLAIM_DECLARATION_REPORT_CONFLICT',
      `Stored Claim declaration ${field} is invalid.`,
    );
  }
  return date.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new ClaimDeclarationReportStorageError(
      'CLAIM_DECLARATION_REPORT_CONFLICT',
      'Stored Claim declaration JSON is invalid.',
      { cause: error },
    );
  }
}

function canonicalStrings(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new ClaimDeclarationReportStorageError(
      'CLAIM_DECLARATION_REPORT_CONFLICT',
      `Stored Claim declaration ${field} is invalid.`,
    );
  }
  const strings = value as string[];
  const canonical = [...new Set(strings)].sort();
  if (
    canonical.length !== strings.length ||
    canonical.some((item, index) => item !== strings[index])
  ) {
    throw new ClaimDeclarationReportStorageError(
      'CLAIM_DECLARATION_REPORT_CONFLICT',
      `Stored Claim declaration ${field} is not canonical.`,
    );
  }
  return canonical;
}

function optionalRatio(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  const ratio = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new ClaimDeclarationReportStorageError(
      'CLAIM_DECLARATION_REPORT_CONFLICT',
      `Stored Claim declaration ${field} is invalid.`,
    );
  }
  return ratio;
}

function materialize(reportInput: ClaimDeclarationParseResult): MaterializedClaimDeclarationReport {
  let report: ClaimDeclarationParseResult;
  try {
    report = validateClaimDeclarationReport(ClaimDeclarationParseResultSchema.parse(reportInput));
  } catch (error) {
    throw new ClaimDeclarationReportStorageError(
      'CLAIM_DECLARATION_REPORT_INVALID',
      'Claim declaration report is invalid.',
      { cause: error },
    );
  }
  return {
    id: report.id,
    sourceSnapshotId: report.sourceSnapshot.id,
    documentHash: report.documentHash,
    contentHash: report.sourceSnapshot.contentHash,
    ledger: report.evidence.ledger,
    chainId: report.evidence.chainId,
    assetId: report.assetId,
    resultHash: report.resultHash,
    report,
    sourceEvidenceId: report.evidence.id,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds: report.evidenceIds,
    sourceSet: report.sourceSet,
    modelVersion: report.modelVersion,
    freshness: report.freshness,
    fieldExtractionCoverage:
      report.coverage.fieldExtraction.state === 'known'
        ? report.coverage.fieldExtraction.value
        : null,
    extractionConfidence:
      report.extractionConfidence.state === 'known' ? report.extractionConfidence.value : null,
  };
}

function fromRow(row: Record<string, unknown>): StoredClaimDeclarationReport {
  const report = validateClaimDeclarationReport(
    ClaimDeclarationParseResultSchema.parse(json(row.report)),
  );
  const stored: StoredClaimDeclarationReport = {
    id: requiredString(row, 'id'),
    sourceSnapshotId: requiredString(row, 'source_snapshot_id'),
    documentHash: requiredString(row, 'document_hash'),
    contentHash: requiredString(row, 'content_hash'),
    ledger: report.evidence.ledger,
    chainId: requiredString(row, 'chain_id'),
    assetId: requiredString(row, 'asset_id'),
    resultHash: requiredString(row, 'result_hash'),
    report,
    sourceEvidenceId: requiredString(row, 'source_evidence_id'),
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    evidenceIds: canonicalStrings(row.evidence_ids, 'Evidence IDs'),
    sourceSet: canonicalStrings(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version'),
    freshness: timestamp(row.freshness, 'freshness'),
    fieldExtractionCoverage: optionalRatio(
      row.field_extraction_coverage,
      'field extraction coverage',
    ),
    extractionConfidence: optionalRatio(row.extraction_confidence, 'extraction confidence'),
    createdAt: timestamp(row.created_at, 'created at'),
  };
  const expected = materialize(report);
  const actualComparable = { ...stored };
  delete (actualComparable as Partial<StoredClaimDeclarationReport>).createdAt;
  if (
    requiredString(row, 'ledger') !== expected.ledger ||
    canonicalJson(actualComparable) !== canonicalJson(expected)
  ) {
    throw new ClaimDeclarationReportStorageError(
      'CLAIM_DECLARATION_REPORT_CONFLICT',
      'Stored Claim declaration columns conflict with the canonical report.',
    );
  }
  return stored;
}

function writeError(error: unknown): ClaimDeclarationReportStorageError {
  if (error instanceof ClaimDeclarationReportStorageError) return error;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  if (code === '23503' || code === '23505' || code === '23514' || code === 'P0001') {
    return new ClaimDeclarationReportStorageError(
      'CLAIM_DECLARATION_REPORT_CONFLICT',
      'Claim declaration report conflicts with durable Evidence or immutable state.',
      { cause: error },
    );
  }
  return new ClaimDeclarationReportStorageError(
    'CLAIM_DECLARATION_REPORT_UNAVAILABLE',
    'Durable Claim declaration report storage is unavailable.',
    { retryable: true, cause: error },
  );
}

export class PostgresClaimDeclarationReportRepository {
  readonly #pool: ClaimDeclarationReportPool;

  constructor(options: ClaimDeclarationReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ClaimDeclarationReportPool): PostgresClaimDeclarationReportRepository {
    return new PostgresClaimDeclarationReportRepository({ pool });
  }

  async put(reportInput: ClaimDeclarationParseResult): Promise<StoredClaimDeclarationReport> {
    const report = materialize(reportInput);
    try {
      await this.#pool.query(
        `
          INSERT INTO claim_declaration_reports (
            id, source_snapshot_id, document_hash, content_hash, ledger, chain_id, asset_id,
            result_hash, report, source_evidence_id, terminal_evidence_id, evidence_ids,
            source_set, model_version, freshness, field_extraction_coverage,
            extraction_confidence
          ) VALUES (
            $1, $2, $3, $4, $5::ledger_kind, $6, $7, $8, $9::jsonb, $10, $11, $12::text[],
            $13::text[], $14, $15::timestamptz, $16, $17
          )
          ON CONFLICT (id) DO NOTHING
        `,
        [
          report.id,
          report.sourceSnapshotId,
          report.documentHash,
          report.contentHash,
          report.ledger,
          report.chainId,
          report.assetId,
          report.resultHash,
          JSON.stringify(report.report),
          report.sourceEvidenceId,
          report.terminalEvidenceId,
          report.evidenceIds,
          report.sourceSet,
          report.modelVersion,
          report.freshness,
          report.fieldExtractionCoverage,
          report.extractionConfidence,
        ],
      );
      const stored = await this.get(report.id);
      if (stored === undefined || canonicalJson(stored.report) !== canonicalJson(report.report)) {
        throw new ClaimDeclarationReportStorageError(
          'CLAIM_DECLARATION_REPORT_CONFLICT',
          'Stored Claim declaration report conflicts with the submitted report.',
        );
      }
      return stored;
    } catch (error) {
      throw writeError(error);
    }
  }

  async get(id: string): Promise<StoredClaimDeclarationReport | undefined> {
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [id]);
      return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
    } catch (error) {
      throw writeError(error);
    }
  }

  async latestByAsset(assetId: string): Promise<StoredClaimDeclarationReport | undefined> {
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE asset_id = $1
         ORDER BY freshness DESC, created_at DESC, id DESC
         LIMIT 1`,
        [assetId],
      );
      return result.rows[0] === undefined ? undefined : fromRow(result.rows[0]);
    } catch (error) {
      throw writeError(error);
    }
  }

  async latestByDocument(
    documentHash: string,
    assetId: string,
  ): Promise<StoredClaimDeclarationReport | undefined> {
    if (!/^[0-9a-f]{64}$/.test(documentHash)) {
      throw new ClaimDeclarationReportStorageError(
        'CLAIM_DECLARATION_REPORT_INVALID',
        'Claim declaration document hash is invalid.',
      );
    }
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE document_hash = $1 AND asset_id = $2
         ORDER BY freshness DESC, created_at DESC, id DESC
         LIMIT 1`,
        [documentHash, assetId],
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
    errorCode?: ClaimDeclarationReportStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(`
        SELECT
          to_regclass('public.claim_declaration_reports')::text AS reports,
          EXISTS (
            SELECT 1 FROM schema_migrations
            WHERE version = '027_claim_declaration_reports'
          ) AS migrated
      `);
      if (
        result.rows[0]?.reports !== 'claim_declaration_reports' ||
        result.rows[0]?.migrated !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'CLAIM_DECLARATION_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'CLAIM_DECLARATION_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
