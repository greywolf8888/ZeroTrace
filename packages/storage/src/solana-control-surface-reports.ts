import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  SolanaControlSurfaceReportSchema,
  type SolanaControlSurfaceReport,
} from '@zerotrace/schemas';

import {
  ControlSurfaceReportStorageError,
  type ControlSurfaceReportRepositoryOptions,
} from './control-surface-reports.js';

interface ControlSurfacePool {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end(): Promise<void>;
}

interface InternalOptions {
  pool: ControlSurfacePool;
}

export interface StoredSolanaControlSurfaceReport {
  id: string;
  chainId: 'solana-mainnet';
  subject: string;
  snapshotSlot: string;
  snapshotHash: string;
  resultHash: string;
  report: SolanaControlSurfaceReport;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: string;
  capturedAt: string;
  createdAt: string;
}

type Materialized = Omit<StoredSolanaControlSurfaceReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    chain_id,
    subject_address,
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
  FROM solana_control_surface_reports
`;

function createPool(options: ControlSurfaceReportRepositoryOptions): ControlSurfacePool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-solana-control-surface-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_CONFLICT',
      `Stored Solana control surface ${field} is invalid.`,
    );
  }
  return value;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_CONFLICT',
      `Stored Solana control surface ${field} is invalid.`,
    );
  }
  return parsed.toISOString();
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_CONFLICT',
      'Stored Solana control surface report is not JSON.',
      { cause: error },
    );
  }
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_CONFLICT',
      `Stored Solana control surface ${field} is invalid.`,
    );
  }
  const parsed = value as string[];
  const canonical = [...new Set(parsed)].sort();
  if (
    canonical.length !== parsed.length ||
    canonical.some((item, index) => item !== parsed[index])
  ) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_CONFLICT',
      `Stored Solana control surface ${field} is not canonical.`,
    );
  }
  return canonical;
}

function materialize(input: SolanaControlSurfaceReport): Materialized {
  const parsed = SolanaControlSurfaceReportSchema.safeParse(input);
  if (!parsed.success) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_INVALID',
      'Solana control surface report is invalid.',
      { cause: parsed.error },
    );
  }
  const report = parsed.data;
  const snapshot = report.metadata.snapshot;
  if (snapshot?.ledger !== 'SOLANA' || snapshot.commitment !== 'finalized') {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_INVALID',
      'Solana control surface requires a finalized Snapshot.',
    );
  }
  const evidenceIds = [...report.metadata.evidenceIds];
  const sourceSet = [...report.metadata.sourceSet];
  if (
    sourceSet.length === 0 ||
    sourceSet.length !== new Set(sourceSet).size ||
    sourceSet.some((item, index) => item !== [...sourceSet].sort()[index])
  ) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_INVALID',
      'Solana control surface source set must be non-empty, sorted, and unique.',
    );
  }
  const resultHash = hashPayload(report);
  return {
    id: `scs_${hashPayload({ schema: 'zerotrace-solana-control-surface-report-v1', resultHash }).slice(0, 24)}`,
    chainId: 'solana-mainnet',
    subject: report.subject,
    snapshotSlot: snapshot.slot,
    snapshotHash: snapshot.blockhash,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds,
    sourceSet,
    modelVersion: report.metadata.modelVersion,
    capturedAt: new Date(snapshot.capturedAt).toISOString(),
  };
}

function assertSame(stored: StoredSolanaControlSurfaceReport, expected: Materialized): void {
  if (
    stored.id !== expected.id ||
    stored.chainId !== expected.chainId ||
    stored.subject !== expected.subject ||
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
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_CONFLICT',
      'Stored Solana control surface conflicts with the canonical report.',
    );
  }
}

function rowToReport(row: Record<string, unknown>): StoredSolanaControlSurfaceReport {
  const parsed = SolanaControlSurfaceReportSchema.safeParse(json(row.report));
  if (!parsed.success) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_CONFLICT',
      'Stored Solana control surface report is invalid.',
      { cause: parsed.error },
    );
  }
  const stored: StoredSolanaControlSurfaceReport = {
    id: requiredString(row, 'id'),
    chainId: requiredString(row, 'chain_id') as 'solana-mainnet',
    subject: requiredString(row, 'subject_address'),
    snapshotSlot: requiredString(row, 'snapshot_slot'),
    snapshotHash: requiredString(row, 'snapshot_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: parsed.data,
    terminalEvidenceId: requiredString(row, 'terminal_evidence_id'),
    evidenceIds: stringArray(row.evidence_ids, 'Evidence IDs'),
    sourceSet: stringArray(row.source_set, 'source set'),
    modelVersion: requiredString(row, 'model_version'),
    capturedAt: timestamp(row.captured_at, 'capturedAt'),
    createdAt: timestamp(row.created_at, 'createdAt'),
  };
  assertSame(stored, materialize(stored.report));
  return stored;
}

function reportId(value: string): string {
  if (!/^scs_[0-9a-f]{24}$/.test(value)) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_INVALID',
      'Solana control surface report ID is invalid.',
    );
  }
  return value;
}

function address(value: string): string {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)) {
    throw new ControlSurfaceReportStorageError(
      'CONTROL_SURFACE_INVALID',
      'Solana control surface subject is invalid.',
    );
  }
  return value;
}

export class PostgresSolanaControlSurfaceRepository {
  readonly #pool: ControlSurfacePool;

  constructor(options: ControlSurfaceReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ControlSurfacePool): PostgresSolanaControlSurfaceRepository {
    return new PostgresSolanaControlSurfaceRepository({ pool });
  }

  async put(report: SolanaControlSurfaceReport): Promise<StoredSolanaControlSurfaceReport> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO solana_control_surface_reports (
          id, chain_id, subject_address, snapshot_slot, snapshot_hash, result_hash,
          report, terminal_evidence_id, evidence_ids, source_set, model_version, captured_at
        ) VALUES (
          $1, $2, $3, $4::numeric, $5, $6,
          $7::jsonb, $8, $9::text[], $10::text[], $11, $12::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.chainId,
          expected.subject,
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
        throw new ControlSurfaceReportStorageError(
          'CONTROL_SURFACE_CONFLICT',
          'Solana control surface report was not stored.',
        );
      }
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof ControlSurfaceReportStorageError) throw error;
      throw new ControlSurfaceReportStorageError(
        'CONTROL_SURFACE_UNAVAILABLE',
        'Solana control surface report write failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async get(id: string): Promise<StoredSolanaControlSurfaceReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof ControlSurfaceReportStorageError) throw error;
      throw new ControlSurfaceReportStorageError(
        'CONTROL_SURFACE_UNAVAILABLE',
        'Solana control surface report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async latest(subjectInput: string): Promise<StoredSolanaControlSurfaceReport | undefined> {
    const subject = address(subjectInput);
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE chain_id = 'solana-mainnet' AND subject_address = $1
         ORDER BY snapshot_slot DESC, captured_at DESC, created_at DESC, id DESC
         LIMIT 1`,
        [subject],
      );
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof ControlSurfaceReportStorageError) throw error;
      throw new ControlSurfaceReportStorageError(
        'CONTROL_SURFACE_UNAVAILABLE',
        'Latest Solana control surface report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: 'CONTROL_SURFACE_UNAVAILABLE' | 'CONTROL_SURFACE_NOT_INITIALIZED';
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.solana_control_surface_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['014_solana_control_surface_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'solana_control_surface_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'CONTROL_SURFACE_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'CONTROL_SURFACE_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
