import { Pool } from 'pg';

import { canonicalJson, hashPayload } from '@zerotrace/evidence';
import {
  EvmClaimAddressObservationSchema,
  type EvmClaimAddressObservation,
} from '@zerotrace/schemas';

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

interface ClaimReportPool {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

export interface ClaimReportRepositoryOptions {
  connectionString: string;
  maxConnections?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

interface InternalOptions {
  pool: ClaimReportPool;
}

export type ClaimReportStorageErrorCode =
  | 'CLAIM_REPORT_UNAVAILABLE'
  | 'CLAIM_REPORT_NOT_INITIALIZED'
  | 'CLAIM_REPORT_INVALID'
  | 'CLAIM_REPORT_CONFLICT';

export class ClaimReportStorageError extends Error {
  readonly code: ClaimReportStorageErrorCode;
  readonly retryable: boolean;

  constructor(
    code: ClaimReportStorageErrorCode,
    message: string,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ClaimReportStorageError';
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}

export interface StoredEvmClaimReport {
  id: string;
  chainId: string;
  tokenAddress: string;
  address: string;
  fromBlock: string;
  toBlock: string;
  snapshotBlock: string;
  snapshotHash: string;
  resultHash: string;
  report: EvmClaimAddressObservation;
  terminalEvidenceId: string;
  evidenceIds: readonly string[];
  sourceSet: readonly string[];
  modelVersion: string;
  capturedAt: string;
  createdAt: string;
}

type MaterializedClaimReport = Omit<StoredEvmClaimReport, 'createdAt'>;

const SELECT_REPORT = `
  SELECT
    id,
    chain_id,
    token_address,
    subject_address,
    from_block::text,
    to_block::text,
    snapshot_block::text,
    snapshot_hash,
    result_hash,
    report,
    terminal_evidence_id,
    evidence_ids,
    source_set,
    model_version,
    captured_at,
    created_at
  FROM evm_claim_reports
`;

function createPool(options: ClaimReportRepositoryOptions): ClaimReportPool {
  const pool = new Pool({
    connectionString: options.connectionString,
    max: options.maxConnections ?? 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    statement_timeout: options.statementTimeoutMs ?? 15_000,
    application_name: 'zerotrace-claim-reports',
  });
  pool.on('error', () => undefined);
  return pool;
}

function requiredString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || value === '') {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_CONFLICT',
      `Stored Claim Report ${field} is invalid.`,
    );
  }
  return value;
}

function address(value: string, field: string): string {
  if (!/^0x[0-9a-f]{40}$/.test(value)) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_INVALID',
      `Claim Report ${field} must be a canonical lowercase EVM address.`,
    );
  }
  return value;
}

function quantity(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value : String(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_CONFLICT',
      `Stored Claim Report ${field} is invalid.`,
    );
  }
  return text;
}

function timestamp(value: unknown, field: string): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_CONFLICT',
      `Stored Claim Report ${field} is invalid.`,
    );
  }
  return parsed.toISOString();
}

function stringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item === '')) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_CONFLICT',
      `Stored Claim Report ${field} is invalid.`,
    );
  }
  const canonical = [...new Set(value as string[])].sort();
  if (canonical.length !== value.length || canonical.some((item, index) => item !== value[index])) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_CONFLICT',
      `Stored Claim Report ${field} is not canonical.`,
    );
  }
  return canonical;
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_CONFLICT',
      'Stored Claim Report result is not JSON.',
      { cause: error },
    );
  }
}

function canonicalInput(values: readonly string[], field: string): string[] {
  const canonical = [...new Set(values)].sort();
  if (
    canonical.length !== values.length ||
    canonical.some((item, index) => item !== values[index])
  ) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_INVALID',
      `Claim Report ${field} must be sorted and unique.`,
    );
  }
  return canonical;
}

function nestedEvidenceIds(report: EvmClaimAddressObservation): string[] {
  return [
    ...report.custody.evidenceIds,
    ...report.custodyMetadata.evidenceIds,
    ...report.flow.metadata.evidenceIds,
    ...report.flow.inflow.evidenceIds,
    ...report.flow.outflow.evidenceIds,
    ...report.flow.topCounterparties.flatMap((item) => item.evidenceIds),
  ];
}

function materialize(reportInput: EvmClaimAddressObservation): MaterializedClaimReport {
  const parsed = EvmClaimAddressObservationSchema.safeParse(reportInput);
  if (!parsed.success) {
    throw new ClaimReportStorageError('CLAIM_REPORT_INVALID', 'Claim Report result is invalid.', {
      cause: parsed.error,
    });
  }
  const report = parsed.data;
  const snapshot = report.metadata.snapshot;
  const custodySnapshot = report.custodyMetadata.snapshot;
  const flowSnapshot = report.flow.metadata.snapshot;
  if (
    snapshot?.ledger !== 'EVM' ||
    snapshot.finality !== 'finalized' ||
    snapshot.blockTimestamp === undefined ||
    custodySnapshot === null ||
    flowSnapshot === null ||
    canonicalJson(custodySnapshot) !== canonicalJson(snapshot) ||
    canonicalJson(flowSnapshot) !== canonicalJson(snapshot)
  ) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_INVALID',
      'Claim Report requires one identical finalized timestamped EVM Snapshot.',
    );
  }
  const tokenAddress = address(report.tokenAddress, 'token address');
  const subjectAddress = address(report.address, 'subject address');
  if (report.custody.address !== subjectAddress || report.flow.address !== subjectAddress) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_INVALID',
      'Claim Report custody and flow subjects must match the report subject.',
    );
  }
  if (canonicalJson(report.flow.window) !== canonicalJson(report.window)) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_INVALID',
      'Claim Report flow window must match the report window.',
    );
  }
  const fromBlock = quantity(report.fromBlock, 'from block');
  const toBlock = quantity(report.toBlock, 'to block');
  const snapshotBlock = quantity(snapshot.blockNumber, 'Snapshot block');
  if (BigInt(toBlock) < BigInt(fromBlock) || BigInt(toBlock) > BigInt(snapshotBlock)) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_INVALID',
      'Claim Report range is invalid or exceeds its Snapshot.',
    );
  }
  const evidenceIds = canonicalInput(report.metadata.evidenceIds, 'Evidence IDs');
  const sourceSet = canonicalInput(report.metadata.sourceSet, 'source set');
  if (
    evidenceIds.length === 0 ||
    sourceSet.length === 0 ||
    !evidenceIds.includes(report.terminalEvidenceId) ||
    nestedEvidenceIds(report).some((id) => !evidenceIds.includes(id))
  ) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_INVALID',
      'Claim Report provenance must include terminal and nested Evidence.',
    );
  }
  const resultHash = hashPayload(report);
  return {
    id: `ecr_${hashPayload({ schema: 'zerotrace-evm-claim-report-v1', resultHash }).slice(0, 24)}`,
    chainId: snapshot.chainId,
    tokenAddress,
    address: subjectAddress,
    fromBlock,
    toBlock,
    snapshotBlock,
    snapshotHash: snapshot.blockHash,
    resultHash,
    report,
    terminalEvidenceId: report.terminalEvidenceId,
    evidenceIds,
    sourceSet,
    modelVersion: report.metadata.modelVersion,
    capturedAt: new Date(snapshot.capturedAt).toISOString(),
  };
}

function assertSame(stored: StoredEvmClaimReport, expected: MaterializedClaimReport): void {
  if (
    stored.id !== expected.id ||
    stored.chainId !== expected.chainId ||
    stored.tokenAddress !== expected.tokenAddress ||
    stored.address !== expected.address ||
    stored.fromBlock !== expected.fromBlock ||
    stored.toBlock !== expected.toBlock ||
    stored.snapshotBlock !== expected.snapshotBlock ||
    stored.snapshotHash !== expected.snapshotHash ||
    stored.resultHash !== expected.resultHash ||
    stored.terminalEvidenceId !== expected.terminalEvidenceId ||
    stored.modelVersion !== expected.modelVersion ||
    stored.capturedAt !== expected.capturedAt ||
    canonicalJson(stored.evidenceIds) !== canonicalJson(expected.evidenceIds) ||
    canonicalJson(stored.sourceSet) !== canonicalJson(expected.sourceSet) ||
    canonicalJson(stored.report) !== canonicalJson(expected.report)
  ) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_CONFLICT',
      'Stored Claim Report conflicts with the canonical result.',
    );
  }
}

function rowToReport(row: Record<string, unknown>): StoredEvmClaimReport {
  const report = EvmClaimAddressObservationSchema.safeParse(json(row.report));
  if (!report.success) {
    throw new ClaimReportStorageError(
      'CLAIM_REPORT_CONFLICT',
      'Stored Claim Report result is invalid.',
      { cause: report.error },
    );
  }
  const stored: StoredEvmClaimReport = {
    id: requiredString(row, 'id'),
    chainId: requiredString(row, 'chain_id'),
    tokenAddress: requiredString(row, 'token_address'),
    address: requiredString(row, 'subject_address'),
    fromBlock: quantity(row.from_block, 'from block'),
    toBlock: quantity(row.to_block, 'to block'),
    snapshotBlock: quantity(row.snapshot_block, 'Snapshot block'),
    snapshotHash: requiredString(row, 'snapshot_hash'),
    resultHash: requiredString(row, 'result_hash'),
    report: report.data,
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
  if (!/^ecr_[0-9a-f]{24}$/.test(value)) {
    throw new ClaimReportStorageError('CLAIM_REPORT_INVALID', 'Claim Report ID is invalid.');
  }
  return value;
}

export class PostgresClaimReportRepository {
  readonly #pool: ClaimReportPool;

  constructor(options: ClaimReportRepositoryOptions | InternalOptions) {
    this.#pool = 'pool' in options ? options.pool : createPool(options);
  }

  static fromPool(pool: ClaimReportPool): PostgresClaimReportRepository {
    return new PostgresClaimReportRepository({ pool });
  }

  async put(report: EvmClaimAddressObservation): Promise<StoredEvmClaimReport> {
    const expected = materialize(report);
    try {
      const existing = await this.get(expected.id);
      if (existing !== undefined) {
        assertSame(existing, expected);
        return existing;
      }
      await this.#pool.query(
        `INSERT INTO evm_claim_reports (
          id, chain_id, token_address, subject_address, from_block, to_block,
          snapshot_block, snapshot_hash, result_hash, report, terminal_evidence_id,
          evidence_ids, source_set, model_version, captured_at
        ) VALUES (
          $1, $2, $3, $4, $5::numeric, $6::numeric,
          $7::numeric, $8, $9, $10::jsonb, $11,
          $12::text[], $13::text[], $14, $15::timestamptz
        ) ON CONFLICT DO NOTHING`,
        [
          expected.id,
          expected.chainId,
          expected.tokenAddress,
          expected.address,
          expected.fromBlock,
          expected.toBlock,
          expected.snapshotBlock,
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
        throw new ClaimReportStorageError('CLAIM_REPORT_CONFLICT', 'Claim Report was not stored.');
      }
      assertSame(stored, expected);
      return stored;
    } catch (error) {
      if (error instanceof ClaimReportStorageError) throw error;
      throw new ClaimReportStorageError('CLAIM_REPORT_UNAVAILABLE', 'Claim Report write failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async get(id: string): Promise<StoredEvmClaimReport | undefined> {
    const canonicalId = reportId(id);
    try {
      const result = await this.#pool.query(`${SELECT_REPORT} WHERE id = $1`, [canonicalId]);
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof ClaimReportStorageError) throw error;
      throw new ClaimReportStorageError('CLAIM_REPORT_UNAVAILABLE', 'Claim Report read failed.', {
        retryable: true,
        cause: error,
      });
    }
  }

  async latest(
    chainId: string,
    tokenAddressInput: string,
    subjectAddressInput: string,
  ): Promise<StoredEvmClaimReport | undefined> {
    if (!/^eip155:[1-9]\d*$/.test(chainId)) {
      throw new ClaimReportStorageError(
        'CLAIM_REPORT_INVALID',
        'Claim Report chain ID is invalid.',
      );
    }
    const tokenAddress = address(tokenAddressInput, 'token address');
    const subjectAddress = address(subjectAddressInput, 'subject address');
    try {
      const result = await this.#pool.query(
        `${SELECT_REPORT}
         WHERE chain_id = $1 AND token_address = $2 AND subject_address = $3
         ORDER BY snapshot_block DESC, captured_at DESC, id DESC
         LIMIT 1`,
        [chainId, tokenAddress, subjectAddress],
      );
      return result.rows[0] === undefined ? undefined : rowToReport(result.rows[0]);
    } catch (error) {
      if (error instanceof ClaimReportStorageError) throw error;
      throw new ClaimReportStorageError(
        'CLAIM_REPORT_UNAVAILABLE',
        'Latest Claim Report read failed.',
        { retryable: true, cause: error },
      );
    }
  }

  async health(): Promise<{
    status: 'UP' | 'DOWN';
    backend: 'POSTGRES';
    durable: true;
    checkedAt: string;
    errorCode?: ClaimReportStorageErrorCode;
  }> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.#pool.query(
        `SELECT
          to_regclass('public.evm_claim_reports')::text AS table_name,
          EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1) AS migration_applied`,
        ['011_evm_claim_reports'],
      );
      if (
        result.rows[0]?.table_name !== 'evm_claim_reports' ||
        result.rows[0]?.migration_applied !== true
      ) {
        return {
          status: 'DOWN',
          backend: 'POSTGRES',
          durable: true,
          checkedAt,
          errorCode: 'CLAIM_REPORT_NOT_INITIALIZED',
        };
      }
      return { status: 'UP', backend: 'POSTGRES', durable: true, checkedAt };
    } catch {
      return {
        status: 'DOWN',
        backend: 'POSTGRES',
        durable: true,
        checkedAt,
        errorCode: 'CLAIM_REPORT_UNAVAILABLE',
      };
    }
  }

  close(): Promise<void> {
    return this.#pool.end();
  }
}
